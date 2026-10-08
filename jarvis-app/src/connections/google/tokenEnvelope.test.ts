// ENVELOPE ENCRYPTION (Foundation Fix Spec 2). What is held: every secret gets
// its own data key; the blob opens only for the row and the kind it was sealed
// for; the original format still opens and is flagged for upgrade; a new key
// can be introduced beside the old one without stranding anything.
import { describe, it, expect } from "vitest";
import { sealSecret, openSecret, needsUpgrade, isEnvelope, kekId, ENVELOPE_PREFIX, type KeyRing, type SecretScope } from "./tokenEnvelope";

const key = (n: number) => Buffer.alloc(32, n).toString("base64");
const RING: KeyRing = { current: key(7) };
const SCOPE: SecretScope = { userId: "user-1", email: "Dave@Gmail.com", kind: "refresh" };

/** The format before this change: base64(iv || AES-GCM ciphertext) under the key directly, no data key, no additional data. */
async function legacySeal(plain: string, kek: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await crypto.subtle.importKey("raw", Uint8Array.from(atob(kek), (c) => c.charCodeAt(0)), "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(plain)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv); out.set(ct, iv.length);
  return btoa(String.fromCharCode(...out));
}

describe("sealSecret / openSecret", () => {
  it("round-trips, and the blob names its key but never carries the secret", async () => {
    const blob = await sealSecret("1//refresh-token", RING, SCOPE);
    expect(blob.startsWith(ENVELOPE_PREFIX + (await kekId(RING.current)) + ".")).toBe(true);
    expect(blob).not.toContain("1//refresh-token");
    expect(blob.slice(ENVELOPE_PREFIX.length).split(".")).toHaveLength(3);
    expect(await openSecret(blob, RING, SCOPE)).toBe("1//refresh-token");
  });

  it("every secret gets its own data key: sealing the same text twice shares nothing", async () => {
    const a = await sealSecret("same", RING, SCOPE);
    const b = await sealSecret("same", RING, SCOPE);
    const [, wa, pa] = a.slice(ENVELOPE_PREFIX.length).split(".");
    const [, wb, pb] = b.slice(ENVELOPE_PREFIX.length).split(".");
    expect(wa).not.toBe(wb);
    expect(pa).not.toBe(pb);
  });

  it("the address is compared without case, so a row's casing cannot lock its own secret out", async () => {
    const blob = await sealSecret("x", RING, SCOPE);
    expect(await openSecret(blob, RING, { ...SCOPE, email: "dave@gmail.com" })).toBe("x");
  });

  it("is bound to its row: another user, another address, or another kind cannot open it", async () => {
    const blob = await sealSecret("1//refresh-token", RING, SCOPE);
    await expect(openSecret(blob, RING, { ...SCOPE, userId: "user-2" })).rejects.toThrow();
    await expect(openSecret(blob, RING, { ...SCOPE, email: "other@gmail.com" })).rejects.toThrow();
    await expect(openSecret(blob, RING, { ...SCOPE, kind: "access" })).rejects.toThrow();
  });

  it("fails closed on damage, a wrong key, and malformed input", async () => {
    const blob = await sealSecret("x", RING, SCOPE);
    const [kid, wrapped, payload] = blob.slice(ENVELOPE_PREFIX.length).split(".");
    const flip = (s: string) => s.slice(0, -4) + (s.slice(-4) === "AAAA" ? "BBBB" : "AAAA");
    await expect(openSecret(`${ENVELOPE_PREFIX}${kid}.${wrapped}.${flip(payload!)}`, RING, SCOPE)).rejects.toThrow();
    await expect(openSecret(`${ENVELOPE_PREFIX}${kid}.${flip(wrapped!)}.${payload}`, RING, SCOPE)).rejects.toThrow();
    await expect(openSecret(blob, { current: key(9) }, SCOPE)).rejects.toThrow();
    await expect(openSecret(ENVELOPE_PREFIX + "only.two", RING, SCOPE)).rejects.toThrow();
    await expect(openSecret("not base64 at all !!", RING, SCOPE)).rejects.toThrow();
  });
});

describe("the original format keeps working", () => {
  it("opens a token stored before this change, and says it should be upgraded", async () => {
    const old = await legacySeal("1//old-token", RING.current);
    expect(isEnvelope(old)).toBe(false);
    expect(await openSecret(old, RING, SCOPE)).toBe("1//old-token");
    expect(await needsUpgrade(old, RING)).toBe(true);
  });

  it("a current-format secret under the current key needs no upgrade", async () => {
    expect(await needsUpgrade(await sealSecret("x", RING, SCOPE), RING)).toBe(false);
  });
});

describe("key rotation", () => {
  it("a secret sealed under the old key still opens beside the new one, and is flagged for rewrite", async () => {
    const oldRing: KeyRing = { current: key(7) };
    const sealedOld = await sealSecret("1//t", oldRing, SCOPE);
    const rotated: KeyRing = { current: key(8), previous: key(7) };
    expect(await openSecret(sealedOld, rotated, SCOPE)).toBe("1//t");
    expect(await needsUpgrade(sealedOld, rotated)).toBe(true);
    const rewritten = await sealSecret("1//t", rotated, SCOPE);
    expect(await needsUpgrade(rewritten, rotated)).toBe(false);
    expect(await openSecret(rewritten, { current: key(8) }, SCOPE)).toBe("1//t");
  });

  it("an original-format token under the previous key opens too", async () => {
    const old = await legacySeal("1//old", key(7));
    expect(await openSecret(old, { current: key(8), previous: key(7) }, SCOPE)).toBe("1//old");
  });

  it("once the previous key is dropped, what it sealed no longer opens", async () => {
    const sealedOld = await sealSecret("1//t", { current: key(7) }, SCOPE);
    await expect(openSecret(sealedOld, { current: key(8) }, SCOPE)).rejects.toThrow();
  });
});
