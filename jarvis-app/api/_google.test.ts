import { describe, it, expect, vi, afterEach } from "vitest";
import { IOS_TAG, encrypt, decrypt, refreshAccessToken, ownerMailbox, sendRaw } from "./_google";

// THE GOOGLE GRANT (2026-09-19). These were untested for as long as they were
// private to the sign-in endpoint. The booking confirmation is the second
// caller, and the failure that matters most here is the quiet one: a mailbox
// that cannot be reached must come back as null rather than as an exception
// thrown through a booking that has already succeeded.

const KEY = Buffer.alloc(32, 7).toString("base64");
const CLIENTS = { clientId: "web.apps", clientSecret: "shh", iosClientId: "ios.apps" };

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
const bad = (body: unknown, status = 400) => ({ ok: false, status, json: async () => body }) as Response;

afterEach(() => { vi.unstubAllGlobals(); });

describe("the cipher around a refresh token", () => {
  it("what goes in comes back out", async () => {
    const packed = await encrypt("1//abc-refresh", KEY);
    expect(packed).not.toContain("1//");
    expect(await decrypt(packed, KEY)).toBe("1//abc-refresh");
  });
  it("encrypts the same token to a different string every time", async () => {
    // A fixed IV would make two identical tokens look identical in the table.
    expect(await encrypt("same", KEY)).not.toBe(await encrypt("same", KEY));
  });
  it("refuses to decrypt with the wrong key rather than returning rubbish", async () => {
    const packed = await encrypt("1//abc", KEY);
    await expect(decrypt(packed, Buffer.alloc(32, 9).toString("base64"))).rejects.toBeTruthy();
  });
  it("round-trips a tagged native token, tag and all", async () => {
    const packed = await encrypt(IOS_TAG + "1//phone", KEY);
    const back = await decrypt(packed, KEY);
    expect(back.startsWith(IOS_TAG)).toBe(true);
    expect(back.slice(IOS_TAG.length)).toBe("1//phone");
  });
});

describe("refreshAccessToken", () => {
  const bodyOf = (call: unknown[]): URLSearchParams =>
    new URLSearchParams((call[1] as { body: string }).body);

  it("sends an untagged token to the web client, with its secret", async () => {
    const f = vi.fn(async () => ok({ access_token: "at", expires_in: 1200 }));
    vi.stubGlobal("fetch", f);
    const r = await refreshAccessToken("1//web", CLIENTS);
    expect(r).toEqual({ ok: true, got: { accessToken: "at", expiresIn: 1200 } });
    const sent = bodyOf(f.mock.calls[0]!);
    expect(sent.get("client_id")).toBe("web.apps");
    expect(sent.get("client_secret")).toBe("shh");
    expect(sent.get("refresh_token")).toBe("1//web");
  });

  it("sends a tagged token to the iOS client, with no secret, and strips the tag", async () => {
    const f = vi.fn(async () => ok({ access_token: "at" }));
    vi.stubGlobal("fetch", f);
    await refreshAccessToken(IOS_TAG + "1//phone", CLIENTS);
    const sent = bodyOf(f.mock.calls[0]!);
    expect(sent.get("client_id")).toBe("ios.apps");
    expect(sent.get("client_secret")).toBeNull();
    expect(sent.get("refresh_token")).toBe("1//phone");
  });

  // A phone token stored before the tag existed is untagged but belongs to the
  // iOS client. Reporting it as revoked on the first refusal is what deletes a
  // working sign-in, so both clients are tried before anyone gives up.
  it("falls back to the iOS client for an untagged token the web client refuses", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(bad({ error: "invalid_client" }))
      .mockResolvedValueOnce(ok({ access_token: "second" }));
    vi.stubGlobal("fetch", f);
    const r = await refreshAccessToken("1//old-phone", CLIENTS);
    expect(r.ok && r.got.accessToken).toBe("second");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("reports the error Google gave, so invalid_grant can be acted on", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => bad({ error: "invalid_grant" })));
    const r = await refreshAccessToken(IOS_TAG + "1//dead", CLIENTS);
    expect(r).toEqual({ ok: false, error: "invalid_grant" });
  });

  it("does not try a second client when there is no iOS client configured", async () => {
    const f = vi.fn(async () => bad({ error: "invalid_grant" }));
    vi.stubGlobal("fetch", f);
    await refreshAccessToken("1//web", { ...CLIENTS, iosClientId: "" });
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("ownerMailbox", () => {
  const opts = { supaUrl: "https://live.test", service: "svc", tokenKey: KEY, clients: CLIENTS, userId: "u-1" };

  it("returns the mailbox and a fresh token when the grant is good", async () => {
    const packed = await encrypt("1//good", KEY);
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      String(url).includes("google_tokens")
        ? ok([{ email: "dave@example.com", token_enc: packed }])
        : ok({ access_token: "fresh" })));
    expect(await ownerMailbox(opts)).toEqual({ accessToken: "fresh", email: "dave@example.com" });
  });

  it("asks for the most recently refreshed mailbox, when there is more than one", async () => {
    const packed = await encrypt("1//good", KEY);
    const f = vi.fn(async (url: string) =>
      String(url).includes("google_tokens") ? ok([{ email: "a@b.com", token_enc: packed }]) : ok({ access_token: "fresh" }));
    vi.stubGlobal("fetch", f);
    await ownerMailbox(opts);
    expect(String(f.mock.calls[0]![0])).toContain("order=updated_at.desc");
  });

  // Every one of these is an ordinary day, not an error: a booking still
  // happened, and the caller has to be able to carry on without a receipt.
  it("is null when nothing is configured, and asks nobody anything", async () => {
    const f = vi.fn(async () => ok([]));
    vi.stubGlobal("fetch", f);
    expect(await ownerMailbox({ ...opts, tokenKey: "" })).toBeNull();
    expect(await ownerMailbox({ ...opts, service: "" })).toBeNull();
    expect(await ownerMailbox({ ...opts, clients: { ...CLIENTS, clientId: "" } })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  it("is null when the user has never connected Google", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok([])));
    expect(await ownerMailbox(opts)).toBeNull();
  });
  it("is null when the stored token cannot be decrypted, rather than throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok([{ email: "a@b.com", token_enc: "not-a-cipher" }])));
    expect(await ownerMailbox(opts)).toBeNull();
  });
  it("is null when the grant has been revoked", async () => {
    const packed = await encrypt("1//dead", KEY);
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      String(url).includes("google_tokens")
        ? ok([{ email: "a@b.com", token_enc: packed }])
        : bad({ error: "invalid_grant" })));
    expect(await ownerMailbox(opts)).toBeNull();
  });
  it("is null when the network itself fails, rather than throwing through the caller", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await ownerMailbox(opts)).toBeNull();
  });
  // It reads one row and sends nothing anywhere: no write to the live project
  // can come out of this path, which is the whole reason it is allowed to see
  // the live project at all.
  it("never writes to the live project", async () => {
    const packed = await encrypt("1//good", KEY);
    const f = vi.fn(async (url: string) =>
      String(url).includes("google_tokens") ? ok([{ email: "a@b.com", token_enc: packed }]) : ok({ access_token: "fresh" }));
    vi.stubGlobal("fetch", f);
    await ownerMailbox(opts);
    for (const call of f.mock.calls) {
      const method = ((call[1] as RequestInit | undefined)?.method || "GET").toUpperCase();
      if (String(call[0]).includes("live.test")) expect(method).toBe("GET");
    }
  });
});

describe("sendRaw", () => {
  it("hands the message to Gmail and says it went", async () => {
    const f = vi.fn(async () => ok({ id: "m1" }));
    vi.stubGlobal("fetch", f);
    expect(await sendRaw("at", "cmF3")).toBe(true);
    expect(String(f.mock.calls[0]![0])).toContain("messages/send");
    expect(JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ raw: "cmF3" });
  });
  it("says it did not go, rather than throwing, when Gmail refuses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => bad({}, 403)));
    expect(await sendRaw("at", "cmF3")).toBe(false);
  });
  it("says it did not go when the network is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await sendRaw("at", "cmF3")).toBe(false);
  });
});
