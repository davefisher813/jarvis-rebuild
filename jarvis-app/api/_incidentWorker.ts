// THE 15-MINUTE CLOCK FOR A CONNECTION INCIDENT (Email v1 spec 2026-10-08, section 10; Dave's locked decisions L1 and
// L5; AC22 to AC24; migration 0064).
//
// L1: "Show a connection problem immediately in the app once detected. If unresolved for 15 minutes, enqueue one phone
// alert for that incident if notifications are enabled." The in-app half is immediate and already works (the status
// route finds the incident; the app announces it). This is the other half: Postgres (pg_cron, once a minute, and only
// while an alert is actually due; ops/incident_worker_cron.sql) calls this; it claims the due alerts, RECHECKS each
// incident against the same truth the status route uses (the stored grant and the account's recorded proof), and:
//   recovered, or the mailbox removed  ->  the incident ends and its alert is suppressed. Nothing is sent.
//   still broken                        ->  ONE attempt through a user-scoped transport, if there is one.
//
// THERE IS NO USER-SCOPED TRANSPORT TODAY, and this never pretends otherwise. Native APNs needs an Apple key that does
// not exist yet (src/native/push.ts, migration 0054), and the backend's web push (/api/push/test, src/push/proxy.ts)
// broadcasts to EVERY subscribed device of EVERY user, so an incident alert through it would reach every tester: a
// privacy breach, and never used here. transportFor() is the seam a real sender (APNs to this owner's device_token rows,
// gated on their notification permission and preferences) plugs into; it answers null today, and the alert is recorded
// as 'unavailable' with the reason 'no_user_scoped_transport'. Never "sent", never "delivered". The in-app status is
// shown whatever happens here ("push failure never hides either in-app state").
//
// EXACTLY ONE LOGICAL ATTEMPT. The claim leases the row (skip locked, so two ticks never take the same one); the
// database moves the alert only forward (pending -> unavailable | failed | unknown -> submitted | failed) and only for
// the claim's holder. With a transport, the row is marked 'unknown' BEFORE the call, so a tick that dies mid-send leaves
// an unknown, which is recorded and never blindly resent.
//
// It lives behind POST /api/connections/status with the header `x-jarvis-worker: incidents` (api/connections/status.ts
// hands the request here) and NOT as a route of its own: the host plan caps the API files a deployment may hold
// (src/laws/apiFunctionBudget.test.ts). An underscore file is a module, not a function.
//
// POST only, and only with the bearer secret held in Postgres' vault: the worker asks the database whether the token is
// the one (incident_cron_ok), so no secret lives in an env var, a log or the repo. It answers counts, never an address,
// never an incident ID, never a token.

import { fail, failResponse, json, readEnv, serviceRpc, serviceSelect, type EmailEnv } from "./_email";
import { readGrantMeta, resolveIncidents } from "./_incident";
import { recoveredOf, type GrantMeta } from "../src/connections/incident";
import type { AccountStatus } from "../src/connections/connectionStatus";

/** The header that routes a request to a scheduled worker instead of the person's own call (the same one the send hold uses). */
export const WORKER_HEADER = "x-jarvis-worker";
/** Its value for this worker. */
export const INCIDENT_WORKER = "incidents";

/** L5: phone notifications are private by default. The spec's default text for a connection incident, and the ONLY text an
 *  incident alert may carry: no account name or address, no sender, no subject, no excerpt, no amount, in the payload, a
 *  URL, a tag or any metadata. */
export const INCIDENT_ALERT_TEXT = "JARVIS needs your attention";

/** What an incident alert carries to a transport. Nothing else is ever put in it. */
export interface AlertPayload {
  text: typeof INCIDENT_ALERT_TEXT;
  /** The logical alert type (the spec's uniqueness key is owner, incident, alert type); not an identifier of anyone. */
  kind: "connection";
}

/** What a transport can honestly say. A provider that accepted it is "submitted", never "delivered". */
export type AlertOutcome = "submitted" | "failed" | "unknown";

export interface AlertTransport {
  send(payload: AlertPayload): Promise<AlertOutcome>;
}

/** THE SEAM. A user-scoped sender for this owner, already gated on their notification permission and preferences, or null.
 *  Null today for everyone: there is no user-scoped push transport (see the header). */
export async function transportFor(_env: EmailEnv, _owner: string): Promise<AlertTransport | null> {
  return null;
}

/** Alerts handled per call. A call is short; the next tick takes the next ones. */
export const MAX_PER_CALL = 10;
/** The edge function's own budget: stop starting new alerts after this. */
export const BUDGET_MS = 20_000;

/** One claimed alert, as connection_incident_claim returns it. */
export interface ClaimedAlert {
  id: string;
  owner_id: string;
  account_address: string;
  incident_id: string;
  kind: "auth" | "degraded";
  opened_at: string;
  first_detected_at: string;
  claim_token: string;
}

interface AccountRow {
  state: string;
  last_sync_at: string | null;
  connection_health?: AccountStatus | null;
  connection_health_at?: string | null;
}

export type Recheck = "broken" | "recovered" | "gone" | "unknown";

const ms = (v: string | null | undefined): number | null => {
  if (!v) return null;
  const n = new Date(v).getTime();
  return Number.isFinite(n) ? n : null;
};

/** Is the incident still unresolved? Pure. The same evidence the status route trusts, read without calling Google:
 *
 *   gone       the mailbox row is gone or the person disconnected it. Nobody to alert about.
 *   broken     the grant is DEAD, the account needs re-consent, there is no stored sign-in at all, or the newest proof still
 *              carries an incident. Also broken when nothing since detection says it recovered: a recovery is proven, never assumed.
 *   recovered  a proof made AFTER detection says the account recovered (recoveredOf, the status route's own meaning), or a
 *              sync completed after detection on a connected account whose grant is not failing (mail actually moved).
 *   unknown    the account row could not be read. The alert stays pending and the lease brings it back next tick.
 *
 *  `grants` is null where the grant records could not be read; the account row's evidence then decides alone. */
export function recheck(i: { alert: Pick<ClaimedAlert, "first_detected_at">; account: AccountRow | null | undefined; grants: Map<string, GrantMeta> | null; address: string }): Recheck {
  if (i.account === undefined) return "unknown";
  if (i.account === null || i.account.state === "disconnected") return "gone";
  const detected = ms(i.alert.first_detected_at) ?? 0;
  const grant = i.grants ? i.grants.get(i.address) ?? null : undefined;
  if (grant === null) return "broken"; // the records were read and this address has no stored sign-in
  if (grant?.deadAt) return "broken";
  if (i.account.state === "reauth") return "broken";

  const proof = i.account.connection_health ?? null;
  const provedAt = Math.max(ms(i.account.connection_health_at) ?? 0, ms(proof?.checkedAt) ?? 0);
  const proofIsNew = proof !== null && provedAt > detected;
  if (proofIsNew && proof.incident) return "broken";
  if (proofIsNew && recoveredOf(proof)) return "recovered";

  const synced = ms(i.account.last_sync_at);
  const grantQuiet = grant === undefined || grant.consecutiveFailures === 0;
  if (i.account.state === "connected" && synced !== null && synced > detected && grantQuiet) return "recovered";
  return "broken";
}

async function readAccount(env: EmailEnv, owner: string, address: string): Promise<AccountRow | null | undefined> {
  const q = `owner_id=eq.${encodeURIComponent(owner)}&address=eq.${encodeURIComponent(address)}&limit=1`;
  const full = await serviceSelect<AccountRow>(env, "email_account", `${q}&select=state,last_sync_at,connection_health,connection_health_at`);
  const rows = full ?? (await serviceSelect<AccountRow>(env, "email_account", `${q}&select=state,last_sync_at`));
  if (rows === null) return undefined;
  return rows[0] ?? null;
}

async function settle(env: EmailEnv, a: ClaimedAlert, status: "unavailable" | "failed" | "unknown" | "submitted", reason: string | null): Promise<boolean> {
  const r = await serviceRpc(env, "connection_incident_alert_settle", { p_id: a.id, p_token: a.claim_token, p_status: status, p_reason: reason });
  return !r.error && (r.data as { settled?: boolean } | null)?.settled === true;
}

export interface IncidentWorkerDeps {
  transportFor: (env: EmailEnv, owner: string) => Promise<AlertTransport | null>;
}

export async function runIncidentWorker(req: Request, deps: IncidentWorkerDeps = { transportFor }): Promise<Response> {
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405, { allow: "POST" });
  const env = readEnv();
  if (!env) return failResponse(fail("UNAVAILABLE"));

  const given = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  if (!given) return json({ code: "UNAUTHORIZED" }, 401);
  const ok = await serviceRpc(env, "incident_cron_ok", { p_token: given });
  if (ok.error || ok.data !== true) return json({ code: "UNAUTHORIZED" }, 401);

  const started = Date.now();
  const claimed = await serviceRpc(env, "connection_incident_claim", { p_limit: MAX_PER_CALL });
  if (claimed.error || !Array.isArray(claimed.data)) return failResponse(fail("UNAVAILABLE"));
  const alerts = claimed.data as ClaimedAlert[];

  const counts = { claimed: alerts.length, suppressed: 0, unavailable: 0, submitted: 0, failed: 0, unknown: 0, deferred: 0, lost: 0 };
  const grantsOf = new Map<string, Promise<Map<string, GrantMeta> | null>>();
  for (const a of alerts) {
    // Out of time: what is left stays pending, and its lease brings it back on the next tick.
    if (Date.now() - started > BUDGET_MS) { counts.deferred++; continue; }
    const address = a.account_address.toLowerCase();
    if (!grantsOf.has(a.owner_id)) grantsOf.set(a.owner_id, readGrantMeta(env, a.owner_id));
    const [grants, account] = await Promise.all([grantsOf.get(a.owner_id)!, readAccount(env, a.owner_id, address)]);
    const verdict = recheck({ alert: a, account, grants, address });

    if (verdict === "unknown") { counts.deferred++; continue; }
    if (verdict === "recovered" || verdict === "gone") {
      const r = await resolveIncidents(env, { userId: a.owner_id, email: address, reason: verdict === "gone" ? "account_removed" : "recovered" });
      if (!r) counts.deferred++; // the ledger could not be written: still pending, the lease brings it back
      else if (r.suppressed > 0) counts.suppressed++;
      else counts.lost++; // another path (the status route) ended it first
      continue;
    }

    // Still broken at 15 minutes. Permission and preferences are the transport's to check; none exists for anyone yet.
    let transport: AlertTransport | null = null;
    try { transport = await deps.transportFor(env, a.owner_id); } catch { transport = null; }
    if (!transport) {
      if (await settle(env, a, "unavailable", "no_user_scoped_transport")) counts.unavailable++;
      else counts.lost++;
      continue;
    }
    // Marked before the call: a send that may have left is never sent again.
    if (!(await settle(env, a, "unknown", "dispatching"))) { counts.lost++; continue; }
    let outcome: AlertOutcome;
    try { outcome = await transport.send({ text: INCIDENT_ALERT_TEXT, kind: "connection" }); } catch { outcome = "unknown"; }
    if (outcome === "unknown") { counts.unknown++; continue; }
    if (await settle(env, a, outcome, null)) counts[outcome]++;
    else counts.unknown++;
  }
  return json(counts, 200, { "cache-control": "no-store" });
}
