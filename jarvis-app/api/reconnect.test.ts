// ONE-TAP RECONNECT, END TO END OVER A FAKE GOOGLE AND A FAKE SUPABASE (Foundation Fix Spec 4).
// The real api/google.ts handler runs. Each acceptance criterion and each row of the reconnect matrix
// is named where it is held: wrong account at the chooser, consent closed, Google denied, mid-flow kill and resume.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import handler from "./google";
import { encrypt } from "./_google";
import { signState, verifyState, STATE_TTL_MS } from "../src/connections/google/reconnect";

const KEY = Buffer.alloc(32, 7).toString("base64");
const USER = "user-1";
const DAVE = "dave@gmail.com";
const MODIFY = "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send";
const res = (body: unknown, status = 200): Response => ({ ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body }) as Response;

type Call = { url: string; method: string; body: string };
interface World {
  calls: Call[];
  /** What Google's token endpoint answers for the authorization code. */
  code: () => Response;
  /** ... and for a refresh. */
  refresh: () => Response;
  /** The address the mailbox read answers with. */
  profile: () => Response;
  /** The stored sign-in for DAVE, or null. */
  stored: { state?: string } | null;
  /** false = migration 0058 not applied. */
  table: boolean;
  attempts: Array<Record<string, unknown>>;
}
let w: World;

async function stub(over: Partial<World> = {}): Promise<World> {
  const enc = await encrypt("1//stored", KEY);
  w = {
    calls: [],
    code: () => res({ access_token: "ya29.code", refresh_token: "1//new", expires_in: 3599, scope: MODIFY }),
    refresh: () => res({ access_token: "ya29.fresh", expires_in: 3599, scope: MODIFY }),
    profile: () => res({ emailAddress: DAVE }),
    stored: null,
    table: true,
    attempts: [],
    ...over,
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? init.body : init?.body ? String(init.body) : "";
    const method = init?.method ?? "GET";
    w.calls.push({ url, method, body });
    const u = new URL(url, "https://x.test");
    if (url.includes("/auth/v1/user")) return res({ id: USER });
    if (url.includes("oauth2.googleapis.com/revoke")) return res({});
    if (url.includes("oauth2.googleapis.com/token")) return new URLSearchParams(body).get("grant_type") === "authorization_code" ? w.code() : w.refresh();
    if (url.includes("gmail.googleapis.com")) return w.profile();
    if (url.includes("/rest/v1/google_reconnect_attempt")) {
      if (!w.table) return res({ message: "relation does not exist" }, 404);
      if (method === "POST") { w.attempts.push(JSON.parse(body) as Record<string, unknown>); return res({}, 201); }
      if (method === "PATCH") {
        const patch = JSON.parse(body) as Record<string, unknown>;
        const id = u.searchParams.get("id")?.replace("eq.", "");
        const onlyStarted = u.searchParams.get("status") === "eq.started";
        const hit = w.attempts.filter((a) => (!id || a.id === id) && (!onlyStarted || (a.status ?? "started") === "started") && (id || (a.user_id && a.email)));
        for (const a of hit) Object.assign(a, patch);
        return res(hit.map((a) => ({ id: a.id })));
      }
      const rows = w.attempts.map((a) => ({ id: a.id, status: a.status ?? "started", expires_at: a.expires_at, completed_at: a.completed_at ?? null, outcome: a.outcome ?? null }));
      return res(rows.slice(-1));
    }
    if (url.includes("/rest/v1/google_tokens")) {
      if (method === "POST") return res({}, 201);
      return w.stored ? res([{ token_enc: enc, email: DAVE, ...w.stored }]) : res([]);
    }
    if (url.includes("/rest/v1/email_account?")) return res([{ id: "acct-1" }]);
    if (url.includes("/rest/v1/rpc/google_")) return res({}, 404); // migration 0057 not applied: the legacy paths are served
    if (url.includes("/rest/v1/rpc/")) return res({ ok: true });
    return res({}, 404);
  }));
  return w;
}

const post = (body: unknown) => handler(new Request("https://x.test/api/google", { method: "POST", headers: { authorization: "Bearer jwt", "content-type": "application/json" }, body: JSON.stringify(body) }));
const json = async (r: Response) => (await r.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const start = async (email = DAVE) => json(await post({ reconnectStart: email }));
const stateFor = async (o: Partial<{ a: string; u: string; e: string; x: number }> = {}) => signState({ a: "att-1", u: USER, e: DAVE, x: Date.now() + 5 * 60e3, n: "n", ...o }, KEY);
const tokenCalls = () => w.calls.filter((c) => c.url.includes("oauth2.googleapis.com/token"));
const stored = () => w.calls.filter((c) => c.url.includes("/rest/v1/google_tokens") && c.method === "POST");
const mailWrites = () => w.calls.filter((c) => /outbox|email_draft|\/messages\/send|\/drafts|modify/.test(c.url) && c.method !== "GET");

beforeEach(() => {
  process.env.VITE_SUPABASE_URL = "https://supa.test";
  process.env.VITE_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.GOOGLE_TOKEN_KEY = KEY;
  process.env.GOOGLE_CLIENT_ID = "cid";
  process.env.GOOGLE_CLIENT_SECRET = "csecret";
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("starting a reconnect: the server owns the attempt", () => {
  it("persists the attempt and returns a signed state for exactly that account, good for ten minutes at most", async () => {
    await stub({ stored: { state: "DEAD" } });
    const j = await start();
    expect(j.loginHint).toBe(DAVE);
    expect(j.expiresAt - Date.now()).toBeLessThanOrEqual(STATE_TTL_MS);
    expect(w.attempts).toHaveLength(1);
    expect(w.attempts[0]).toMatchObject({ user_id: USER, email: DAVE });
    const chk = await verifyState(j.state, KEY, { userId: USER, nowMs: Date.now() });
    expect(chk.ok && chk.payload).toMatchObject({ u: USER, e: DAVE, a: j.attemptId });
  });

  it("one live link per account: a second tap supersedes the first", async () => {
    await stub({ stored: {} });
    await start();
    await start();
    expect(w.attempts.filter((a) => (a.status ?? "started") === "started")).toHaveLength(1);
    expect(w.attempts.filter((a) => a.status === "superseded")).toHaveLength(1);
  });

  it("refuses an account this person does not have", async () => {
    await stub({ stored: null });
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => String(url).includes("/auth/v1/user") ? res({ id: USER }) : res([]));
    expect((await post({ reconnectStart: "stranger@gmail.com" })).status).toBe(410);
  });

  it("works before migration 0058 exists: the state is signed and still expires", async () => {
    await stub({ stored: {}, table: false });
    const j = await start();
    expect((await verifyState(j.state, KEY, { userId: USER, nowMs: Date.now() })).ok).toBe(true);
    expect((await verifyState(j.state, KEY, { userId: USER, nowMs: Date.now() + STATE_TTL_MS + 1000 })).ok).toBe(false);
  });
});

describe("the state is verified BEFORE any code is exchanged", () => {
  it.each([
    ["no valid signature", async () => (await stateFor()).slice(0, -3) + "AAA"],
    ["expired", async () => stateFor({ x: Date.now() - 1000 })],
    ["another person's", async () => stateFor({ u: "user-2" })],
    ["a lifetime beyond ten minutes", async () => stateFor({ x: Date.now() + 60 * 60e3 })],
    ["garbage", async () => "not-a-state"],
  ])("a code with a state that is %s is never sent to Google", async (_n, mk) => {
    await stub({ stored: {} });
    const r = await post({ code: "4/abc", state: await mk() });
    expect(r.status).toBe(400);
    expect(tokenCalls()).toHaveLength(0);
    expect(stored()).toHaveLength(0);
  });

  it("an attempt is single use: the same state a second time is refused, without a second exchange", async () => {
    await stub({ stored: {} });
    const { state } = await start();
    expect((await post({ code: "4/a", state })).status).toBe(200);
    const calls = tokenCalls().length;
    const again = await post({ code: "4/a", state });
    expect(again.status).toBe(409);
    expect((await json(again)).code).toBe("RECONNECT_ATTEMPT_USED");
    expect(tokenCalls().length).toBe(calls);
  });
});

describe("AC1: the happy path runs the six checks in order and stores last", () => {
  it("exchange, identity read, a real refresh, a real mailbox read, then the durable store; then every consumer is probed", async () => {
    await stub({ stored: {} });
    const { state } = await start();
    const r = await post({ code: "4/good", state });
    const j = await json(r);
    expect(r.status).toBe(200);
    expect(j).toMatchObject({ email: DAVE, remembered: true, accessToken: "ya29.fresh", reconnect: { status: "verified" } });
    const order = w.calls.map((c) => (c.url.includes("oauth2.googleapis.com/token") ? "token:" + new URLSearchParams(c.body).get("grant_type") : c.url.includes("gmail.googleapis.com") ? "mailbox" : c.url.includes("/rest/v1/google_tokens") && c.method === "POST" ? "STORE" : "")).filter(Boolean);
    const firstStore = order.indexOf("STORE");
    expect(order.slice(0, 4)).toEqual(["token:authorization_code", "mailbox", "token:refresh_token", "mailbox"]);
    expect(firstStore).toBeGreaterThan(3);
    expect(w.attempts[0]).toMatchObject({ status: "verified" });
  });

  it("the harness: app and status prove green, the CLI and the legacy path are reported GATED, never green", async () => {
    await stub({ stored: {} });
    const { state } = await start();
    const j = await json(await post({ code: "4/good", state }));
    expect(j.reconnect.propagation).toMatchObject({ app: { state: "ok" }, status: { state: "ok" }, cli: { state: "gated" }, legacy: { state: "gated" } });
    // The status endpoint's recorded proof is replaced, so it cannot serve the old pending_auth for five minutes.
    expect(w.calls.some((c) => c.url.includes("email_account_health_record"))).toBe(true);
  });

  it("reconnecting alone sends nothing: no outbox, no draft, no message write", async () => {
    await stub({ stored: {} });
    const { state } = await start();
    await post({ code: "4/good", state });
    expect(mailWrites()).toEqual([]);
  });

  it("no token, code or secret is in any response", async () => {
    await stub({ stored: {} });
    const { state } = await start();
    const j = JSON.stringify(await json(await post({ code: "4/good", state })));
    expect(j).not.toMatch(/1\/\/new|1\/\/stored|csecret|4\/good/);
  });
});

describe("AC2: the wrong Google account at the chooser", () => {
  it("is refused with both addresses, stores nothing, imports nothing, and revokes what Google just issued", async () => {
    await stub({ stored: {}, profile: () => res({ emailAddress: "other@gmail.com" }) });
    const { state } = await start();
    const r = await post({ code: "4/wrong", state });
    const j = await json(r);
    expect(r.status).toBe(409);
    expect(j).toMatchObject({ code: "RECONNECT_WRONG_ACCOUNT", reconnect: { status: "wrong_account", intended: DAVE, selected: "other@gmail.com" } });
    expect(j.accessToken).toBeUndefined();
    expect(stored()).toHaveLength(0);
    expect(w.calls.some((c) => c.url.includes("/rest/v1/rpc/") && !c.url.includes("google_"))).toBe(false);
    expect(mailWrites()).toEqual([]);
    expect(w.calls.some((c) => c.url.includes("oauth2.googleapis.com/revoke"))).toBe(true);
    expect(w.attempts[0]).toMatchObject({ status: "wrong_account", outcome: { intended: DAVE, selected: "other@gmail.com" } });
  });

  it("a case difference is the same account", async () => {
    await stub({ stored: {}, profile: () => res({ emailAddress: "Dave@Gmail.com" }) });
    const { state } = await start();
    expect((await post({ code: "4/x", state })).status).toBe(200);
  });
});

describe("no usable refresh token: never green, never a loop", () => {
  it("access granted but nothing to renew with, and the old grant is dead: one more step, nothing stored", async () => {
    await stub({ stored: { state: "DEAD" }, code: () => res({ access_token: "ya29.code", expires_in: 3599, scope: MODIFY }) });
    const { state } = await start();
    const r = await post({ code: "4/x", state });
    expect(r.status).toBe(409);
    expect(await json(r)).toMatchObject({ code: "RECONNECT_NEEDS_STEP", reconnect: { status: "needs_step" } });
    expect(stored()).toHaveLength(0);
  });

  it("access granted with no new token but a healthy stored one: renewal is proven with the stored token and it is green", async () => {
    await stub({ stored: { state: "VALID" }, code: () => res({ access_token: "ya29.code", expires_in: 3599, scope: MODIFY }) });
    const { state } = await start();
    const r = await post({ code: "4/x", state });
    expect(r.status).toBe(200);
    expect(tokenCalls().some((c) => new URLSearchParams(c.body).get("refresh_token") === "1//stored")).toBe(true);
  });

  it("permissions that do not cover mail are refused before anything else", async () => {
    await stub({ stored: {}, code: () => res({ access_token: "ya29.code", refresh_token: "1//new", expires_in: 3599, scope: "openid email" }) });
    const { state } = await start();
    const r = await post({ code: "4/x", state });
    expect(await json(r)).toMatchObject({ code: "RECONNECT_SCOPE_MISSING" });
    expect(stored()).toHaveLength(0);
  });

  it("a token that does not refresh is not a reconnect", async () => {
    await stub({ stored: {}, refresh: () => res({ error: "invalid_grant" }, 400) });
    const { state } = await start();
    const r = await post({ code: "4/x", state });
    expect((await json(r)).reconnect.status).toBe("unverified");
    expect(stored()).toHaveLength(0);
  });

  it("a mailbox that cannot be read is not a reconnect", async () => {
    let reads = 0;
    // The identity read (first) answers; the proof read after the real refresh (second) does not.
    await stub({ stored: {}, profile: () => (++reads === 1 ? res({ emailAddress: DAVE }) : res({}, 503)) });
    const { state } = await start();
    const r = await post({ code: "4/x", state });
    expect(r.status).toBe(502);
    expect(stored()).toHaveLength(0);
  });
});

describe("the reconnect matrix: closed, denied, killed", () => {
  it("consent closed without completing is recorded as cancelled and says nothing", async () => {
    await stub({ stored: {} });
    const { state } = await start();
    const r = await post({ reconnectReport: { state, outcome: "cancelled" } });
    expect(r.status).toBe(200);
    expect(w.attempts[0]).toMatchObject({ status: "cancelled" });
    expect(tokenCalls()).toHaveLength(0);
  });

  it("Google denying the flow is recorded WITH its reason, and is not the same as closing it", async () => {
    await stub({ stored: {} });
    const { state } = await start();
    await post({ reconnectReport: { state, outcome: "denied", reason: "admin_policy_enforced" } });
    expect(w.attempts[0]).toMatchObject({ status: "denied", outcome: { reason: "admin_policy_enforced" } });
  });

  it("a report with a state that is not ours changes nothing", async () => {
    await stub({ stored: {} });
    await start();
    await post({ reconnectReport: { state: await stateFor({ u: "user-2", a: String(w.attempts[0]!.id) }), outcome: "cancelled" } });
    expect((w.attempts[0]!.status ?? "started")).toBe("started");
  });

  it("an app killed mid-flow: the server still has the attempt, and says so honestly on reopen, never green", async () => {
    await stub({ stored: {} });
    await start();
    const open = await json(await post({ reconnectStatus: DAVE }));
    expect(open.status).toBe("started");
    // Time passes with no callback.
    w.attempts[0]!.expires_at = new Date(Date.now() - 1000).toISOString();
    const later = await json(await post({ reconnectStatus: DAVE }));
    expect(later.status).toBe("expired");
    expect(w.attempts[0]).toMatchObject({ status: "expired" });
  });

  it("a completed attempt reads verified, and the harness can be run again on demand", async () => {
    await stub({ stored: {} });
    const { state } = await start();
    await post({ code: "4/good", state });
    const j = await json(await post({ reconnectStatus: DAVE, probe: true }));
    expect(j.status).toBe("verified");
    expect(j.propagation).toMatchObject({ app: { state: "ok" }, cli: { state: "gated" } });
  });

  it("with no attempt table the status says it does not know rather than guessing", async () => {
    await stub({ stored: {}, table: false });
    expect(await json(await post({ reconnectStatus: DAVE }))).toMatchObject({ persisted: false, status: "none" });
  });
});

describe("the ordinary add-account exchange is unchanged", () => {
  it("a code with no state still connects whoever signed in, exactly as before", async () => {
    await stub({ stored: null });
    const r = await post({ code: "4/new" });
    expect(r.status).toBe(200);
    expect((await json(r)).email).toBe(DAVE);
  });
});
