// THE BACKGROUND HALF OF SILENT RENEWAL (Foundation Fix Spec 2).
//
// Two tiers keep a sign-in alive without ever asking the person to tap. The HOT
// path is inline: getAccessToken (api/_google.ts) refreshes at dispatch, only
// when the cached access token is within ten minutes of dying, so refresh
// latency never lands on a request that does not need it. This is the SLOW
// path: once a day it refreshes the accounts nobody has used, so no refresh
// token dies of Google's six months of non-use. CISA (2025) calls long-lived
// refresh tokens the highest-risk exposure in this class; this worker is the
// controlled rotation under a permanent identity, not a permanent credential.
//
// It goes through getAccessToken like every other caller, so it never touches a
// DEAD grant, never races a live request (the single-flight lock), and a grant
// Google has revoked is marked DEAD by the one revocation path, not by this.
//
// GET only, and only with `Authorization: Bearer <CRON_SECRET>` (Vercel sends
// it to a cron when CRON_SECRET is set on the project). With no secret
// configured it refuses everything, so a forgotten variable cannot open it.
// It returns counts, never an address and never a token.
export const config = { runtime: "edge" };

import { getAccessToken } from "../_google";
import { IDLE_REFRESH_AFTER_MS } from "../../src/connections/google/tokenLifecycle";
import { json, readEnv, serviceSelect } from "../_email";

/** An account is a candidate when it was last refreshed this long ago, or never. */
export const BATCH = 200;
/** The edge function's own budget: stop starting new refreshes after this, and finish tomorrow. */
export const BUDGET_MS = 25_000;

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") return json({ code: "METHOD_NOT_ALLOWED" }, 405, { allow: "GET" });
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return json({ code: "NOT_CONFIGURED" }, 501);
  const given = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  if (!sameSecret(given, secret)) return json({ code: "UNAUTHORIZED" }, 401);

  const env = readEnv();
  if (!env) return json({ code: "UNAVAILABLE" }, 503);

  const started = Date.now();
  const cutoff = new Date(started - IDLE_REFRESH_AFTER_MS).toISOString();
  // VALID rows only: a DEAD grant is never touched. Idle means last refreshed long ago, or never (a row from before the lifecycle).
  const rows = await serviceSelect<{ user_id: string; email: string; refresh_expires_at: string | null }>(
    env, "google_tokens",
    `state=eq.VALID&or=(last_refresh_ok_at.is.null,last_refresh_ok_at.lt.${encodeURIComponent(cutoff)})&select=user_id,email,refresh_expires_at&order=last_refresh_ok_at.asc.nullsfirst&limit=${BATCH}`,
  );
  // Migration 0057 not applied: there is no lifecycle to keep alive yet. Say so rather than pretending to have checked.
  if (rows === null) return json({ checked: 0, note: "lifecycle columns not present" }, 200, { "cache-control": "no-store" });

  let refreshed = 0, revoked = 0, transient = 0, skipped = 0;
  for (const r of rows) {
    if (Date.now() - started > BUDGET_MS) { skipped = rows.length - (refreshed + revoked + transient); break; }
    const got = await getAccessToken(env, { userId: r.user_id, email: r.email, source: "worker", force: true });
    if (got.ok) refreshed++;
    else if (got.kind === "revoked" || got.kind === "unreadable") revoked++;
    else transient++;
  }
  // A Testing-mode grant about to die (Google said when): counted so the operator can see it coming, never listed.
  const horizon = Date.now() + 24 * 3600e3;
  const testingModeExpiring = rows.filter((r) => r.refresh_expires_at && new Date(r.refresh_expires_at).getTime() < horizon).length;

  return json({ checked: rows.length, refreshed, revoked, transient, skipped, testingModeExpiring }, 200, { "cache-control": "no-store" });
}
