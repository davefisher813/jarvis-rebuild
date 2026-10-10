// THE 15-MINUTE INCIDENT CLOCK OVER A FAKE SUPABASE (Email v1 spec section 10, L1 and L5, AC22 to AC24; migration 0064).
// The real status handler runs and hands the request to the worker; the network is a recorder, and the ledger is an
// in-memory stand-in for connection_incident with the same one-way rules as the SQL (proven on a real Postgres by
// jarvis-core/supabase/tests/connection_incident.sh). What these hold: no vault token, nothing happens; only due alerts
// are taken; each is RECHECKED, and a recovered or removed account suppresses its alert; a still-broken one is recorded
// 'unavailable' (there is no user-scoped transport) and never called sent; one logical attempt, ever; and the answer
// carries counts, never an address, an incident ID or a token.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import statusHandler from "./connections/status";
import { INCIDENT_ALERT_TEXT, recheck, runIncidentWorker, type AlertPayload, type AlertTransport } from "./_incidentWorker";

const USER = "11111111-1111-4111-8111-111111111111";
const DAVE = "dave@gmail.com";
const DETECTED = "2026-10-10T12:00:00.000Z";
const res = (body: unknown, status = 200): Response => ({ ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body }) as unknown as Response;

interface Row {
  id: string; owner_id: string; account_address: string; incident_id: string; kind: "auth" | "degraded"; opened_at: string;
  first_detected_at: string; alert_due_at: number; state: "open" | "resolved"; resolved_at: string | null;
  alert_status: string; alert_reason: string | null; alert_attempted_at: string | null; lease: number; token: string | null;
}
interface World {
  rows: Row[];
  /** The account row the recheck reads; null = no row; "down" = storage refuses. */
  account: Record<string, unknown> | null | "down";
  grant: Record<string, unknown> | null;
  tokenOk: boolean;
}
let w: World;
let calls: { url: string; body: Record<string, unknown> | null }[] = [];
const rpcs = (fn: string) => calls.filter((c) => c.url.endsWith(`/rest/v1/rpc/${fn}`)).map((c) => c.body!);
let tokens = 0;

const row = (o: Partial<Row> = {}): Row => ({
  id: "row-1", owner_id: USER, account_address: DAVE, incident_id: "JC-0000AAAA", kind: "auth", opened_at: DETECTED,
  first_detected_at: DETECTED, alert_due_at: Date.now() - 1000, state: "open", resolved_at: null,
  alert_status: "pending", alert_reason: null, alert_attempted_at: null, lease: 0, token: null, ...o,
});

function stub(over: Partial<World> = {}): World {
  w = { rows: [row()], account: { state: "reauth", last_sync_at: "2026-10-10T11:00:00.000Z", connection_health: null, connection_health_at: null }, grant: { state: "DEAD", dead_at: DETECTED, last_refresh_ok_at: null, consecutive_failures: 0, last_auth_error: { oauthRefreshFailedAt: DETECTED } }, tokenOk: true, ...over };
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ url, body });
    const now = Date.now();
    if (url.endsWith("/rpc/incident_cron_ok")) return res(w.tokenOk && body?.p_token === "good");
    if (url.endsWith("/rpc/connection_incident_claim")) {
      const due = w.rows.filter((r) => r.state === "open" && r.alert_status === "pending" && r.alert_due_at <= now && r.lease <= now).slice(0, Number(body?.p_limit ?? 10));
      for (const r of due) { r.lease = now + 120e3; r.token = `tok-${++tokens}`; }
      return res(due.map((r) => ({ id: r.id, owner_id: r.owner_id, account_address: r.account_address, incident_id: r.incident_id, kind: r.kind, opened_at: r.opened_at, first_detected_at: r.first_detected_at, claim_token: r.token })));
    }
    if (url.endsWith("/rpc/connection_incident_alert_settle")) {
      const r = w.rows.find((x) => x.id === body?.p_id);
      if (!r) return res({ error: "NOT_FOUND" });
      const to = String(body?.p_status);
      const okMove = r.token === body?.p_token && ((r.alert_status === "pending" && (to === "unavailable" || to === "failed")) || (r.alert_status === "pending" && to === "unknown" && r.state === "open") || (r.alert_status === "unknown" && (to === "submitted" || to === "failed")));
      if (!okMove) return res({ settled: false, alert_status: r.alert_status });
      r.alert_status = to; r.alert_reason = (body?.p_reason as string | null) ?? r.alert_reason; r.alert_attempted_at ??= new Date(now).toISOString(); r.lease = 0;
      return res({ settled: true, alert_status: to });
    }
    if (url.endsWith("/rpc/connection_incident_resolve")) {
      let resolved = 0; let suppressed = 0;
      for (const r of w.rows.filter((x) => x.owner_id === body?.p_owner && x.account_address === body?.p_address && x.state === "open")) {
        resolved++; r.state = "resolved"; r.resolved_at = new Date(now).toISOString();
        if (r.alert_status === "pending") { suppressed++; r.alert_status = "suppressed"; r.alert_reason = String(body?.p_reason ?? "recovered"); }
      }
      return res({ resolved, suppressed });
    }
    if (url.includes("/rest/v1/google_tokens")) return res(w.grant ? [{ email: DAVE, ...w.grant }] : []);
    if (url.includes("/rest/v1/email_account?")) {
      if (w.account === "down") return res({}, 503);
      return res(w.account ? [w.account] : []);
    }
    throw new Error("unexpected " + url);
  }));
  return w;
}

const post = (token: string | null, method = "POST") => new Request("https://x.test/api/connections/status", { method, headers: { "x-jarvis-worker": "incidents", ...(token ? { authorization: `Bearer ${token}` } : {}) } });
const run = async (req = post("good")) => { const r = await statusHandler(req); return { status: r.status, text: await r.text() }; };
const counts = (t: string) => JSON.parse(t) as Record<string, number>;
const healthyProof = (checkedAt: string) => ({ email: DAVE, auth_state: "valid", state: "connected", transient: null, lastSuccessfulRefreshAt: checkedAt, lastError: null, lastErrorAt: null, lastSuccessfulSyncAt: checkedAt, syncCoverage: null, sendReady: { ready: true, reason: "" }, delivery: { kind: "poll", liveness: "fresh" }, receipt: null, checkedAt, incident: null, paused: null });

beforeEach(() => {
  vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "web.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "shh");
  vi.stubEnv("GOOGLE_TOKEN_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("VITE_SUPABASE_URL", "https://supa.test");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("the incident clock (POST /api/connections/status with x-jarvis-worker: incidents)", () => {
  it("refuses everything without the vault's token: no claim, no recheck, nothing settled", async () => {
    stub();
    for (const req of [post(null), post("wrong"), post("good", "GET")]) expect([401, 405]).toContain((await run(req)).status);
    expect(rpcs("connection_incident_claim")).toEqual([]);
    expect(rpcs("connection_incident_alert_settle")).toEqual([]);
    expect(w.rows[0]!.alert_status).toBe("pending");
  });

  it("a database that cannot vouch for the token (no vault secret yet) is a refusal too", async () => {
    stub({ tokenOk: false });
    expect((await run()).status).toBe(401);
    expect(rpcs("connection_incident_claim")).toEqual([]);
  });

  it("takes only the alerts that are due: one inside its 15 minutes stays pending and untouched", async () => {
    stub({ rows: [row(), row({ id: "row-2", incident_id: "JC-0000BBBB", alert_due_at: Date.now() + 5 * 60e3 })] });
    const r = await run();
    expect(r.status).toBe(200);
    expect(counts(r.text)).toMatchObject({ claimed: 1, unavailable: 1 });
    expect(w.rows[1]).toMatchObject({ alert_status: "pending", alert_attempted_at: null, token: null });
  });

  it("still broken with no user-scoped transport: recorded 'unavailable', with the reason, and never called sent", async () => {
    stub();
    const r = await run();
    expect(counts(r.text)).toEqual({ claimed: 1, suppressed: 0, unavailable: 1, submitted: 0, failed: 0, unknown: 0, deferred: 0, lost: 0 });
    expect(w.rows[0]).toMatchObject({ state: "open", alert_status: "unavailable", alert_reason: "no_user_scoped_transport" });
    expect(w.rows[0]!.alert_attempted_at).not.toBeNull();
    // The Railway broadcast route is never touched: it would reach every tester's device.
    expect(calls.some((c) => /push|apns|railway/i.test(c.url))).toBe(false);
  });

  it("an alert already attempted is never attempted again, even once its lease has run out", async () => {
    stub();
    await run();
    w.rows[0]!.lease = 0;
    const again = await run();
    expect(counts(again.text)).toMatchObject({ claimed: 0, unavailable: 0 });
    expect(rpcs("connection_incident_alert_settle")).toHaveLength(1);
  });

  it("rechecks at dispatch: a proof after detection says it recovered, so the incident ends and the alert is suppressed", async () => {
    const after = new Date(new Date(DETECTED).getTime() + 10 * 60e3).toISOString();
    stub({ account: { state: "connected", last_sync_at: after, connection_health: healthyProof(after), connection_health_at: after }, grant: { state: "VALID", dead_at: null, last_refresh_ok_at: after, consecutive_failures: 0, last_auth_error: null } });
    const transport = vi.fn(async (): Promise<AlertTransport | null> => ({ send: async () => "submitted" }));
    const r = await runIncidentWorker(post("good"), { transportFor: transport });
    expect(await r.json()).toMatchObject({ claimed: 1, suppressed: 1, unavailable: 0, submitted: 0 });
    expect(w.rows[0]).toMatchObject({ state: "resolved", alert_status: "suppressed", alert_reason: "recovered", alert_attempted_at: null });
    expect(transport).not.toHaveBeenCalled();
    expect(rpcs("connection_incident_resolve")[0]).toMatchObject({ p_owner: USER, p_address: DAVE });
  });

  it("mail that synced after detection on a connected account is a recovery too (a degraded incident's catch-up)", async () => {
    const after = new Date(new Date(DETECTED).getTime() + 60e3).toISOString();
    stub({ rows: [row({ kind: "degraded" })], account: { state: "connected", last_sync_at: after, connection_health: null, connection_health_at: null }, grant: { state: "VALID", dead_at: null, last_refresh_ok_at: after, consecutive_failures: 0, last_auth_error: null } });
    expect(counts((await run()).text)).toMatchObject({ suppressed: 1, unavailable: 0 });
  });

  it("a proof made BEFORE detection proves nothing: the incident is still broken", async () => {
    const before = new Date(new Date(DETECTED).getTime() - 60e3).toISOString();
    stub({ account: { state: "connected", last_sync_at: before, connection_health: healthyProof(before), connection_health_at: before }, grant: { state: "VALID", dead_at: null, last_refresh_ok_at: before, consecutive_failures: 0, last_auth_error: null } });
    expect(counts((await run()).text)).toMatchObject({ suppressed: 0, unavailable: 1 });
  });

  it("a mailbox the person removed ends the incident without an alert", async () => {
    stub({ account: { state: "disconnected", last_sync_at: null } });
    expect(counts((await run()).text)).toMatchObject({ suppressed: 1 });
    expect(w.rows[0]).toMatchObject({ state: "resolved", alert_status: "suppressed", alert_reason: "account_removed" });
  });

  it("an account that cannot be read is not guessed at: the alert stays pending for the next tick", async () => {
    stub({ account: "down" });
    expect(counts((await run()).text)).toMatchObject({ claimed: 1, deferred: 1, unavailable: 0 });
    expect(w.rows[0]!.alert_status).toBe("pending");
    expect(rpcs("connection_incident_alert_settle")).toEqual([]);
  });

  it("answers counts only: never the address, the incident ID or a token", async () => {
    stub();
    const r = await run();
    expect(r.text).not.toContain(DAVE);
    expect(r.text).not.toMatch(/@|JC-|tok-|good|service/);
    expect(Object.keys(counts(r.text)).sort()).toEqual(["claimed", "deferred", "failed", "lost", "submitted", "suppressed", "unavailable", "unknown"]);
  });
});

describe("the transport seam (for when a user-scoped sender exists)", () => {
  it("the payload is the private default text and nothing else, marked unknown BEFORE the call, then submitted", async () => {
    stub();
    const sent: AlertPayload[] = [];
    const statusAtSend: string[] = [];
    const transport: AlertTransport = { send: async (p) => { sent.push(p); statusAtSend.push(w.rows[0]!.alert_status); return "submitted"; } };
    const r = await runIncidentWorker(post("good"), { transportFor: async () => transport });
    expect(await r.json()).toMatchObject({ submitted: 1 });
    expect(sent).toEqual([{ text: INCIDENT_ALERT_TEXT, kind: "connection" }]);
    expect(INCIDENT_ALERT_TEXT).toBe("JARVIS needs your attention");
    expect(JSON.stringify(sent)).not.toMatch(/dave|gmail|@|JC-/i);
    expect(statusAtSend).toEqual(["unknown"]);
    expect(w.rows[0]!.alert_status).toBe("submitted");
  });

  it("a transport that throws leaves the outcome unknown, recorded, and it is never blindly resent", async () => {
    stub();
    const send = vi.fn(async (): Promise<"submitted"> => { throw new Error("socket closed"); });
    const r = await runIncidentWorker(post("good"), { transportFor: async () => ({ send }) });
    expect(await r.json()).toMatchObject({ unknown: 1, submitted: 0 });
    expect(w.rows[0]!.alert_status).toBe("unknown");
    w.rows[0]!.lease = 0;
    await runIncidentWorker(post("good"), { transportFor: async () => ({ send }) });
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("recheck (pure)", () => {
  const alert = { first_detected_at: DETECTED };
  const after = "2026-10-10T12:30:00.000Z";
  const grants = (g: Partial<{ deadAt: string | null; consecutiveFailures: number }> = {}) => new Map([[DAVE, { deadAt: null, oauthFailedAt: null, consecutiveFailures: 0, lastRefreshOkAt: null, cause: null, ...g }]]);
  it("no stored sign-in, a dead grant, or a reauth account is broken whatever the sync says", () => {
    const account = { state: "connected", last_sync_at: after };
    expect(recheck({ alert, account, grants: new Map(), address: DAVE })).toBe("broken");
    expect(recheck({ alert, account, grants: grants({ deadAt: DETECTED }), address: DAVE })).toBe("broken");
    expect(recheck({ alert, account: { ...account, state: "reauth" }, grants: grants(), address: DAVE })).toBe("broken");
  });
  it("a newer proof still carrying an incident is broken; a failing grant blocks the sync evidence", () => {
    const proof = { ...healthyProof(after), state: "pending_auth", incident: { id: "JC-0000AAAA", kind: "auth", openedAt: DETECTED, cause: null } } as never;
    expect(recheck({ alert, account: { state: "connected", last_sync_at: after, connection_health: proof, connection_health_at: after }, grants: grants(), address: DAVE })).toBe("broken");
    expect(recheck({ alert, account: { state: "connected", last_sync_at: after }, grants: grants({ consecutiveFailures: 3 }), address: DAVE })).toBe("broken");
  });
  it("unreadable grants fall back to the account's own evidence", () => {
    expect(recheck({ alert, account: { state: "connected", last_sync_at: after }, grants: null, address: DAVE })).toBe("recovered");
    expect(recheck({ alert, account: undefined, grants: null, address: DAVE })).toBe("unknown");
    expect(recheck({ alert, account: null, grants: null, address: DAVE })).toBe("gone");
  });
});
