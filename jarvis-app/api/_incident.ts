// THE SERVER HALF OF A CONNECTION INCIDENT (Foundation Fix Spec 3).
//
// Three jobs, all best effort, none ever allowed to fail the request that
// found the incident:
//   readGrantMeta     what the stored grant knows about itself (migration 0057), or null where that is not applied
//   pausedWorkOf      how many sends and other actions are waiting on a mailbox that cannot act (counts only)
//   reportIncident    ONE row in the error sink (client_error) per incident, with the account, the code and the time
//
// EXACTLY ONCE. The sink row's fingerprint is a hash of the incident ID, and a
// row with that fingerprint is looked for before one is written. The ID is the
// same whichever path finds the incident first (the sync route, the keep-alive
// worker, a status check), so the second finder finds the first one's row and
// writes nothing. Two finders in the same instant can both miss it and write
// twice; that is a duplicate line in a log, not a second announcement (the
// notification is the app's, keyed on the same ID).

import { incidentId, type GrantMeta, type Incident, type PausedWork } from "../src/connections/incident";

export interface SinkEnv { supaUrl: string; service: string }

const headers = (e: SinkEnv): Record<string, string> => ({ apikey: e.service, Authorization: "Bearer " + e.service, "content-type": "application/json" });

async function sha256Hex(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const iso = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

interface GrantRow {
  email: string;
  state: string;
  dead_at: string | null;
  last_refresh_ok_at: string | null;
  consecutive_failures: number | null;
  last_auth_error: { oauthRefreshFailedAt?: string; lastAuthErrorCode?: string; likelyCause?: string } | null;
}

/** The grant records of every sign-in this person has, keyed by lowercase address. Null where migration 0057 is not applied or storage is unwell. */
export async function readGrantMeta(e: SinkEnv, userId: string): Promise<Map<string, GrantMeta & { code: string | null }> | null> {
  try {
    const r = await fetch(`${e.supaUrl}/rest/v1/google_tokens?user_id=eq.${encodeURIComponent(userId)}&select=email,state,dead_at,last_refresh_ok_at,consecutive_failures,last_auth_error`, { headers: headers(e) });
    if (!r.ok) return null;
    const rows = (await r.json()) as GrantRow[];
    const out = new Map<string, GrantMeta & { code: string | null }>();
    for (const g of rows) {
      out.set(g.email.toLowerCase(), {
        deadAt: g.state === "DEAD" ? iso(g.dead_at) : null,
        oauthFailedAt: g.state === "DEAD" ? iso(g.last_auth_error?.oauthRefreshFailedAt) : null,
        consecutiveFailures: g.consecutive_failures ?? 0,
        lastRefreshOkAt: iso(g.last_refresh_ok_at),
        cause: g.last_auth_error?.likelyCause || null,
        code: g.last_auth_error?.lastAuthErrorCode || null,
      });
    }
    return out;
  } catch {
    return null;
  }
}

/** Sends and other actions that were approved or queued for this mailbox and have not gone. Counts only: no subject, no recipient, no text. */
export async function pausedWorkOf(e: SinkEnv, userId: string, accountId: string): Promise<PausedWork | null> {
  try {
    // Waiting (queued, claimed) or stopped by the lost sign-in (failed with PROVIDER_AUTH). A confirmed or cancelled command is history.
    const q = `owner_id=eq.${encodeURIComponent(userId)}&provider_account_id=eq.${encodeURIComponent(accountId)}&or=(state.in.(queued,claimed),and(state.eq.failed,error_code.eq.PROVIDER_AUTH))&select=kind&limit=500`;
    const r = await fetch(`${e.supaUrl}/rest/v1/outbox_command?${q}`, { headers: headers(e) });
    if (!r.ok) return null;
    const rows = (await r.json()) as { kind: string }[];
    const replies = rows.filter((x) => x.kind === "send_email").length;
    return { replies, other: rows.length - replies };
  } catch {
    return null;
  }
}

/** One error-sink row for this incident, unless one is already there. Never throws. Returns whether a row was written. */
export async function reportIncident(e: SinkEnv, o: { email: string; incident: Incident; code: string | null; source: string; at?: Date }): Promise<boolean> {
  try {
    const fingerprint = await sha256Hex("connection-incident:" + o.incident.id);
    const seen = await fetch(`${e.supaUrl}/rest/v1/client_error?fingerprint=eq.${fingerprint}&select=id&limit=1`, { headers: headers(e) });
    if (!seen.ok) return false; // the sink (migration 0053) is not there or storage is unwell: say nothing rather than guess
    if (((await seen.json()) as unknown[]).length > 0) return false;
    const at = (o.at ?? new Date()).toISOString();
    const code = o.code ?? (o.incident.kind === "auth" ? "PROVIDER_AUTH" : "UNAVAILABLE");
    const ins = await fetch(`${e.supaUrl}/rest/v1/client_error`, {
      method: "POST",
      headers: { ...headers(e), Prefer: "return=minimal" },
      body: JSON.stringify({
        name: "ConnectionIncident",
        message: `${o.incident.id} ${o.incident.kind === "auth" ? "PROVIDER_AUTH" : "DEGRADED"} ${code} ${o.email.toLowerCase()} ${at}`.slice(0, 2000),
        platform: "other",
        path: "/api/connections",
        fingerprint,
        context: { incident: o.incident.id, kind: o.incident.kind, account: o.email.toLowerCase(), code, at, openedAt: o.incident.openedAt, source: o.source, cause: o.incident.cause },
      }),
    });
    return ins.ok;
  } catch {
    return false;
  }
}

/** The path that finds the grant dead (the sync route, the keep-alive worker, a send) reports it HERE, straight after the one revocation
 *  path says it was first. The anchor is read back from the row the revocation just wrote, so this computes the same ID the status check will. */
export async function reportRevocation(e: SinkEnv, o: { userId: string; email: string; source: string; code: string }): Promise<void> {
  try {
    const meta = (await readGrantMeta(e, o.userId))?.get(o.email.toLowerCase());
    const openedAt = meta?.oauthFailedAt ?? meta?.deadAt ?? new Date().toISOString();
    const incident: Incident = { id: incidentId(o.email, "auth", openedAt), kind: "auth", openedAt, cause: meta?.cause ?? null };
    await reportIncident(e, { email: o.email, incident, code: o.code.toUpperCase(), source: o.source });
  } catch { /* the revocation stands whether or not it was reported */ }
}
