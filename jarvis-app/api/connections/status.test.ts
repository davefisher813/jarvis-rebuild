// GET /api/connections/status, END TO END OVER A FAKE GOOGLE AND A FAKE
// SUPABASE (Foundation Fix Spec 1). The real handler runs; the network is a
// recorder. What is held here: the status is PROVEN (a real refresh and a named
// read), the answer never carries a token, a revoked grant reads as pending_auth
// with its code, a transient failure never does, and a recorded proof is reused
// inside five minutes unless the caller forces a fresh one.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import handler from "./status";
import { encrypt } from "../_google";

const KEY = Buffer.alloc(32, 7).toString("base64");
const USER = "user-1";
const DAVE = "dave@gmail.com";

type Call = { url: string; method: string; body: Record<string, unknown> | null };
let calls: Call[] = [];
const res = (body: unknown, status = 200): Response => ({ ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body }) as Response;

interface World {
  tokens: Record<string, string>;
  token: () => Response | "throw";
  profile: () => Response | "throw";
  rows: Array<Record<string, unknown>>;
  /** false = migration 0056 not applied: the column select is refused. */
  healthColumns: boolean;
}

async function stub(w: Partial<World> = {}): Promise<World> {
  const enc = await encrypt("1//refresh", KEY);
  const world: World = {
    tokens: { [DAVE]: enc },
    token: () => res({ access_token: "ya29.secret", expires_in: 3599, scope: "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send" }),
    profile: () => res({ emailAddress: DAVE }),
    rows: [{ address: DAVE, state: "connected", last_sync_at: new Date(Date.now() - 600e3).toISOString(), connection_health: null, connection_health_at: null }],
    healthColumns: true,
    ...w,
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ url, method: init?.method ?? "GET", body });
    const u = new URL(url, "https://x.test");
    if (url.includes("/auth/v1/user")) return res({ id: USER });
    if (url.includes("oauth2.googleapis.com/token")) { const t = world.token(); if (t === "throw") throw new Error("offline"); return t; }
    if (url.includes("gmail.googleapis.com/gmail/v1/users/me/profile")) { const p = world.profile(); if (p === "throw") throw new Error("offline"); return p; }
    if (url.includes("/rest/v1/google_tokens")) {
      const email = u.searchParams.get("email")?.replace("eq.", "");
      if (email) return res(world.tokens[email] ? [{ token_enc: world.tokens[email] }] : []);
      return res(Object.keys(world.tokens).map((e) => ({ email: e })));
    }
    if (url.includes("/rest/v1/email_account?")) {
      const select = u.searchParams.get("select") ?? "";
      if (select.includes("connection_health") && !world.healthColumns) return res({ message: "column does not exist" }, 400);
      return res(world.rows.map((r) => (world.healthColumns ? r : { address: r.address, state: r.state, last_sync_at: r.last_sync_at })));
    }
    if (url.includes("/rest/v1/rpc/email_account_health_record")) return world.healthColumns ? res({ recorded: true }) : res({}, 404);
    return res({}, 404);
  }));
  return world;
}

const get = (qs = "") => handler(new Request("https://x.test/api/connections/status" + qs, { method: "GET", headers: { authorization: "Bearer jwt" } }));
const googleCalls = () => calls.filter((c) => c.url.includes("oauth2.googleapis.com") || c.url.includes("gmail.googleapis.com"));
const recorded = () => calls.filter((c) => c.url.includes("email_account_health_record")).map((c) => c.body!);

beforeEach(() => {
  calls = [];
  process.env.VITE_SUPABASE_URL = "https://supa.test";
  process.env.VITE_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.GOOGLE_TOKEN_KEY = KEY;
  process.env.GOOGLE_CLIENT_ID = "cid";
  process.env.GOOGLE_CLIENT_SECRET = "csecret";
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("GET /api/connections/status", () => {
  it("proves a healthy account with a real refresh and the named read, and never returns a token", async () => {
    await stub();
    const r = await get();
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toMatch(/ya29|1\/\/refresh|csecret|token_enc/);
    const j = JSON.parse(text) as { accounts: Array<Record<string, unknown>> };
    expect(j.accounts).toHaveLength(1);
    expect(j.accounts[0]).toMatchObject({ email: DAVE, auth_state: "valid", state: "connected", lastError: null, receipt: { operation: "token_refresh+gmail.users.getProfile", ok: true, identityMatched: true }, sendReady: { ready: true } });
    expect(googleCalls().map((c) => c.method + " " + new URL(c.url).pathname)).toEqual(["POST /token", "GET /gmail/v1/users/me/profile"]);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("AC1: a revoked grant reports revoked with invalid_grant, and no surface can read it as connected", async () => {
    await stub({ token: () => res({ error: "invalid_grant" }, 400) });
    const j = (await (await get()).json()) as { accounts: Array<Record<string, unknown>> };
    expect(j.accounts[0]).toMatchObject({ auth_state: "revoked", state: "pending_auth", lastError: "invalid_grant" });
    expect(googleCalls().some((c) => c.url.includes("gmail.googleapis.com"))).toBe(false);
  });

  it("AC2: after a reconnect the next proof flips to valid with a fresh lastSuccessfulRefreshAt", async () => {
    const w = await stub({ token: () => res({ error: "invalid_grant" }, 400) });
    await get();
    w.token = () => res({ access_token: "ya29.new", expires_in: 3599, scope: "gmail.send" });
    const j = (await (await get("?refresh=1")).json()) as { accounts: Array<{ auth_state: string; lastSuccessfulRefreshAt: string; state: string }> };
    expect(j.accounts[0]).toMatchObject({ auth_state: "valid", state: "connected" });
    expect(Date.now() - new Date(j.accounts[0]!.lastSuccessfulRefreshAt).getTime()).toBeLessThan(5000);
  });

  it("a network failure is a transient warning and never a reconnect", async () => {
    await stub({ token: () => "throw" });
    const j = (await (await get()).json()) as { accounts: Array<Record<string, unknown>> };
    expect(j.accounts[0]).toMatchObject({ auth_state: "unknown", state: "warning", transient: "service_unavailable" });
    expect(j.accounts[0]!.state).not.toBe("pending_auth");
  });

  it("a mailbox that answers as someone else is an error, not a connection", async () => {
    await stub({ profile: () => res({ emailAddress: "other@gmail.com" }) });
    const j = (await (await get()).json()) as { accounts: Array<Record<string, unknown>> };
    expect(j.accounts[0]).toMatchObject({ state: "error", lastError: "identity_mismatch" });
  });

  it("a credential that refreshes but whose read is throttled is demoted, not green", async () => {
    await stub({ profile: () => res({}, 429) });
    const j = (await (await get()).json()) as { accounts: Array<Record<string, unknown>> };
    expect(j.accounts[0]).toMatchObject({ auth_state: "valid", state: "warning", transient: "temporarily_limited" });
  });

  it("a mailbox row whose sign-in is gone (deleted on invalid_grant) is reported pending_auth, not skipped", async () => {
    await stub({ tokens: {} });
    const j = (await (await get()).json()) as { accounts: Array<Record<string, unknown>> };
    expect(j.accounts[0]).toMatchObject({ email: DAVE, state: "pending_auth", lastError: "no_stored_signin" });
    expect(googleCalls()).toHaveLength(0);
  });

  it("a mailbox the person forgot (disconnected) is not listed", async () => {
    await stub({ tokens: {}, rows: [{ address: DAVE, state: "disconnected", last_sync_at: null, connection_health: null, connection_health_at: null }] });
    expect(((await (await get()).json()) as { accounts: unknown[] }).accounts).toHaveLength(0);
  });

  it("records the sanitized proof, and reuses it inside five minutes without going back to Google", async () => {
    const w = await stub();
    await get();
    expect(recorded()).toHaveLength(1);
    const health = recorded()[0]!.p_health as Record<string, unknown>;
    expect(JSON.stringify(health)).not.toMatch(/ya29|1\/\/refresh|csecret|access_token|refresh_token|token_enc/);
    w.rows = [{ ...w.rows[0], connection_health: health, connection_health_at: new Date(Date.now() - 60e3).toISOString() }];
    calls = [];
    const again = (await (await get()).json()) as { accounts: Array<Record<string, unknown>> };
    expect(googleCalls()).toHaveLength(0);
    expect(again.accounts[0]).toMatchObject({ state: "connected" });
    // ...and ?refresh=1 proves it again regardless.
    await get("?refresh=1");
    expect(googleCalls().length).toBeGreaterThan(0);
  });

  it("a recorded proof older than five minutes is proven again", async () => {
    const w = await stub();
    await get();
    const health = recorded()[0]!.p_health;
    w.rows = [{ ...w.rows[0], connection_health: health, connection_health_at: new Date(Date.now() - 6 * 60e3).toISOString() }];
    calls = [];
    await get();
    expect(googleCalls().length).toBeGreaterThan(0);
  });

  it("works before migration 0056 is applied: proven live, nothing recorded", async () => {
    await stub({ healthColumns: false });
    const r = await get();
    expect(r.status).toBe(200);
    expect(((await r.json()) as { accounts: Array<{ state: string }> }).accounts[0]!.state).toBe("connected");
  });

  it("refuses an unsigned request and any method but GET", async () => {
    await stub();
    expect((await handler(new Request("https://x.test/api/connections/status", { method: "GET" }))).status).toBe(401);
    const post = await handler(new Request("https://x.test/api/connections/status", { method: "POST", headers: { authorization: "Bearer jwt" } }));
    expect(post.status).toBe(405);
  });
});
