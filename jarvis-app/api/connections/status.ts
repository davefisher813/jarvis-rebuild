// THE ONE PLACE A CONNECTION'S STATUS COMES FROM (Foundation Fix Spec 1,
// 2026-10-06). Every surface (Connections, the Email header, the Today band,
// the CLI) reads this and nothing else.
//
//   GET /api/connections/status            per-user Bearer
//   GET /api/connections/status?refresh=1  prove again now, whatever is recorded
//
// HEALTH PROVES VALIDITY, NOT PRESENCE. A stored token is not evidence. For
// each sign-in this refreshes the token for real and makes one named, harmless
// read (Gmail users.getProfile), then checks Google answered with the address
// the sign-in is stored for. What it saw is returned as a receipt that names
// the operation tested, and the sanitized result is recorded on the account
// (migration 0056) so the next call inside five minutes need not go back to
// Google. If that migration is not applied yet the record is skipped and the
// answer is still proven live: persistence is a courtesy here, never the proof.
//
// Nothing here returns a token, a provider message or any mail. Errors are
// stable machine codes. Nothing here changes a sign-in, an account's state or
// any mail: it only reads and reports (Specs 2 to 4 own the changes).
export const config = { runtime: "edge" };

import { authedUser, fail, failResponse, gmail, json, readEnv, serviceRpc, serviceSelect, type EmailEnv } from "../_email";
import { decrypt, refreshAccessToken } from "../_google";
import {
  COVERAGE_DAYS, REPROVE_AFTER_MS, deliveryOf, deriveStatus, type AccountStatus, type ReadOutcome, type RefreshOutcome,
} from "../../src/connections/connectionStatus";

/** One account's proof must finish inside this, or it is reported as unreachable rather than hanging every other account. */
export const PROOF_TIMEOUT_MS = 10_000;

interface AccountRow {
  address: string;
  state: string;
  last_sync_at: string | null;
  connection_health: AccountStatus | null;
  connection_health_at: string | null;
}

function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** The account rows, with the recorded proof when migration 0056 is there and without it when it is not. */
async function readAccounts(env: EmailEnv, userId: string): Promise<AccountRow[] | null> {
  const full = await serviceSelect<AccountRow>(env, "email_account", `owner_id=eq.${userId}&select=address,state,last_sync_at,connection_health,connection_health_at`);
  if (full) return full;
  const base = await serviceSelect<Omit<AccountRow, "connection_health" | "connection_health_at">>(env, "email_account", `owner_id=eq.${userId}&select=address,state,last_sync_at`);
  return base ? base.map((r) => ({ ...r, connection_health: null, connection_health_at: null })) : null;
}

async function prove(env: EmailEnv, userId: string, email: string, lastSyncAt: string | null, previous: AccountStatus | null, now: Date): Promise<AccountStatus> {
  const rows = await serviceSelect<{ token_enc: string }>(env, "google_tokens", `user_id=eq.${userId}&email=eq.${encodeURIComponent(email)}&select=token_enc`);
  const previousRefreshAt = previous?.lastSuccessfulRefreshAt ?? null;
  const derive = (refresh: RefreshOutcome | null, read: ReadOutcome | null) =>
    deriveStatus({ email, refresh, read, lastSyncAt, now, previousRefreshAt });

  // A failed SELECT says nothing about the sign-in. Report it as unreachable, never as "no sign-in".
  if (rows === null) return derive({ thrown: true }, null);
  const row = rows[0];
  if (!row) return derive(null, null);

  let stored: string;
  try {
    stored = await decrypt(row.token_enc, env.tokenKey);
  } catch {
    return derive({ ok: false, error: "invalid_grant" }, null);
  }

  let refreshed: Awaited<ReturnType<typeof refreshAccessToken>>;
  try {
    refreshed = await within(refreshAccessToken(stored, env.clients), PROOF_TIMEOUT_MS);
  } catch {
    return derive({ thrown: true }, null);
  }
  if (!refreshed.ok) return derive({ ok: false, error: refreshed.error }, null);

  let read: ReadOutcome;
  try {
    const a = await within(gmail(refreshed.got.accessToken, "/profile", { safeRead: true }), PROOF_TIMEOUT_MS);
    const body = a.body as { emailAddress?: string } | null;
    read = { ok: a.ok, status: a.status, ...(body?.emailAddress ? { emailAddress: body.emailAddress } : {}) };
  } catch {
    read = { ok: false, status: 0 };
  }
  return derive({ ok: true, ...(refreshed.got.scope ? { scope: refreshed.got.scope } : {}) }, read);
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") return json({ code: "METHOD_NOT_ALLOWED" }, 405, { allow: "GET" });
  const env = readEnv();
  if (!env) return failResponse(fail("UNAVAILABLE"));
  const who = await authedUser(req, env);
  if ("code" in who) return failResponse(who);

  const force = new URL(req.url).searchParams.get("refresh") === "1";
  const signIns = await serviceSelect<{ email: string }>(env, "google_tokens", `user_id=eq.${who.id}&select=email`);
  const accounts = await readAccounts(env, who.id);
  if (signIns === null || accounts === null) return failResponse(fail("UNAVAILABLE"));

  const now = new Date();
  const byAddress = new Map(accounts.map((a) => [a.address.toLowerCase(), a]));
  // Every stored sign-in, plus every mailbox row still claiming to be live
  // whose sign-in is gone (a grant deleted on invalid_grant leaves exactly that).
  const emails = new Set<string>(signIns.map((s) => s.email.toLowerCase()));
  for (const a of accounts) if (a.state !== "disconnected") emails.add(a.address.toLowerCase());

  const out = await Promise.all([...emails].sort().map(async (email): Promise<AccountStatus> => {
    const row = byAddress.get(email) ?? null;
    const recorded = row?.connection_health ?? null;
    const recordedAt = row?.connection_health_at ? new Date(row.connection_health_at).getTime() : 0;
    // Recent enough and not forced: report the recorded proof, with the sync time as it is now.
    if (!force && recorded && recordedAt && now.getTime() - recordedAt < REPROVE_AFTER_MS) {
      const sync = row?.last_sync_at ?? recorded.lastSuccessfulSyncAt;
      return { ...recorded, lastSuccessfulSyncAt: sync, syncCoverage: sync ? { days: COVERAGE_DAYS, through: sync } : null, delivery: deliveryOf(sync, now) };
    }
    const status = await prove(env, who.id, email, row?.last_sync_at ?? null, recorded, now);
    // Awaited: an edge function may stop the moment the response is returned. A failed record is ignored, the proof stands.
    if (row) await serviceRpc(env, "email_account_health_record", { p_owner: who.id, p_address: email, p_health: status });
    return status;
  }));

  return json({ checkedAt: now.toISOString(), accounts: out }, 200, { "cache-control": "no-store" });
}
