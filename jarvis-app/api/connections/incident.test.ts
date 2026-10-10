// SPEC 3 OVER THE REAL STATUS ROUTE: what becomes an incident, what is told to
// the error sink (once), what is counted as paused, and what must never appear.
// The network is a recorder over a fake Supabase (client_error, outbox_command,
// the stored grants) and a fake Google.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import handler from "./status";
import { encrypt } from "../_google";
import { reportRevocation } from "../_incident";
import { incidentId, ESCALATE_AFTER_FAILURES } from "../../src/connections/incident";

const KEY = Buffer.alloc(32, 7).toString("base64");
const USER = "user-1";
const DAVE = "dave@gmail.com";
const res = (body: unknown, status = 200): Response => ({ ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body }) as Response;

interface World {
  token: () => Response | "throw";
  grant: Record<string, unknown> | null;
  syncAt: string | null;
  sink: Record<string, unknown>[];
  outbox: Array<{ kind: string; subject?: string }>;
  rows: Array<Record<string, unknown>>;
  sinkDown: boolean;
  /** The durable ledger (migration 0064), or null where it is not applied (its functions answer 404). */
  ledger: Array<{ owner: string; address: string; incident: string; kind: string; openedAt: string; state: string; alert: string }> | null;
}
let w: World;

async function stub(over: Partial<World> = {}): Promise<World> {
  const enc = await encrypt("1//refresh", KEY);
  w = {
    token: () => res({ error: "invalid_grant" }, 400),
    grant: null,
    syncAt: new Date(Date.now() - 600e3).toISOString(),
    sink: [],
    outbox: [],
    rows: [],
    sinkDown: false,
    ledger: [],
    ...over,
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url, "https://x.test");
    if (url.includes("/auth/v1/user")) return res({ id: USER });
    if (url.includes("oauth2.googleapis.com/token")) { const t = w.token(); if (t === "throw") throw new Error("offline"); return t; }
    if (url.includes("gmail.googleapis.com")) return res({ emailAddress: DAVE });
    if (url.includes("/rest/v1/google_tokens")) {
      if (u.searchParams.get("email")) return res([{ token_enc: enc }]);
      const select = u.searchParams.get("select") ?? "";
      if (select.includes("dead_at")) return w.grant ? res([{ email: DAVE, ...w.grant }]) : res({ message: "column does not exist" }, 400);
      return res([{ email: DAVE }]);
    }
    if (url.includes("/rest/v1/email_account?")) {
      return res(w.rows.length ? w.rows : [{ id: "acct-1", address: DAVE, state: "connected", last_sync_at: w.syncAt, connection_health: null, connection_health_at: null }]);
    }
    if (url.includes("/rest/v1/outbox_command")) return res(w.outbox.map((o) => ({ kind: o.kind })));
    if (url.includes("/rest/v1/client_error")) {
      if (w.sinkDown) return res({}, 404);
      if (init?.method === "POST") { w.sink.push(JSON.parse(String(init.body)) as Record<string, unknown>); return res({}, 201); }
      const fp = u.searchParams.get("fingerprint")?.replace("eq.", "");
      return res(w.sink.filter((r) => r.fingerprint === fp).map(() => ({ id: 1 })));
    }
    if (url.includes("/rest/v1/rpc/connection_incident_record")) {
      if (!w.ledger) return res({}, 404);
      const b = JSON.parse(String(init?.body)) as Record<string, string>;
      // The SQL's insert ... on conflict (owner_id, incident_id) do nothing.
      if (w.ledger.some((r) => r.owner === b.p_owner && r.incident === b.p_incident)) return res({ recorded: false, incident_id: b.p_incident });
      w.ledger.push({ owner: b.p_owner!, address: b.p_address!, incident: b.p_incident!, kind: b.p_kind!, openedAt: b.p_opened_at!, state: "open", alert: "pending" });
      return res({ recorded: true, incident_id: b.p_incident });
    }
    if (url.includes("/rest/v1/rpc/connection_incident_resolve")) {
      if (!w.ledger) return res({}, 404);
      const b = JSON.parse(String(init?.body)) as Record<string, string>;
      let resolved = 0; let suppressed = 0;
      for (const r of w.ledger.filter((x) => x.owner === b.p_owner && x.address === b.p_address && x.state === "open")) {
        resolved++; r.state = "resolved";
        if (r.alert === "pending") { suppressed++; r.alert = "suppressed"; }
      }
      return res({ resolved, suppressed });
    }
    if (url.includes("/rest/v1/rpc/email_account_health_record")) {
      const b = JSON.parse(String(init?.body)) as { p_health: unknown };
      w.rows = [{ id: "acct-1", address: DAVE, state: "connected", last_sync_at: w.syncAt, connection_health: b.p_health, connection_health_at: new Date().toISOString() }];
      return res({ recorded: true });
    }
    return res({}, 404);
  }));
  return w;
}

type Acc = { incident?: { id: string; kind: string; openedAt: string; cause: string | null } | null; paused?: { replies: number; other: number } | null; state: string; auth_state: string };
const get = async (qs = "?refresh=1") => ((await (await handler(new Request("https://x.test/api/connections/status" + qs, { method: "GET", headers: { authorization: "Bearer jwt" } }))).json()) as { accounts: Acc[] }).accounts[0]!;

beforeEach(() => {
  process.env.VITE_SUPABASE_URL = "https://supa.test";
  process.env.VITE_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.GOOGLE_TOKEN_KEY = KEY;
  process.env.GOOGLE_CLIENT_ID = "cid";
  process.env.GOOGLE_CLIENT_SECRET = "csecret";
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("a confirmed loss of the grant is an incident", () => {
  it("carries an ID, the open time and the kind, and the sink hears of it once with the account, the code and the time", async () => {
    await stub();
    const a = await get();
    expect(a).toMatchObject({ auth_state: "revoked", state: "pending_auth", incident: { kind: "auth" } });
    expect(a.incident!.id).toMatch(/^JC-[0-9A-F]{8}$/);
    expect(w.sink).toHaveLength(1);
    expect(String(w.sink[0]!.message)).toContain(a.incident!.id);
    expect(String(w.sink[0]!.message)).toContain(DAVE);
    expect(w.sink[0]!.context).toMatchObject({ account: DAVE, kind: "auth", incident: a.incident!.id });
  });

  it("checking again, from the recorded proof or from a forced one, keeps the ID and writes nothing more", async () => {
    await stub();
    const first = await get();
    const again = await get();
    const cached = await get("");
    expect(again.incident!.id).toBe(first.incident!.id);
    expect(cached.incident!.id).toBe(first.incident!.id);
    expect(w.sink).toHaveLength(1);
  });

  it("anchors on the instant the grant's failure was recorded, so every path computes the same ID", async () => {
    const at = "2026-10-07T12:00:00.123456+00:00";
    await stub({ grant: { state: "DEAD", dead_at: at, last_refresh_ok_at: null, consecutive_failures: 0, last_auth_error: { oauthRefreshFailedAt: at, lastAuthErrorCode: "invalid_grant", likelyCause: "testing_mode_7_day" } } });
    const a = await get();
    expect(a.incident).toMatchObject({ id: incidentId(DAVE, "auth", new Date(at).toISOString()), openedAt: new Date(at).toISOString(), cause: "testing_mode_7_day" });
  });

  it("an account that has recovered carries no incident, and a healthy account never writes to the sink", async () => {
    await stub({ token: () => res({ access_token: "ya29.x", expires_in: 3599, scope: "gmail.send" }) });
    const a = await get();
    expect(a.incident ?? null).toBeNull();
    expect(w.sink).toHaveLength(0);
  });

  it("counts the paused work and carries nothing but the counts", async () => {
    await stub({ outbox: [{ kind: "send_email", subject: "Secret plans" }, { kind: "send_email" }, { kind: "modify_labels" }] });
    const a = await get();
    expect(a.paused).toEqual({ replies: 2, other: 1, reason: "Paused · Re-Consent Required" });
    expect(JSON.stringify(a)).not.toContain("Secret plans");
  });

  it("works before the error sink or migration 0057 exist: the status still answers, with an incident", async () => {
    await stub({ sinkDown: true });
    const a = await get();
    expect(a.incident!.kind).toBe("auth");
  });
});

describe("transient trouble is quiet until it lasts (escalation)", () => {
  const down = { token: () => "throw" as const };
  const grant = (failures: number) => ({ state: "VALID", dead_at: null, last_refresh_ok_at: new Date(Date.now() - 3600e3).toISOString(), consecutive_failures: failures, last_auth_error: null });

  it("a few failures in a row: a warning, no incident, nothing told to the sink, and no reconnect", async () => {
    await stub({ ...down, grant: grant(ESCALATE_AFTER_FAILURES - 1) });
    const a = await get();
    expect(a).toMatchObject({ state: "warning", auth_state: "unknown" });
    expect(a.incident ?? null).toBeNull();
    expect(w.sink).toHaveLength(0);
  });

  it("the tenth failure in a row becomes a degraded incident on its own, once", async () => {
    await stub({ ...down, grant: grant(ESCALATE_AFTER_FAILURES) });
    const a = await get();
    expect(a.incident).toMatchObject({ kind: "degraded", cause: "failures" });
    expect(a.state).toBe("warning");
    await get();
    expect(w.sink).toHaveLength(1);
  });

  it("a day with no successful sync becomes one too, even with few failures counted", async () => {
    await stub({ ...down, grant: grant(2), syncAt: new Date(Date.now() - 25 * 3600e3).toISOString() });
    const a = await get();
    expect(a.incident).toMatchObject({ kind: "degraded", cause: "silence" });
  });

  it("a single network failure on one check is no incident", async () => {
    await stub({ ...down, grant: grant(1) });
    expect((await get()).incident ?? null).toBeNull();
  });
});

describe("the durable incident (migration 0064): recorded once, ended on a real recovery", () => {
  const healthy = () => res({ access_token: "ya29.x", expires_in: 3599, scope: "gmail.send" });
  const rpcBodies = (fn: string) => (vi.mocked(fetch).mock.calls as unknown as [string, RequestInit | undefined][])
    .filter(([u]) => u.endsWith(`/rest/v1/rpc/${fn}`)).map(([, i]) => JSON.parse(String(i?.body)) as Record<string, unknown>);

  it("the status check that finds it records it with the owner, the account, the ID, the kind and the anchor", async () => {
    await stub();
    const a = await get();
    expect(w.ledger).toEqual([{ owner: USER, address: DAVE, incident: a.incident!.id, kind: "auth", openedAt: a.incident!.openedAt, state: "open", alert: "pending" }]);
  });

  it("two finders of the same incident (the revocation path and a status check) make ONE row", async () => {
    const at = "2026-10-07T12:00:00.000Z";
    await stub({ grant: { state: "DEAD", dead_at: at, last_refresh_ok_at: null, consecutive_failures: 0, last_auth_error: { oauthRefreshFailedAt: at, lastAuthErrorCode: "invalid_grant" } } });
    await reportRevocation({ supaUrl: "https://supa.test", service: "service" }, { userId: USER, email: DAVE, source: "sync", code: "invalid_grant" });
    const a = await get();
    await get();
    expect(a.incident!.id).toBe(incidentId(DAVE, "auth", at));
    expect(w.ledger).toHaveLength(1);
    expect(w.ledger![0]).toMatchObject({ incident: a.incident!.id, state: "open" });
    expect(rpcBodies("connection_incident_record").every((b) => b.p_incident === a.incident!.id && b.p_owner === USER)).toBe(true);
  });

  it("a fresh proof that the account recovered ends the incident and suppresses the pending alert", async () => {
    await stub();
    await get();
    expect(w.ledger![0]).toMatchObject({ state: "open", alert: "pending" });
    w.token = healthy;
    const a = await get();
    expect(a.incident ?? null).toBeNull();
    expect(w.ledger![0]).toMatchObject({ state: "resolved", alert: "suppressed" });
    expect(rpcBodies("connection_incident_resolve")[0]).toEqual({ p_owner: USER, p_address: DAVE, p_reason: "recovered" });
  });

  it("a good refresh while mail is a day stale is not a recovery: the incident stays open", async () => {
    await stub({ syncAt: new Date(Date.now() - 25 * 3600e3).toISOString() });
    await get();
    w.token = healthy;
    await get();
    expect(w.ledger![0]).toMatchObject({ state: "open", alert: "pending" });
    expect(rpcBodies("connection_incident_resolve")).toEqual([]);
  });

  it("flapping before a real recovery opens nothing new: the same anchor is the same row", async () => {
    const at = "2026-10-07T12:00:00.000Z";
    const dead = { state: "DEAD", dead_at: at, last_refresh_ok_at: null, consecutive_failures: 0, last_auth_error: { oauthRefreshFailedAt: at } };
    await stub({ grant: dead });
    await get();
    w.token = () => "throw";
    await get();
    w.token = () => res({ error: "invalid_grant" }, 400);
    await get();
    expect(w.ledger).toHaveLength(1);
  });

  it("without the ledger (0064 not applied) the status still answers with its incident", async () => {
    await stub({ ledger: null });
    const a = await get();
    expect(a.incident!.kind).toBe("auth");
    w.token = healthy;
    expect((await get()).state).toBe("connected");
  });
});
