// THE SERVER'S SIDE OF A RECONNECT (Foundation Fix Spec 4).
//
//   startAttempt      Dave tapped Reconnect: persist the attempt, mint the signed state
//   claimAttempt      the callback arrived: single-use claim, before anything is exchanged
//   completeReconnect the six checks, in order, before anything is stored or shows green
//   verifyConsumers   every consumer reads the new state (the verification harness)
//   recordOutcome / latestAttempt   the server, not the browser, owns progress
//
// Nothing here returns a token to anyone but the signed-in person's own app, and
// nothing here imports, sends or reassigns mail: a reconnect restores access and
// nothing else. Paused replies stay for review and drafts stay drafts.
//
// Every table call degrades: without migration 0058 the state is still signed
// and still expires, it is just not single-use and its progress is not recorded.

import { IOS_TAG, getAccessToken, keepSignIn, refreshAccessToken, type GoogleStore } from "./_google";
import { gmail, serviceRpc, type EmailEnv } from "./_email";
import { deriveStatus } from "../src/connections/connectionStatus";
import {
  STATE_TTL_MS, judgeExchange, newNonce, signState, type AttemptStatus, type StatePayload,
} from "../src/connections/google/reconnect";

const T = "google_reconnect_attempt";
const hdr = (s: GoogleStore, extra: Record<string, string> = {}): Record<string, string> => ({ apikey: s.service, Authorization: "Bearer " + s.service, "content-type": "application/json", ...extra });
const lc = (e: string): string => e.trim().toLowerCase();

/** The table is not there (migration 0058 not applied): PostgREST says 404 (or 400 on older stacks). Anything else is a real failure. */
const tableMissing = (status: number): boolean => status === 404 || status === 400;

export interface Attempt { id: string; status: AttemptStatus; expires_at: string; completed_at: string | null; outcome: Record<string, unknown> | null }

export async function startAttempt(s: GoogleStore, o: { userId: string; email: string; nowMs?: number }): Promise<{ state: string; attemptId: string; expiresAt: number; persisted: boolean }> {
  const now = o.nowMs ?? Date.now();
  const email = lc(o.email);
  const id = crypto.randomUUID();
  const nonce = newNonce();
  const expiresAt = now + STATE_TTL_MS;
  let persisted = false;
  try {
    // One live link per account: whatever was open is replaced, so an old link can never finish a newer attempt.
    const sup = await fetch(`${s.supaUrl}/rest/v1/${T}?user_id=eq.${encodeURIComponent(o.userId)}&email=eq.${encodeURIComponent(email)}&status=eq.started`, {
      method: "PATCH", headers: hdr(s), body: JSON.stringify({ status: "superseded", completed_at: new Date(now).toISOString() }),
    });
    if (!tableMissing(sup.status)) {
      const ins = await fetch(`${s.supaUrl}/rest/v1/${T}`, {
        method: "POST", headers: hdr(s, { Prefer: "return=minimal" }),
        body: JSON.stringify({ id, user_id: o.userId, email, nonce, expires_at: new Date(expiresAt).toISOString() }),
      });
      persisted = ins.ok;
    }
  } catch { /* the signed state still stands */ }
  const payload: StatePayload = { a: id, u: o.userId, e: email, x: expiresAt, n: nonce };
  return { state: await signState(payload, s.tokenKey), attemptId: id, expiresAt, persisted };
}

/** The callback's claim on its attempt. Single use: the first claim moves started to exchanging-by-nobody-else; a second finds nothing to claim. */
export async function claimAttempt(s: GoogleStore, p: StatePayload, nowMs: number): Promise<{ ok: true } | { ok: false; reason: "used" }> {
  try {
    const r = await fetch(
      `${s.supaUrl}/rest/v1/${T}?id=eq.${encodeURIComponent(p.a)}&user_id=eq.${encodeURIComponent(p.u)}&nonce=eq.${encodeURIComponent(p.n)}&status=eq.started&expires_at=gt.${encodeURIComponent(new Date(nowMs).toISOString())}`,
      { method: "PATCH", headers: hdr(s, { Prefer: "return=representation" }), body: JSON.stringify({ status: "unverified" }) },
    );
    if (tableMissing(r.status)) return { ok: true };
    if (!r.ok) return { ok: true }; // storage trouble must not turn a good reconnect away; the signed state already proved it
    const rows = (await r.json().catch(() => [])) as unknown[];
    return rows.length > 0 ? { ok: true } : { ok: false, reason: "used" };
  } catch {
    return { ok: true };
  }
}

export async function recordOutcome(s: GoogleStore, attemptId: string, status: AttemptStatus, outcome: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`${s.supaUrl}/rest/v1/${T}?id=eq.${encodeURIComponent(attemptId)}`, {
      method: "PATCH", headers: hdr(s),
      body: JSON.stringify({ status, completed_at: new Date().toISOString(), outcome }),
    });
  } catch { /* a progress record is a courtesy, never the proof */ }
}

/** The person closed the window or Google refused: recorded only while the attempt is still open. */
export async function closeOpenAttempt(s: GoogleStore, attemptId: string, status: "cancelled" | "denied" | "expired", outcome: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`${s.supaUrl}/rest/v1/${T}?id=eq.${encodeURIComponent(attemptId)}&status=eq.started`, {
      method: "PATCH", headers: hdr(s), body: JSON.stringify({ status, completed_at: new Date().toISOString(), outcome }),
    });
  } catch { /* see above */ }
}

export async function latestAttempt(s: GoogleStore, userId: string, email: string): Promise<{ persisted: boolean; attempt: Attempt | null }> {
  try {
    const r = await fetch(`${s.supaUrl}/rest/v1/${T}?user_id=eq.${encodeURIComponent(userId)}&email=eq.${encodeURIComponent(lc(email))}&select=id,status,expires_at,completed_at,outcome&order=created_at.desc&limit=1`, { headers: hdr(s) });
    if (!r.ok) return { persisted: false, attempt: null };
    const rows = (await r.json()) as Attempt[];
    let a = rows[0] ?? null;
    // An attempt nobody finished is expired the moment its time is up, whatever the row last said.
    if (a && a.status === "started" && new Date(a.expires_at).getTime() <= Date.now()) {
      await closeOpenAttempt(s, a.id, "expired", {});
      a = { ...a, status: "expired" };
    }
    return { persisted: true, attempt: a };
  } catch {
    return { persisted: false, attempt: null };
  }
}

/** Whether this person has this account at all (a sign-in stored, or a mailbox that is not disconnected). */
export async function ownsAccount(s: GoogleStore, userId: string, email: string): Promise<boolean> {
  const e = encodeURIComponent(lc(email));
  const u = encodeURIComponent(userId);
  try {
    const t = await fetch(`${s.supaUrl}/rest/v1/google_tokens?user_id=eq.${u}&email=eq.${e}&select=email`, { headers: hdr(s) });
    if (t.ok && ((await t.json()) as unknown[]).length > 0) return true;
    const a = await fetch(`${s.supaUrl}/rest/v1/email_account?owner_id=eq.${u}&address=eq.${e}&state=neq.disconnected&select=id`, { headers: hdr(s) });
    return a.ok && ((await a.json()) as unknown[]).length > 0;
  } catch {
    return false;
  }
}

// ---- THE SIX CHECKS ------------------------------------------------------------

export interface ReconnectTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  refresh_token_expires_in?: number;
}

export type Propagation = Record<"app" | "status" | "cli" | "legacy", { state: "ok" | "failed" | "gated"; detail?: string }>;

export type ReconnectResult =
  | { ok: true; accessToken: string; expiresIn: number; scope?: string; propagation: Propagation }
  | { ok: false; status: Exclude<AttemptStatus, "started" | "verified" | "cancelled" | "expired" | "superseded" | "denied">; selected?: string; retryable: boolean };

/** What the person gets back from a code exchange that was part of a reconnect. Nothing is stored until step 6, and only when 1 to 5 pass. */
export async function completeReconnect(
  s: GoogleStore,
  env: EmailEnv,
  o: { payload: StatePayload; returnedEmail: string; tokens: ReconnectTokens; native: boolean },
): Promise<ReconnectResult> {
  const { payload: p, tokens: tok } = o;
  const intended = p.e;

  // Is there already a usable refresh token for this identity? (Only matters when Google sent none.)
  let storedRefreshUsable = false;
  try {
    const r = await fetch(`${s.supaUrl}/rest/v1/google_tokens?user_id=eq.${encodeURIComponent(p.u)}&email=eq.${encodeURIComponent(intended)}&select=token_enc,state`, { headers: hdr(s) });
    const rows = r.ok ? ((await r.json()) as { state?: string }[]) : [];
    storedRefreshUsable = rows.length > 0 && rows[0]!.state !== "DEAD";
  } catch { /* unknown reads as not usable: the safe side */ }

  // 1 identity, 2 permissions, 3 a credential that can renew itself.
  const judged = judgeExchange({
    intendedEmail: intended, returnedEmail: o.returnedEmail, grantedScope: tok.scope ?? "",
    newRefreshToken: !!tok.refresh_token, storedRefreshUsable,
  });
  if (!judged.ok) {
    // The wrong person's grant must not linger: nothing was stored, and what Google just issued is revoked at Google, best effort.
    if (judged.status === "wrong_account" && tok.refresh_token) void revokeAtGoogle(tok.refresh_token);
    return { ok: false, status: judged.status, ...(judged.status === "wrong_account" ? { selected: o.returnedEmail } : {}), retryable: true };
  }

  // 4 a real refresh-token exchange. The token Google just sent is tried for real, or, when it sent none, the one already stored.
  let access: string;
  let expiresIn: number;
  let scope: string | undefined = tok.scope;
  let refreshExpiresIn = tok.refresh_token_expires_in;
  if (tok.refresh_token) {
    let r;
    try { r = await refreshAccessToken((o.native ? IOS_TAG : "") + tok.refresh_token, s.clients); } catch { return { ok: false, status: "unverified", retryable: true }; }
    if (!r.ok) return { ok: false, status: "unverified", retryable: true };
    access = r.got.accessToken;
    expiresIn = r.got.expiresIn;
    scope = r.got.scope ?? scope;
    refreshExpiresIn = r.got.refreshTokenExpiresIn ?? refreshExpiresIn;
  } else {
    const got = await getAccessToken(s, { userId: p.u, email: intended, source: "app", force: true });
    if (!got.ok) return { ok: false, status: "unverified", retryable: got.kind === "transient" };
    access = got.accessToken;
    expiresIn = got.expiresIn;
    scope = got.scope ?? scope;
  }

  // 5 an authenticated mailbox read with the token that just came out of that exchange, answering as the intended account.
  const read = await gmail(access, "/profile", { safeRead: true });
  const readEmail = ((read.body as { emailAddress?: string } | null)?.emailAddress ?? "").trim().toLowerCase();
  if (!read.ok || readEmail !== intended) return { ok: false, status: read.ok ? "wrong_account" : "unverified", ...(read.ok ? { selected: readEmail } : {}), retryable: !read.ok };

  // 6 only now: store the credential durably (and mirror the mailbox connected in the same step). A failed store is not a reconnect.
  const kept = await keepSignIn(s, {
    userId: p.u, email: intended, accessToken: access,
    ...(tok.refresh_token ? { refreshToken: tok.refresh_token } : {}),
    ...(expiresIn > 0 ? { expiresIn } : {}),
    ...(scope ? { scope } : {}),
    ...(refreshExpiresIn ? { refreshTokenExpiresIn: refreshExpiresIn } : {}),
    native: o.native,
  });
  if (!kept.remembered) return { ok: false, status: "unverified", retryable: true };

  return { ok: true, accessToken: access, expiresIn, ...(scope ? { scope } : {}), propagation: await verifyConsumers(s, env, { userId: p.u, email: intended }) };
}

async function revokeAtGoogle(refreshToken: string): Promise<void> {
  try {
    await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "token=" + encodeURIComponent(refreshToken), signal: AbortSignal.timeout(4000) });
  } catch { /* a courtesy */ }
}

// ---- THE VERIFICATION HARNESS --------------------------------------------------

/** Probes each consumer of the grant and says what it saw. Run after step 6 of a reconnect, and again on demand (the reconnectStatus action).
 *  app      the mail routes' own mint (mailboxToken's path): a refresh must succeed with the stored credential
 *  status   the status endpoint's own proof (refresh + the named read, derived the same way): it must say valid and connected,
 *           and its answer is RECORDED so the next status call does not serve the old pending_auth from its five-minute record
 *  cli      reads the same rebuild routes as the app once repointed (the CLI repoint is outside this repo): not verifiable from here
 *  legacy   the Railway Gmail path: GATED on the canonical-backend decision (Dave retired it in Spec 1, the verification is still
 *           pending), so it is reported as gated and never as green or red */
export async function verifyConsumers(s: GoogleStore, env: EmailEnv, o: { userId: string; email: string }): Promise<Propagation> {
  const out: Propagation = {
    app: { state: "failed" }, status: { state: "failed" },
    cli: { state: "gated", detail: "reads the rebuild routes once repointed" },
    legacy: { state: "gated", detail: "pending the canonical-backend decision" },
  };
  const got = await getAccessToken(s, { userId: o.userId, email: o.email, source: "app", force: true });
  if (got.ok) out.app = { state: "ok" }; else out.app = { state: "failed", detail: got.code };

  const now = new Date();
  const proof = await getAccessToken(s, { userId: o.userId, email: o.email, source: "status", force: true });
  if (proof.ok) {
    const read = await gmail(proof.accessToken, "/profile", { safeRead: true });
    const emailAddress = (read.body as { emailAddress?: string } | null)?.emailAddress;
    const status = deriveStatus({
      email: o.email,
      refresh: { ok: true, ...(proof.scope ? { scope: proof.scope } : {}) },
      read: { ok: read.ok, status: read.status, ...(emailAddress ? { emailAddress } : {}) },
      lastSyncAt: null, now,
    });
    if (status.auth_state === "valid" && status.state === "connected") {
      out.status = { state: "ok" };
      // The recorded proof is replaced, so a status call inside five minutes reads the restored account and not the lost one.
      await serviceRpc(env, "email_account_health_record", { p_owner: o.userId, p_address: o.email, p_health: { ...status, incident: null, paused: null } });
    } else out.status = { state: "failed", detail: status.lastError ?? status.state };
  } else out.status = { state: "failed", detail: proof.code };
  return out;
}
