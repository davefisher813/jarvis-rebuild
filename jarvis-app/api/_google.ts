// THE GOOGLE GRANT, IN ONE PLACE (2026-09-19).
//
// The stored refresh token, the cipher around it, and the two OAuth clients it
// might belong to were private to api/google.ts, which is right for as long as
// sign-in is the only thing that needs them. The booking confirmation needs
// them too: a stranger books a time and the receipt has to come from the
// host's own mailbox, and there is no session on that request to carry a
// token. So this is the shared floor, moved rather than copied. A second copy
// of AES-GCM code is how two copies drift and one of them stops decrypting
// what the other wrote.
//
// Nothing here reads process.env. The caller passes what it has, so a
// mistake is a missing argument at build time rather than a silent fallback.

const TOKEN_URL = "https://oauth2.googleapis.com/token";

// WHICH CLIENT A TOKEN BELONGS TO. Google refreshes a token only with the
// client that issued it. A token from the iPhone's native connect was issued
// to the iOS client, which has no secret. The client is recorded INSIDE the
// encrypted value (no schema change): native tokens are stored as
// "ios:" + token. Google refresh tokens begin "1//", so the tag cannot
// collide with one.
export const IOS_TAG = "ios:";

async function cipherKey(secretB64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(secretB64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encrypt(plain: string, secretB64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await cipherKey(secretB64);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)));
  const packed = new Uint8Array(iv.length + ct.length);
  packed.set(iv); packed.set(ct, iv.length);
  return btoa(String.fromCharCode(...packed));
}

export async function decrypt(packedB64: string, secretB64: string): Promise<string> {
  const packed = Uint8Array.from(atob(packedB64), (c) => c.charCodeAt(0));
  const key = await cipherKey(secretB64);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: packed.slice(0, 12) }, key, packed.slice(12));
  return new TextDecoder().decode(plain);
}

export interface GoogleClients { clientId: string; clientSecret: string; iosClientId: string }
export interface Refreshed { accessToken: string; expiresIn: number }

/** A fresh access token from a stored refresh token.
 *
 *  A tagged token goes straight to the iOS client. An untagged one is web, or
 *  a native token stored before the tag existed: try web, then iOS, and only
 *  report failure once every client it could belong to has refused it, so a
 *  phone's token is never treated as revoked for being tried against the
 *  wrong client first. */
export async function refreshAccessToken(
  stored: string,
  clients: GoogleClients,
): Promise<{ ok: true; got: Refreshed } | { ok: false; error: string }> {
  const tagged = stored.startsWith(IOS_TAG);
  const refreshToken = tagged ? stored.slice(IOS_TAG.length) : stored;
  type Tok = { access_token?: string; expires_in?: number; error?: string };
  const attempt = async (params: Record<string, string>): Promise<{ ok: boolean; tok: Tok }> => {
    const r = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ refresh_token: refreshToken, grant_type: "refresh_token", ...params }),
    });
    return { ok: r.ok, tok: (await r.json()) as Tok };
  };
  const viaWeb = () => attempt({ client_id: clients.clientId, client_secret: clients.clientSecret });
  // The iOS client has no secret; the token alone proves it (see IOS_TAG).
  const viaIos = () => attempt({ client_id: clients.iosClientId });

  let res = tagged && clients.iosClientId ? await viaIos() : await viaWeb();
  if ((!res.ok || !res.tok.access_token) && !tagged && clients.iosClientId) {
    const second = await viaIos();
    if (second.ok && second.tok.access_token) res = second;
  }
  if (!res.ok || !res.tok.access_token) return { ok: false, error: res.tok.error || "Refresh failed" };
  return { ok: true, got: { accessToken: res.tok.access_token, expiresIn: res.tok.expires_in ?? 3600 } };
}

export interface Mailbox { accessToken: string; email: string }

/** The mailbox a given user has connected, ready to send from, or null.
 *
 *  Null is an ordinary answer and not an error: a user who has never
 *  connected Google, or whose grant has been revoked, simply has no mailbox
 *  here, and every caller must be able to carry on without one. This never
 *  deletes a revoked row; forgetting a grant is a decision that belongs to
 *  the sign-in path, which can tell the person about it. */
export async function ownerMailbox(opts: {
  supaUrl: string; service: string; tokenKey: string; clients: GoogleClients; userId: string;
}): Promise<Mailbox | null> {
  const { supaUrl, service, tokenKey, clients, userId } = opts;
  if (!supaUrl || !service || !tokenKey || !clients.clientId) return null;
  try {
    const svc = { apikey: service, Authorization: "Bearer " + service, "content-type": "application/json" };
    // The most recently refreshed mailbox, when somebody has connected more
    // than one: the account they are actually using.
    const r = await fetch(
      `${supaUrl}/rest/v1/google_tokens?user_id=eq.${userId}&select=email,token_enc&order=updated_at.desc&limit=1`,
      { headers: svc },
    );
    if (!r.ok) return null;
    const found = (await r.json()) as { email: string; token_enc: string }[];
    const row = found[0];
    if (!row) return null;
    const stored = await decrypt(row.token_enc, tokenKey);
    const got = await refreshAccessToken(stored, clients);
    if (!got.ok) return null;
    return { accessToken: got.got.accessToken, email: row.email };
  } catch {
    return null;
  }
}

/** Hand one already-encoded message to Gmail. Returns whether it went, never
 *  throws: every caller here is sending a courtesy alongside work that has
 *  already succeeded, and a failed courtesy must not undo it. */
export async function sendRaw(accessToken: string, raw: string): Promise<boolean> {
  try {
    const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
