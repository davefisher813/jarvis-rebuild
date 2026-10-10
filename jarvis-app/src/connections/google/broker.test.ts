// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { serverBroker, googleFailure, interactiveHelps, SERVER_CODES, SESSION_CODES, GoogleSessionError, type GoogleFailureCode } from "./broker";
import { GOOGLE_CODES, googleFailure as serverFailure } from "../../../api/_google";

// The two ways of getting a code are the browser's and the phone's, and
// neither runs here: what these tests hold is what the broker does with the
// server's answer to the exchange.
const gisCalls: string[] = [];
vi.mock("./gis", () => ({ preloadGoogleSignIn: async () => { gisCalls.push("preload"); }, startGoogleCode: async () => { gisCalls.push("start"); return "code-1"; } }));
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

// ONE-TAP RECONNECT AT THE BROKER (Foundation Fix Spec 4): the server's attempt first, its state to Google and back,
// the server's verdict after, and the three ways a flow can end without a token.
import { ReconnectCancelled, ReconnectDenied, ReconnectOutcomeError, readPending } from "./reconnect";

describe("serverBroker authorize, reconnecting", () => {
  const sent: Array<Record<string, unknown>> = [];
  const script = (answers: Array<{ status: number; body: unknown }>): Fetch => (async (_u: string, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const a = answers.shift() ?? { status: 200, body: {} };
    return { ok: a.status < 400, status: a.status, json: async () => a.body };
  }) as unknown as Fetch;

  it("asks the server to start the attempt BEFORE anything opens, takes its state to Google's code step, and sends it back with the code", async () => {
    sent.length = 0; localStorage.clear();
    const b = broker(script([
      { status: 200, body: { state: "rc1.s.s", loginHint: "dave@gmail.com", expiresAt: 1 } },
      { status: 200, body: { accessToken: "tok", email: "dave@gmail.com", expiresIn: 3000, remembered: true, reconnect: { status: "verified" } } },
    ]));
    const r = await b.authorize({ loginHint: "dave@gmail.com", reconnect: "dave@gmail.com" });
    expect(sent[0]).toEqual({ reconnectStart: "dave@gmail.com" });
    expect(sent[1]).toMatchObject({ code: "code-1", state: "rc1.s.s" });
    expect(r).toMatchObject({ token: "tok", email: "dave@gmail.com", remembered: true });
    // Finished: the device has nothing left that says it is waiting on Google.
    expect(readPending()).toBeNull();
  });

  it("a plain connect (no reconnect) never starts an attempt and sends no state", async () => {
    sent.length = 0;
    await broker(script([{ status: 200, body: { accessToken: "t", email: "a@x.com", remembered: true } }])).authorize({});
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ code: "code-1" });
  });

  it("the wrong Google account arrives as an outcome with both addresses, and no token", async () => {
    localStorage.clear();
    const b = broker(script([
      { status: 200, body: { state: "rc1.s.s" } },
      { status: 409, body: { code: "RECONNECT_WRONG_ACCOUNT", reconnect: { status: "wrong_account", intended: "dave@gmail.com", selected: "other@gmail.com" } } },
    ]));
    const err = await b.authorize({ reconnect: "dave@gmail.com" }).catch((e) => e);
    expect(err).toBeInstanceOf(ReconnectOutcomeError);
    expect(err).toMatchObject({ status: "wrong_account", intended: "dave@gmail.com", selected: "other@gmail.com" });
    expect(readPending()).toBeNull();
  });

  it("no usable refresh token is its own outcome", async () => {
    const b = broker(script([{ status: 200, body: { state: "s" } }, { status: 409, body: { reconnect: { status: "needs_step", intended: "dave@gmail.com" } } }]));
    expect(await b.authorize({ reconnect: "dave@gmail.com" }).catch((e) => e)).toMatchObject({ status: "needs_step" });
  });

  it("the server being unable to start an attempt is a typed failure, and Google is never opened", async () => {
    const b = broker(script([{ status: 410, body: { code: "GOOGLE_NO_STORED_SIGNIN", message: "m" } }]));
    expect(await b.authorize({ reconnect: "dave@gmail.com" }).catch((e) => e)).toBeInstanceOf(GoogleSessionError);
  });
});

describe("serverBroker authorize, reconnecting: the window closes or Google refuses", () => {
  it("closing the window is reported to the server as cancelled and leaves nothing pending", async () => {
    vi.resetModules();
    const calls: Array<Record<string, unknown>> = [];
    vi.doMock("./gis", () => ({ preloadGoogleSignIn: async () => {}, startGoogleCode: async () => { const { ReconnectCancelled: C } = await import("./reconnect"); throw new C(); } }));
    vi.doMock("./nativeAuth", () => ({ nativeGoogleAvailable: () => false, requestGoogleCodeNative: async () => ({ code: "", verifier: "", redirectUri: "" }) }));
    const { serverBroker: sb } = await import("./broker");
    const rc = await import("./reconnect");
    localStorage.clear();
    const f = (async (_u: string, init?: RequestInit) => { const b = JSON.parse(String(init?.body)) as Record<string, unknown>; calls.push(b); return { ok: true, status: 200, json: async () => ("reconnectStart" in b ? { state: "rc1.s.s" } : { ok: true }) }; }) as unknown as Fetch;
    const err = await sb(() => "t", f, () => NOW).authorize({ reconnect: "dave@gmail.com" }).catch((e) => e);
    expect(err).toBeInstanceOf(rc.ReconnectCancelled);
    expect(calls[1]).toEqual({ reconnectReport: { state: "rc1.s.s", outcome: "cancelled" } });
    expect(rc.readPending()).toBeNull();
    vi.doUnmock("./gis"); vi.doUnmock("./nativeAuth");
  });

  it("Google refusing is reported with its reason, and is not the same as closing", async () => {
    vi.resetModules();
    const calls: Array<Record<string, unknown>> = [];
    vi.doMock("./gis", () => ({ preloadGoogleSignIn: async () => {}, startGoogleCode: async () => { const { ReconnectDenied: D } = await import("./reconnect"); throw new D("admin_policy_enforced"); } }));
    vi.doMock("./nativeAuth", () => ({ nativeGoogleAvailable: () => false, requestGoogleCodeNative: async () => ({ code: "", verifier: "", redirectUri: "" }) }));
    const { serverBroker: sb } = await import("./broker");
    const rc = await import("./reconnect");
    const f = (async (_u: string, init?: RequestInit) => { const b = JSON.parse(String(init?.body)) as Record<string, unknown>; calls.push(b); return { ok: true, status: 200, json: async () => ("reconnectStart" in b ? { state: "rc1.s.s" } : { ok: true }) }; }) as unknown as Fetch;
    const err = await sb(() => "t", f, () => NOW).authorize({ reconnect: "dave@gmail.com" }).catch((e) => e);
    expect(err).toBeInstanceOf(rc.ReconnectDenied);
    expect(calls[1]).toEqual({ reconnectReport: { state: "rc1.s.s", outcome: "denied", reason: "admin_policy_enforced" } });
    vi.doUnmock("./gis"); vi.doUnmock("./nativeAuth");
    void ReconnectCancelled; void ReconnectDenied;
  });
});

// THE RECONNECT THAT DID NOTHING (2026-10-10). Every network step of a sign-in happens in prepare(), before the tap; launch()
// opens Google synchronously, inside the tap, because a browser refuses a window opened after the tap's handler has awaited.
describe("serverBroker prepare and launch", () => {
  it("prepare does every network step and opens nothing; launch opens Google before it returns", async () => {
    gisCalls.length = 0; localStorage.clear();
    const seen: Array<Record<string, unknown>> = [];
    const f = (async (_u: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      seen.push(body);
      return { ok: true, status: 200, json: async () => ("reconnectStart" in body ? { state: "rc1.s.s", loginHint: "dave@gmail.com" } : { accessToken: "tok", email: "dave@gmail.com", remembered: true, reconnect: { status: "verified" } }) };
    }) as unknown as Fetch;
    const b = serverBroker(() => "t", f, () => NOW);
    const p = await b.prepare!({ reconnect: "dave@gmail.com", loginHint: "dave@gmail.com" });
    expect(seen).toEqual([{ reconnectStart: "dave@gmail.com" }]);
    expect(gisCalls).toEqual(["preload"]);
    expect(p.expiresAt).toBeGreaterThan(NOW);
    const pending = p.launch();
    // Synchronously, before anything is awaited: the window was asked for inside the call.
    expect(gisCalls).toEqual(["preload", "start"]);
    expect(await pending).toMatchObject({ token: "tok", email: "dave@gmail.com" });
    expect(seen[1]).toMatchObject({ code: "code-1", state: "rc1.s.s" });
  });

  it("a window the browser refused leaves nothing pending and is not reported as the person cancelling", async () => {
    vi.resetModules();
    const calls: Array<Record<string, unknown>> = [];
    vi.doMock("./gis", () => ({ preloadGoogleSignIn: async () => {}, startGoogleCode: async () => { const { SignInBlocked: B } = await import("./reconnect"); throw new B(); } }));
    vi.doMock("./nativeAuth", () => ({ nativeGoogleAvailable: () => false, requestGoogleCodeNative: async () => ({ code: "", verifier: "", redirectUri: "" }) }));
    const { serverBroker: sb } = await import("./broker");
    const rc = await import("./reconnect");
    localStorage.clear();
    const f = (async (_u: string, init?: RequestInit) => { const b = JSON.parse(String(init?.body)) as Record<string, unknown>; calls.push(b); return { ok: true, status: 200, json: async () => ("reconnectStart" in b ? { state: "rc1.s.s" } : { ok: true }) }; }) as unknown as Fetch;
    const err = await sb(() => "t", f, () => NOW).authorize({ reconnect: "dave@gmail.com" }).catch((e) => e);
    expect(err).toBeInstanceOf(rc.SignInBlocked);
    expect(err.message).toBe("Google Sign-In Was Blocked · Allow Pop-Ups and Tap Again");
    expect(calls).toHaveLength(1);
    expect(rc.readPending()).toBeNull();
    vi.doUnmock("./gis"); vi.doUnmock("./nativeAuth");
  });
});

