import { describe, it, expect, vi } from "vitest";
import { serverBroker, googleFailure, interactiveHelps, SERVER_CODES, SESSION_CODES, GoogleSessionError, type GoogleFailureCode } from "./broker";
import { GOOGLE_CODES, googleFailure as serverFailure } from "../../../api/_google";

// The two ways of getting a code are the browser's and the phone's, and
// neither runs here: what these tests hold is what the broker does with the
// server's answer to the exchange.
vi.mock("./gis", () => ({ requestGoogleCode: async () => "code-1" }));
vi.mock("./nativeAuth", () => ({
  nativeGoogleAvailable: () => false,
  requestGoogleCodeNative: async () => ({ code: "code-1", verifier: "v", redirectUri: "r" }),
}));

// The silent path is the whole feature: a stored sign-in mints a token with
// no user interaction. What it answers when it cannot is the second half
// (2026-09-29): a typed failure that says WHY, never a bare null, because the
// caller decides from the cause whether Google's chooser may open at all.

type Fetch = NonNullable<Parameters<typeof serverBroker>[1]>;
const fetchReturning = (status: number, body: unknown) =>
  (async () => ({ ok: status < 400, status, json: async () => body })) as unknown as Fetch;
const NOW = 1_000_000;
// auth null means no JARVIS session at all.
const broker = (f: Fetch, auth: string | null = "supa-tok") => serverBroker(() => auth ?? undefined, f, () => NOW);

describe("serverBroker silent", () => {
  it("returns the token, the address, an expiry from expires_in, and remembered", async () => {
    const r = await broker(fetchReturning(200, { accessToken: "fresh", email: "a@x.com", expiresIn: 1800, remembered: true, scope: "s1 s2" })).silent!("a@x.com");
    expect(r).toEqual({ ok: true, token: "fresh", email: "a@x.com", expiresAt: NOW + 1800e3, remembered: true, scope: "s1 s2", status: 200 });
  });

  it("assumes an hour when the server does not say how long", async () => {
    const r = await broker(fetchReturning(200, { accessToken: "fresh" })).silent!("a@x.com");
    expect(r).toMatchObject({ ok: true, email: "a@x.com", expiresAt: NOW + 3600e3 });
  });

  it("carries each of the four refresh causes as its own code, message and retryability", async () => {
    const cases: [number, GoogleFailureCode, boolean][] = [
      [410, "GOOGLE_NO_STORED_SIGNIN", false],
      [410, "GOOGLE_STORED_SIGNIN_UNREADABLE", false],
      [410, "GOOGLE_SIGNIN_REVOKED", false],
      [502, "GOOGLE_REFRESH_UNAVAILABLE", true],
    ];
    for (const [status, code, retryable] of cases) {
      const sent = serverFailure(code as never, "a@x.com");
      const r = await broker(fetchReturning(status, { error: sent.message, code, message: sent.message, retryable })).silent!("a@x.com");
      expect(r).toEqual({ ok: false, code, message: sent.message, retryable, status });
    }
  });

  it("a dead network is its own retryable failure, not a null", async () => {
    const dead = (async () => { throw new Error("offline"); }) as unknown as Fetch;
    const r = await broker(dead).silent!("a@x.com");
    expect(r).toMatchObject({ ok: false, code: "GOOGLE_NETWORK_ERROR", retryable: true, status: 0 });
    expect(r.ok ? "" : r.message).not.toContain("offline"); // the browser's words never surface
  });

  it("an expired JARVIS sign-in is its own failure, and without one the server is not even called", async () => {
    let called = 0;
    const counting = (async () => { called++; return { ok: true, status: 200, json: async () => ({}) }; }) as unknown as Fetch;
    const none = await broker(counting, null).silent!("a@x.com");
    expect(none).toMatchObject({ ok: false, code: "GOOGLE_AUTH_EXPIRED", retryable: false, status: 401 });
    expect(called).toBe(0);
    const expired = await broker(fetchReturning(401, {})).silent!("a@x.com");
    expect(expired).toMatchObject({ ok: false, code: "GOOGLE_AUTH_EXPIRED" });
  });

  it("a storage failure on the server stays a storage failure", async () => {
    const r = await broker(fetchReturning(503, { code: "GOOGLE_STORAGE_FAILURE" })).silent!("a@x.com");
    expect(r).toMatchObject({ ok: false, code: "GOOGLE_STORAGE_FAILURE", retryable: true, status: 503 });
  });

  it("an answer with no code and no token is a temporary Google problem, never a revocation", async () => {
    const r = await broker(fetchReturning(500, { error: "boom" })).silent!("a@x.com");
    expect(r).toMatchObject({ ok: false, code: "GOOGLE_REFRESH_UNAVAILABLE", retryable: true });
  });

  it("supplies the handoff wording itself when a response has a code and no message", async () => {
    const r = await broker(fetchReturning(410, { code: "GOOGLE_SIGNIN_REVOKED" })).silent!("a@x.com");
    expect(r.ok ? "" : r.message).toBe("Google revoked this sign-in. Reconnect a@x.com.");
  });
});

describe("failure wording and codes", () => {
  it("the client's fallback wording is the server's, word for word, for every server code", () => {
    for (const code of GOOGLE_CODES) {
      const server = serverFailure(code, "a@x.com");
      const client = googleFailure(code, "a@x.com");
      expect(client.message).toBe(server.message);
      expect(client.retryable).toBe(server.retryable);
    }
  });

  it("the client knows every code the server can send, and no two lists disagree", () => {
    expect([...SERVER_CODES].sort()).toEqual([...GOOGLE_CODES].sort());
    for (const c of SESSION_CODES) expect(SERVER_CODES as readonly string[]).not.toContain(c);
  });

  it("the handoff messages are exactly as ruled", () => {
    expect(serverFailure("GOOGLE_NO_STORED_SIGNIN", "d@x.com").message).toBe("Google isn't set to stay signed in. Reconnect d@x.com.");
    expect(serverFailure("GOOGLE_STORED_SIGNIN_UNREADABLE", "d@x.com").message).toBe("The saved Google sign-in couldn't be opened. Reconnect d@x.com.");
    expect(serverFailure("GOOGLE_SIGNIN_REVOKED", "d@x.com").message).toBe("Google revoked this sign-in. Reconnect d@x.com.");
    expect(serverFailure("GOOGLE_REFRESH_UNAVAILABLE", "d@x.com").message).toBe("Google couldn't refresh right now. Try again.");
  });

  it("only a sign-in that is gone, or cannot write, is answered by Google's chooser", () => {
    const opens = [...SERVER_CODES, ...SESSION_CODES].filter(interactiveHelps);
    expect(opens.sort()).toEqual([
      "GOOGLE_MISSING_SCOPE", "GOOGLE_NO_STORED_SIGNIN", "GOOGLE_SIGNIN_REVOKED", "GOOGLE_STORED_SIGNIN_UNREADABLE",
    ]);
    // The temporary ones never open it.
    for (const c of ["GOOGLE_NETWORK_ERROR", "GOOGLE_REFRESH_UNAVAILABLE", "GOOGLE_STORAGE_FAILURE", "GOOGLE_AUTH_EXPIRED"] as const) {
      expect(interactiveHelps(c)).toBe(false);
    }
  });
});

describe("serverBroker authorize", () => {
  it("remembered is true only when the server says it stored the sign-in", async () => {
    const stored = await broker(fetchReturning(200, { accessToken: "t", email: "a@x.com", expiresIn: 600, remembered: true, scope: "s" })).authorize({});
    expect(stored).toEqual({ token: "t", email: "a@x.com", expiresAt: NOW + 600e3, remembered: true, scope: "s" });
    // A server that never said (an older deploy) is not taken on trust.
    const silentServer = await broker(fetchReturning(200, { accessToken: "t", email: "a@x.com" })).authorize({});
    expect(silentServer.remembered).toBe(false);
  });

  it("a failed store comes back remembered:false with the reason beside it", async () => {
    const sent = serverFailure("GOOGLE_STORAGE_FAILURE", "a@x.com");
    const r = await broker(fetchReturning(200, {
      accessToken: "t", email: "a@x.com", remembered: false, code: "GOOGLE_STORAGE_FAILURE", message: sent.message, retryable: true,
    })).authorize({});
    expect(r.remembered).toBe(false);
    expect(r.token).toBe("t"); // the connection itself worked
    expect(r.warning).toMatchObject({ code: "GOOGLE_STORAGE_FAILURE", message: sent.message, retryable: true });
  });

  it("a coded refusal throws with its code; the exchange's own errors keep their words", async () => {
    await expect(broker(fetchReturning(503, { code: "GOOGLE_NETWORK_ERROR" })).authorize({}))
      .rejects.toMatchObject({ code: "GOOGLE_NETWORK_ERROR", retryable: true });
    await expect(broker(fetchReturning(400, { error: "invalid_grant" })).authorize({})).rejects.toThrow("invalid_grant");
    await expect(broker(fetchReturning(200, {}), null).authorize({})).rejects.toMatchObject({ code: "GOOGLE_AUTH_EXPIRED" });
  });
});

describe("serverBroker forget and errors", () => {
  it("forget swallows failures: disconnect must never get stuck on the network", async () => {
    const dead = (async () => { throw new Error("offline"); }) as unknown as Fetch;
    await expect(broker(dead).forget!("a@x.com")).resolves.toBeUndefined();
  });

  it("GoogleSessionError carries the same facts as the result", () => {
    const e = new GoogleSessionError(googleFailure("GOOGLE_NETWORK_ERROR", "a@x.com", 0));
    expect(e).toMatchObject({ code: "GOOGLE_NETWORK_ERROR", retryable: true, status: 0 });
    expect(e.message).toContain("Couldn't reach Google");
  });
});
