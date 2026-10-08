// ENVELOPE ENCRYPTION FOR STORED GOOGLE SECRETS (Foundation Fix Spec 2, 2026-10-07).
//
// Until now the one environment key (GOOGLE_TOKEN_KEY) encrypted every refresh
// token directly: one key, every secret, no way to rotate it without
// re-encrypting the table, and a ciphertext that would decrypt just as happily
// if somebody copied it onto another person's row. This is the stronger shape,
// and Dave chose it on purpose:
//
//   - EVERY SECRET GETS ITS OWN DATA KEY (DEK). A refresh token and an access
//     token are sealed separately, each under a fresh random 256-bit DEK.
//   - THE DEK IS WRAPPED BY THE KEY-ENCRYPTION KEY (KEK), which is the
//     environment key and never leaves the server. The database holds only
//     the wrapped DEK and the ciphertext. A dump alone recovers nothing.
//   - THE CIPHERTEXT IS BOUND TO ITS ROW. The user, the address and what the
//     secret IS are authenticated data (AAD) on both layers, so a blob copied
//     onto another row, or a refresh token presented as an access token,
//     fails to open instead of working.
//   - THE KEK HAS AN ID. The id travels with the blob, so a new key can be
//     introduced beside the old one (GOOGLE_TOKEN_KEY_PREV) and secrets move
//     to it as they are next rewritten, with no big-bang re-encryption.
//
// Wire format: "v2.<kid>.<wrapped DEK>.<payload>", each part base64 (which
// never contains a dot). Anything without that prefix is the original format
// (base64 of a 12-byte iv and the ciphertext, under the KEK directly) and is
// still opened, so every token stored before this change keeps working and is
// upgraded the next time it is rewritten.
//
// Nothing here reads process.env or logs. The caller passes the keys.

const enc = new TextEncoder();
const dec = new TextDecoder();

type Bytes = Uint8Array<ArrayBuffer>;
const b64 = (u: Uint8Array): string => btoa(String.fromCharCode(...u));
const unb64 = (s: string): Bytes => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const ENVELOPE_PREFIX = "v2.";

/** What a sealed secret is. Part of the authenticated data, so one kind never opens as another. */
export type SecretKind = "refresh" | "access";

export interface KeyRing {
  /** The key-encryption key, 32 bytes, base64. New secrets are sealed under it. */
  current: string;
  /** The key it replaced, still accepted for opening while secrets are rewritten. */
  previous?: string;
}

/** The row a secret belongs to. Authenticated, never secret. */
export interface SecretScope { userId: string; email: string; kind: SecretKind }

const aadOf = (s: SecretScope, layer: "payload" | "wrap"): Bytes =>
  enc.encode(`jarvis.google.${layer}|${s.userId}|${s.email.trim().toLowerCase()}|${s.kind}`);

async function aesKey(raw: Bytes, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, usages);
}

/** A short, stable id for a KEK: enough to pick the right key, useless for finding it. */
export async function kekId(kekB64: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", unb64(kekB64)));
  return Array.from(d.slice(0, 4), (x) => x.toString(16).padStart(2, "0")).join("");
}

export const isEnvelope = (packed: string): boolean => packed.startsWith(ENVELOPE_PREFIX);

async function gcm(key: CryptoKey, plain: Bytes, aad: Bytes): Promise<Bytes> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, key, plain));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return out;
}

async function ungcm(key: CryptoKey, packed: Bytes, aad: Bytes): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: packed.slice(0, 12), additionalData: aad }, key, packed.slice(12)));
}

/** Seal one secret under a fresh DEK, wrapped by the current KEK. */
export async function sealSecret(plain: string, ring: KeyRing, scope: SecretScope): Promise<string> {
  const dek = crypto.getRandomValues(new Uint8Array(32));
  const payload = await gcm(await aesKey(dek, ["encrypt"]), enc.encode(plain), aadOf(scope, "payload"));
  const wrapped = await gcm(await aesKey(unb64(ring.current), ["encrypt"]), dek, aadOf(scope, "wrap"));
  dek.fill(0);
  return `${ENVELOPE_PREFIX}${await kekId(ring.current)}.${b64(wrapped)}.${b64(payload)}`;
}

/** Open a sealed secret: the envelope when it is one, the original format when it is not. Throws when it cannot be opened. */
export async function openSecret(packed: string, ring: KeyRing, scope: SecretScope): Promise<string> {
  if (!isEnvelope(packed)) {
    // The original format: no data key, no scope. Opened under whichever key
    // the ring holds, so a rotation never strands a token stored before it.
    const raw = unb64(packed);
    for (const k of [ring.current, ring.previous]) {
      if (!k) continue;
      try {
        // The original format passed no additional data at all.
        const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, await aesKey(unb64(k), ["decrypt"]), raw.slice(12));
        return dec.decode(plain);
      } catch { /* try the next key */ }
    }
    throw new Error("cannot open");
  }
  const parts = packed.slice(ENVELOPE_PREFIX.length).split(".");
  if (parts.length !== 3) throw new Error("cannot open");
  const [kid, wrapped, payload] = parts as [string, string, string];
  const candidates = [ring.current, ring.previous].filter((k): k is string => !!k);
  for (const k of candidates) {
    if ((await kekId(k)) !== kid) continue;
    try {
      const dek = await ungcm(await aesKey(unb64(k), ["decrypt"]), unb64(wrapped), aadOf(scope, "wrap"));
      try {
        return dec.decode(await ungcm(await aesKey(dek, ["decrypt"]), unb64(payload), aadOf(scope, "payload")));
      } finally {
        dek.fill(0);
      }
    } catch { /* wrong scope or damaged: fall through to "cannot open" */ }
  }
  throw new Error("cannot open");
}

/** True when this secret is not yet in the current format under the current key, so it should be rewritten the next time the row is. */
export async function needsUpgrade(packed: string, ring: KeyRing): Promise<boolean> {
  if (!isEnvelope(packed)) return true;
  const kid = packed.slice(ENVELOPE_PREFIX.length).split(".")[0];
  return kid !== (await kekId(ring.current));
}
