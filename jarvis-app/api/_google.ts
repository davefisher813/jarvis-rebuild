// THE GOOGLE GRANT, IN ONE PLACE (2026-09-19).
//
// The stored refresh token, the cipher around it, and the two OAuth clients it
// might belong to were private to api/google.ts, which is right for as long as
// sign-in is the only thing that needs them. The booking confirmation needs
// them too: a stranger books a time and the receipt has to come from the
// host's own mailbox, and there is no session on that request to carry a
// token. So this is the shared floor, moved rather than copied. A second copy
// of AES-GCM code is how two copies drift and one of them stops decrypting
// what the other wrote.
//
// Nothing here reads process.env. The caller passes what it has, so a
// mistake is a missing argument at build time rather than a silent fallback.

import { openSecret, sealSecret, needsUpgrade, type KeyRing, type SecretKind } from "../src/connections/google/tokenEnvelope";
import {
  LOCK_TTL_SECONDS, MAX_ATTEMPTS, SKEW_MS, WAIT_FOR_WINNER_MS, WAIT_POLL_MS,
  backoffMs, classifyRefresh, expiryOf, isFresh, likelyDeathCause,
} from "../src/connections/google/tokenLifecycle";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

// WHICH CLIENT A TOKEN BELONGS TO. Google refreshes a token only with the
// client that issued it. A token from the iPhone's native connect was issued
// to the iOS client, which has no secret. The client is recorded INSIDE the
// encrypted value (no schema change): native tokens are stored as
// "ios:" + token. Google refresh tokens begin "1//", so the tag cannot
// collide with one.
export const IOS_TAG = "ios:";

async function cipherKey(secretB64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(secretB64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encrypt(plain: string, secretB64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await cipherKey(secretB64);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)));
  const packed = new Uint8Array(iv.length + ct.length);
  packed.set(iv); packed.set(ct, iv.length);
  return btoa(String.fromCharCode(...packed));
}

export async function decrypt(packedB64: string, secretB64: string): Promise<string> {
  const packed = Uint8Array.from(atob(packedB64), (c) => c.charCodeAt(0));
  const key = await cipherKey(secretB64);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: packed.slice(0, 12) }, key, packed.slice(12));
  return new TextDecoder().decode(plain);
}

export interface GoogleClients { clientId: string; clientSecret: string; iosClientId: string }
/** `expiresIn` is seconds as Google said them, or 0 when Google said nothing usable: never an assumed hour. */
export interface Refreshed {
  accessToken: string;
  expiresIn: number;
  scope?: string;
  /** Present only when Google rotated the refresh token. Absent means KEEP the stored one. */
  refreshToken?: string;
  /** Present only for a Testing-mode app: how long the refresh token itself has to live. */
  refreshTokenExpiresIn?: number;
}
export type RefreshOutcome = { ok: true; got: Refreshed } | { ok: false; error: string; status: number; retryAfter?: number };

// WHY A REFRESH FAILED, IN WORDS THE APP CAN ACT ON (2026-09-29).
//
// api/google.ts used to answer every refresh failure with a bare status and
// an error string, and the app collapsed all of them to "no token", so a dead
// network, a revoked grant and a database blip all sent the person through
// the Google chooser. Each cause now has one stable code. The client keys its
// behaviour on the CODE (which failures may ever open the chooser, which are
// worth a retry) and shows the MESSAGE. The messages are Dave's handoff
// wording; `[account]` is the address. Nothing here ever carries a token or
// any mail content.
export const GOOGLE_CODES = [
  "GOOGLE_NO_STORED_SIGNIN",
  "GOOGLE_STORED_SIGNIN_UNREADABLE",
  "GOOGLE_SIGNIN_REVOKED",
  "GOOGLE_REFRESH_UNAVAILABLE",
  "GOOGLE_NETWORK_ERROR",
  "GOOGLE_AUTH_EXPIRED",
  "GOOGLE_STORAGE_FAILURE",
] as const;
export type GoogleCode = (typeof GOOGLE_CODES)[number];

export interface GoogleFailure { code: GoogleCode; message: string; retryable: boolean; status: number }

export function googleFailure(code: GoogleCode, account = ""): GoogleFailure {
  const who = account || "this account";
  switch (code) {
    case "GOOGLE_NO_STORED_SIGNIN":
      return { code, status: 410, retryable: false, message: `Google isn't set to stay signed in. Reconnect ${who}.` };
    case "GOOGLE_STORED_SIGNIN_UNREADABLE":
      return { code, status: 410, retryable: false, message: `The saved Google sign-in couldn't be opened. Reconnect ${who}.` };
    case "GOOGLE_SIGNIN_REVOKED":
      return { code, status: 410, retryable: false, message: `Google revoked this sign-in. Reconnect ${who}.` };
    case "GOOGLE_REFRESH_UNAVAILABLE":
      return { code, status: 502, retryable: true, message: "Google couldn't refresh right now. Try again." };
    case "GOOGLE_NETWORK_ERROR":
      return { code, status: 503, retryable: true, message: "Couldn't reach Google. Check your connection and try again." };
    case "GOOGLE_AUTH_EXPIRED":
      return { code, status: 401, retryable: false, message: "Your JARVIS sign-in expired. Sign in again." };
    case "GOOGLE_STORAGE_FAILURE":
      return { code, status: 503, retryable: true, message: "JARVIS couldn't reach its saved sign-ins. Try again." };
  }
}

/** A fresh access token from a stored refresh token. One call to Google, no retry: the lifecycle (getAccessToken) owns retry and state.
 *
 *  A tagged token goes straight to the iOS client. An untagged one is web, or
 *  a native token stored before the tag existed: try web, then iOS, and only
 *  report failure once every client it could belong to has refused it, so a
 *  phone's token is never treated as revoked for being tried against the
 *  wrong client first. */
export async function refreshAccessToken(
  stored: string,
  clients: GoogleClients,
): Promise<RefreshOutcome> {
  const tagged = stored.startsWith(IOS_TAG);
  const refreshToken = tagged ? stored.slice(IOS_TAG.length) : stored;
  type Tok = { access_token?: string; expires_in?: number; scope?: string; error?: string; refresh_token?: string; refresh_token_expires_in?: number };
  const attempt = async (params: Record<string, string>): Promise<{ ok: boolean; status: number; retryAfter?: number; tok: Tok }> => {
    const r = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ refresh_token: refreshToken, grant_type: "refresh_token", ...params }),
    });
    const ra = Number(r.headers?.get?.("retry-after") || "") || undefined;
    // A 5xx with an HTML body is Google being down, not a broken client:
    // an unreadable body becomes an empty one so it is reported as a failed
    // refresh. Only a fetch that never completes throws (a network failure).
    return { ok: r.ok, status: r.status, ...(ra ? { retryAfter: ra } : {}), tok: (await r.json().catch(() => ({}))) as Tok };
  };
  const viaWeb = () => attempt({ client_id: clients.clientId, client_secret: clients.clientSecret });
  // The iOS client has no secret; the token alone proves it (see IOS_TAG).
  const viaIos = () => attempt({ client_id: clients.iosClientId });

  let res = tagged && clients.iosClientId ? await viaIos() : await viaWeb();
  if ((!res.ok || !res.tok.access_token) && !tagged && clients.iosClientId) {
    const second = await viaIos();
    if (second.ok && second.tok.access_token) res = second;
  }
  if (!res.ok || !res.tok.access_token) return { ok: false, error: res.tok.error || "Refresh failed", status: res.status, ...(res.retryAfter ? { retryAfter: res.retryAfter } : {}) };
  return {
    ok: true,
    got: {
      accessToken: res.tok.access_token,
      // Zero when Google said nothing usable. The caller treats that as "refresh next time", never as an hour.
      expiresIn: typeof res.tok.expires_in === "number" && Number.isFinite(res.tok.expires_in) && res.tok.expires_in > 0 ? res.tok.expires_in : 0,
      ...(res.tok.scope ? { scope: res.tok.scope } : {}),
      // Google normally omits this. When it is there it replaces the stored token; when it is not, the stored one stays.
      ...(res.tok.refresh_token ? { refreshToken: res.tok.refresh_token } : {}),
      ...(typeof res.tok.refresh_token_expires_in === "number" && res.tok.refresh_token_expires_in > 0 ? { refreshTokenExpiresIn: res.tok.refresh_token_expires_in } : {}),
    },
  };
}

// ============================================================================
// THE TOKEN LIFECYCLE (Foundation Fix Spec 2, 2026-10-07).
//
// ONE credential store (google_tokens, service role only), ONE way to get an
// access token (getAccessToken), ONE revocation path (handleRevokedGrant),
// ONE disconnect (forgetGrant). The sign-in function, every mail route, the
// booking receipt, the status endpoint and the background worker all come
// through here, so there is nowhere else for two answers to be born.
//
// WHAT IT GUARANTEES
//   - A DEAD row is never used. A grant Google revoked is marked DEAD and KEPT
//     for audit; no code path hands out its token, and nothing deletes it on
//     a failure.
//   - invalid_grant is terminal: never retried, at any level. Transient causes
//     (429, 5xx, the network) back off with full jitter and honour Retry-After.
//   - At most one refresh in flight per account. Inside one isolate the callers
//     share a promise; across workers an atomic lock with a TTL decides, and
//     the loser waits for and reuses the winner's result. Two workers cannot
//     both POST the same refresh token, so a healthy account is never given a
//     false invalid_grant by its own race.
//   - A refresh response with no refresh_token leaves the stored one alone.
//   - expires_at is the absolute instant Google gave, at arrival. Missing or
//     unparseable means refresh again, never an assumed hour.
//   - Every state change is one transaction with its email_account mirror
//     (migration 0057), so the mailbox can never lag the token row.
//
// BEFORE MIGRATION 0057 IS APPLIED the same functions still work: no cache, no
// lock, no DEAD mark (the mailbox is moved to reauth through the older
// email_account_state), and nothing is deleted. That is deliberate, so a
// deploy never has to wait on a database paste.
// ============================================================================

export interface GoogleStore {
  supaUrl: string;
  service: string;
  /** The key-encryption key. */
  tokenKey: string;
  /** The key it replaced, accepted for opening while secrets are rewritten under the new one. */
  tokenKeyPrev?: string;
  clients: GoogleClients;
}

/** Who asked. Recorded (as a code, never a name) on a revocation so the two paths can be told apart. */
export type TokenSource = "app" | "email" | "send" | "booking" | "status" | "worker" | "api";

export type TokenFailureKind = "revoked" | "no_signin" | "unreadable" | "transient" | "storage";

export type AccessResult =
  | { ok: true; accessToken: string; email: string; expiresAt: number; expiresIn: number; scope?: string; fresh: boolean }
  | { ok: false; kind: TokenFailureKind; code: GoogleCode; detail: string };

export interface AccessOpts {
  userId: string;
  email: string;
  source: TokenSource;
  /** Refresh at Google now even if a cached token is good (the status proof, a 401 renewal). */
  force?: boolean;
  /** Test seam: skip the in-isolate promise sharing so the cross-worker lock is what gets exercised. */
  coalesce?: boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

interface TokenRow {
  token_enc: string;
  state?: "VALID" | "DEAD";
  access_enc?: string | null;
  access_expires_at?: string | null;
  refresh_expires_at?: string | null;
  granted_scope?: string | null;
  granted_at?: string | null;
  last_refresh_ok_at?: string | null;
}

const ROW_COLUMNS = "token_enc,state,access_enc,access_expires_at,refresh_expires_at,granted_scope,granted_at,last_refresh_ok_at";

const lc = (e: string): string => e.trim().toLowerCase();
const ringOf = (s: GoogleStore): KeyRing => ({ current: s.tokenKey, ...(s.tokenKeyPrev ? { previous: s.tokenKeyPrev } : {}) });
const svc = (s: GoogleStore): Record<string, string> => ({ apikey: s.service, Authorization: "Bearer " + s.service, "content-type": "application/json" });
const iso = (ms: number): string => new Date(ms).toISOString();
const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface RpcAnswer { ok: boolean; status: number; data: unknown }

async function rpc(s: GoogleStore, fn: string, args: Record<string, unknown>): Promise<RpcAnswer> {
  try {
    const r = await fetch(`${s.supaUrl}/rest/v1/rpc/${fn}`, { method: "POST", headers: svc(s), body: JSON.stringify(args) });
    return { ok: r.ok, status: r.status, data: await r.json().catch(() => null) };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

/** The function is not there: migration 0057 has not been applied yet. */
const missing = (a: RpcAnswer): boolean => !a.ok && (a.status === 404 || a.status === 400);

const REASON: Record<TokenFailureKind, GoogleCode> = {
  revoked: "GOOGLE_SIGNIN_REVOKED",
  no_signin: "GOOGLE_NO_STORED_SIGNIN",
  unreadable: "GOOGLE_STORED_SIGNIN_UNREADABLE",
  transient: "GOOGLE_REFRESH_UNAVAILABLE",
  storage: "GOOGLE_STORAGE_FAILURE",
};
const bad = (kind: TokenFailureKind, detail: string, code?: GoogleCode): AccessResult => ({ ok: false, kind, code: code ?? REASON[kind], detail });

async function readRow(s: GoogleStore, userId: string, email: string): Promise<{ ok: true; row: TokenRow | null; full: boolean } | { ok: false }> {
  const url = (cols: string) => `${s.supaUrl}/rest/v1/google_tokens?user_id=eq.${encodeURIComponent(userId)}&email=eq.${encodeURIComponent(email)}&select=${cols}`;
  try {
    let r = await fetch(url(ROW_COLUMNS), { headers: svc(s) });
    let full = true;
    // Migration 0057 not applied: the lifecycle columns do not exist, which PostgREST answers as a 400.
    if (r.status === 400) { r = await fetch(url("token_enc"), { headers: svc(s) }); full = false; }
    if (!r.ok) return { ok: false };
    const rows = (await r.json()) as TokenRow[];
    // One row per (user, email) is the table's shape; anything else is storage being wrong, not an answer about the person.
    if (rows.length > 1) return { ok: false };
    return { ok: true, row: rows[0] ?? null, full };
  } catch {
    return { ok: false };
  }
}

async function open(s: GoogleStore, packed: string, userId: string, email: string, kind: SecretKind): Promise<string | null> {
  try { return await openSecret(packed, ringOf(s), { userId, email, kind }); } catch { return null; }
}

async function releaseLock(s: GoogleStore, userId: string, email: string): Promise<void> {
  try {
    await fetch(`${s.supaUrl}/rest/v1/google_tokens?user_id=eq.${encodeURIComponent(userId)}&email=eq.${encodeURIComponent(email)}`, {
      method: "PATCH", headers: svc(s), body: JSON.stringify({ refresh_lock_until: null }),
    });
  } catch { /* the lock's own TTL frees it */ }
}

const inflight = new Map<string, Promise<AccessResult>>();

/** An access token for one account, from the cache, or from one refresh at Google. The ONLY way a caller gets one. */
export function getAccessToken(s: GoogleStore, o: AccessOpts): Promise<AccessResult> {
  if (o.coalesce === false) return mint(s, o);
  const key = `${o.userId}|${lc(o.email)}|${o.force ? 1 : 0}`;
  const held = inflight.get(key);
  if (held) return held;
  const p = mint(s, o).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function cachedFrom(s: GoogleStore, row: TokenRow, o: AccessOpts, email: string, now: number): Promise<AccessResult | null> {
  if (!row.access_enc || !isFresh(row.access_expires_at, now)) return null;
  const token = await open(s, row.access_enc, o.userId, email, "access");
  if (!token) return null;
  const expiresAt = new Date(row.access_expires_at!).getTime();
  return { ok: true, accessToken: token, email, expiresAt, expiresIn: Math.max(0, Math.floor((expiresAt - now) / 1000)), ...(row.granted_scope ? { scope: row.granted_scope } : {}), fresh: false };
}

async function mint(s: GoogleStore, o: AccessOpts): Promise<AccessResult> {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? defaultSleep;
  const email = lc(o.email);

  const read = await readRow(s, o.userId, email);
  if (!read.ok) return bad("storage", "storage_read");
  if (!read.row) return bad("no_signin", "no_row");
  // A DEAD grant is never used, and Google is not asked: it already said no.
  if (read.full && read.row.state === "DEAD") return bad("revoked", "dead_grant");

  if (read.full && !o.force) {
    const cached = await cachedFrom(s, read.row, o, email, now());
    if (cached) return cached;
  }

  // ---- single flight: take the lock, or wait for whoever holds it ------------
  let seen = read.row;
  let locked = false;
  if (read.full) {
    for (let waited = 0; ; waited += WAIT_POLL_MS) {
      const got = await rpc(s, "google_refresh_lock", { p_user: o.userId, p_email: email, p_ttl: LOCK_TTL_SECONDS });
      if (!got.ok) {
        if (missing(got)) break; // not migrated after all: go without a lock
        return bad("storage", "lock");
      }
      if (got.data === true) { locked = true; break; }
      if (waited >= WAIT_FOR_WINNER_MS) return bad("transient", "refresh_in_flight");
      await sleep(WAIT_POLL_MS);
      const again = await readRow(s, o.userId, email);
      if (!again.ok) return bad("storage", "storage_read");
      if (!again.row) return bad("no_signin", "no_row");
      if (again.row.state === "DEAD") return bad("revoked", "dead_grant");
      // The winner finished: reuse its result. A forced caller wants a NEW token, not the one it already saw.
      if (!o.force || again.row.access_expires_at !== seen.access_expires_at) {
        const theirs = await cachedFrom(s, again.row, o, email, now());
        if (theirs) return theirs;
      }
      seen = again.row;
    }
  }

  // Someone may have refreshed between our first read and taking the lock.
  if (locked) {
    const recheck = await readRow(s, o.userId, email);
    if (recheck.ok && recheck.row) {
      if (recheck.row.state === "DEAD") { await releaseLock(s, o.userId, email); return bad("revoked", "dead_grant"); }
      if (!o.force || recheck.row.access_expires_at !== read.row.access_expires_at) {
        const theirs = await cachedFrom(s, recheck.row, o, email, now());
        if (theirs) { await releaseLock(s, o.userId, email); return theirs; }
      }
      seen = recheck.row;
    }
  }

  const stored = await open(s, seen.token_enc, o.userId, email, "refresh");
  if (stored === null) {
    if (locked) await releaseLock(s, o.userId, email);
    return bad("unreadable", "cannot_open");
  }

  // ---- one refresh, with the error taxonomy -----------------------------------
  let out: RefreshOutcome | null = null;
  let thrown = false;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      out = await refreshAccessToken(stored, s.clients);
      thrown = false;
    } catch {
      out = { ok: false, error: "network_error", status: 0 };
      thrown = true;
    }
    if (out.ok) break;
    const verdict = classifyRefresh(out.error, out.status);
    if (verdict !== "transient" || attempt === MAX_ATTEMPTS - 1) break;
    await sleep(backoffMs(attempt, out.retryAfter, o.random));
  }

  if (out && out.ok) return recordSuccess(s, o, email, seen, stored, out.got, locked, now());

  const failure = out as Extract<RefreshOutcome, { ok: false }>;
  const verdict = classifyRefresh(failure.error, failure.status);
  if (verdict === "terminal") {
    await handleRevokedGrant(s, { userId: o.userId, email, source: o.source, code: failure.error.match(/invalid_grant|invalid_token|invalid_client|unauthorized_client/i)?.[0]?.toLowerCase() ?? "invalid_grant", httpStatus: failure.status, row: seen, now: now() });
    return bad("revoked", "invalid_grant");
  }
  // Transient or rejected: nothing is learned about the grant. Counted, lock released, state untouched.
  if (read.full) await rpc(s, "google_refresh_failed", { p_user: o.userId, p_email: email });
  else if (locked) await releaseLock(s, o.userId, email);
  return bad("transient", verdict === "rejected" ? "rejected" : thrown ? "network_error" : "refresh_unavailable", thrown ? "GOOGLE_NETWORK_ERROR" : "GOOGLE_REFRESH_UNAVAILABLE");
}

async function recordSuccess(s: GoogleStore, o: AccessOpts, email: string, row: TokenRow, stored: string, got: Refreshed, locked: boolean, t: number): Promise<AccessResult> {
  const expiresAt = expiryOf(got.expiresIn, t);
  const ring = ringOf(s);
  // No usable expiry from Google: the token is handed to this caller and NOT cached, so the next one refreshes.
  const cacheable = got.expiresIn > 0;
  const accessEnc = cacheable ? await sealSecret(got.accessToken, ring, { userId: o.userId, email, kind: "access" }) : null;
  // A rotated token replaces the stored one (keeping the iOS tag). One Google did not send leaves the stored one exactly as it is,
  // except that a secret still in the original format, or under a retired key, is rewritten into the current envelope.
  const plain = got.refreshToken ? (stored.startsWith(IOS_TAG) ? IOS_TAG + got.refreshToken : got.refreshToken) : (await needsUpgrade(row.token_enc, ring)) ? stored : null;
  const refreshEnc = plain === null ? null : await sealSecret(plain, ring, { userId: o.userId, email, kind: "refresh" });
  const rec = await rpc(s, "google_refresh_record", {
    p_user: o.userId, p_email: email, p_access_enc: accessEnc, p_access_exp: cacheable ? iso(expiresAt) : null,
    p_refresh_enc: refreshEnc, p_refresh_exp: got.refreshTokenExpiresIn ? iso(t + got.refreshTokenExpiresIn * 1000) : null, p_scope: got.scope ?? null,
  });
  if (rec.ok && (rec.data as { error?: string } | null)?.error === "NOT_VALID") {
    // The grant was revoked, or forgotten, while this refresh was in flight. The result is discarded: it must not outlive what it was minted for.
    return bad("revoked", "dead_grant");
  }
  if (!rec.ok && missing(rec) === false && locked) await releaseLock(s, o.userId, email);
  return { ok: true, accessToken: got.accessToken, email, expiresAt, expiresIn: Math.max(0, Math.floor((expiresAt - t) / 1000)), ...(got.scope ? { scope: got.scope } : {}), fresh: true };
}

// ---- THE ONE REVOCATION PATH ------------------------------------------------

/** Both failure paths (the sign-in function's refresh and the mail routes' token mint) end here, and nowhere else.
 *  On a confirmed invalid_grant: the row is marked DEAD and KEPT, the mailbox moves to reauth, and the failure is recorded as
 *  PROVIDER_AUTH with redacted metadata (when, which path, which code, which HTTP status, the likely cause), all in one transaction.
 *  `first` is true only for the call that found it, which is what the loud announcement keys on (Spec 3): once per incident,
 *  never reopened. The announcement itself is Spec 3's; this returns the fact it needs. */
export async function handleRevokedGrant(
  s: GoogleStore,
  o: { userId: string; email: string; source: TokenSource; code: string; httpStatus: number; row?: TokenRow | null; now?: number },
): Promise<{ first: boolean; cause: ReturnType<typeof likelyDeathCause> }> {
  const email = lc(o.email);
  const t = o.now ?? Date.now();
  const ms = (v: string | null | undefined): number | null => { const n = v ? new Date(v).getTime() : NaN; return Number.isFinite(n) ? n : null; };
  const cause = likelyDeathCause({
    nowMs: t,
    grantedAtMs: ms(o.row?.granted_at), lastRefreshOkMs: ms(o.row?.last_refresh_ok_at), refreshExpiresAtMs: ms(o.row?.refresh_expires_at),
  });
  const r = await rpc(s, "google_grant_revoked", { p_user: o.userId, p_email: email, p_source: o.source, p_code: o.code, p_http: o.httpStatus, p_cause: cause });
  if (r.ok) return { first: (r.data as { first?: boolean } | null)?.first === true, cause };
  if (missing(r)) {
    // Migration 0057 not applied: nothing to mark DEAD, so move the mailbox to reauth the older way. Nothing is deleted.
    try {
      const acc = await fetch(`${s.supaUrl}/rest/v1/email_account?owner_id=eq.${encodeURIComponent(o.userId)}&address=eq.${encodeURIComponent(email)}&select=id`, { headers: svc(s) });
      const id = acc.ok ? ((await acc.json()) as { id: string }[])[0]?.id : undefined;
      if (id) await rpc(s, "email_account_state", { p_owner: o.userId, p_account: id, p_state: "reauth", p_error: "Reconnect Gmail to continue." });
    } catch { /* the caller still reports the failure */ }
  }
  return { first: false, cause };
}

// ---- DISCONNECT: THE KILL SWITCH ---------------------------------------------

/** Disconnect one account: the grant is invalid locally the moment this returns ok, and revoked at Google best-effort.
 *  The token row and the mailbox's credential reference go together; the mailbox row stays, disconnected, with its cache and every
 *  approved record. Nothing is left that a queued worker could act with. */
export async function forgetGrant(
  s: GoogleStore,
  o: { userId: string; email: string; source: TokenSource },
): Promise<{ ok: true; revokedAtGoogle: boolean } | { ok: false }> {
  const email = lc(o.email);
  const read = await readRow(s, o.userId, email);
  if (!read.ok) return { ok: false };
  const secret = read.row ? await open(s, read.row.token_enc, o.userId, email, "refresh") : null;

  const del = await rpc(s, "google_signin_forget", { p_user: o.userId, p_email: email });
  if (!del.ok) {
    if (!missing(del)) return { ok: false };
    // Migration 0057 not applied: delete the row the older way.
    try {
      const d = await fetch(`${s.supaUrl}/rest/v1/google_tokens?user_id=eq.${encodeURIComponent(o.userId)}&email=eq.${encodeURIComponent(email)}`, { method: "DELETE", headers: svc(s) });
      if (!d.ok) return { ok: false };
    } catch { return { ok: false }; }
  }

  // Best effort, and never allowed to undo or delay the local disconnect: Google being down must not leave the person connected.
  let revokedAtGoogle = false;
  if (secret) {
    try {
      const token = secret.startsWith(IOS_TAG) ? secret.slice(IOS_TAG.length) : secret;
      const r = await fetch(REVOKE_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "token=" + encodeURIComponent(token), signal: AbortSignal.timeout(4000) });
      revokedAtGoogle = r.ok;
    } catch { /* a failed courtesy */ }
  }
  return { ok: true, revokedAtGoogle };
}

// ---- CONNECT -------------------------------------------------------------------

/** Store what Google just sent, and say whether the sign-in will be there tomorrow. Never throws: every failure is a code.
 *  `refreshToken` absent means Google sent none (it does that for an account that already consented): the stored one is left
 *  exactly as it is, and a DEAD row is NOT revived by it, because a dead grant cannot be brought back by consent that returned
 *  nothing usable. */
export async function keepSignIn(
  s: GoogleStore,
  o: { userId: string; email: string; refreshToken?: string; accessToken: string; expiresIn?: number; scope?: string; refreshTokenExpiresIn?: number; native?: boolean; now?: number },
): Promise<{ remembered: true } | { remembered: false; code: GoogleCode }> {
  const email = lc(o.email);
  const t = o.now ?? Date.now();
  const ring = ringOf(s);
  try {
    const cacheable = typeof o.expiresIn === "number" && o.expiresIn > 0;
    const accessEnc = cacheable ? await sealSecret(o.accessToken, ring, { userId: o.userId, email, kind: "access" }) : null;
    const refreshEnc = o.refreshToken ? await sealSecret((o.native ? IOS_TAG : "") + o.refreshToken, ring, { userId: o.userId, email, kind: "refresh" }) : null;
    const kept = await rpc(s, "google_signin_keep", {
      p_user: o.userId, p_email: email, p_refresh_enc: refreshEnc, p_access_enc: accessEnc,
      p_access_exp: cacheable ? iso(expiryOf(o.expiresIn, t)) : null,
      p_refresh_exp: o.refreshTokenExpiresIn ? iso(t + o.refreshTokenExpiresIn * 1000) : null, p_scope: o.scope ?? null,
    });
    if (kept.ok) {
      const err = (kept.data as { error?: string } | null)?.error;
      if (!err) return { remembered: true };
      return { remembered: false, code: err === "NO_STORED_SIGNIN" || err === "NO_REFRESH_TOKEN" ? "GOOGLE_NO_STORED_SIGNIN" : "GOOGLE_STORAGE_FAILURE" };
    }
    if (!missing(kept)) return { remembered: false, code: "GOOGLE_STORAGE_FAILURE" };

    // Migration 0057 not applied: the older upsert, then the mirror through the older email_account_upsert.
    const rest = `${s.supaUrl}/rest/v1/google_tokens`;
    if (refreshEnc) {
      const w = await fetch(rest, { method: "POST", headers: { ...svc(s), Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ user_id: o.userId, email, token_enc: refreshEnc, updated_at: iso(t) }) });
      if (!w.ok) return { remembered: false, code: "GOOGLE_STORAGE_FAILURE" };
    } else {
      const have = await readRow(s, o.userId, email);
      if (!have.ok) return { remembered: false, code: "GOOGLE_STORAGE_FAILURE" };
      if (!have.row) return { remembered: false, code: "GOOGLE_NO_STORED_SIGNIN" };
      if ((await open(s, have.row.token_enc, o.userId, email, "refresh")) === null) return { remembered: false, code: "GOOGLE_STORED_SIGNIN_UNREADABLE" };
    }
    await rpc(s, "email_account_upsert", { p_owner: o.userId, p_address: email, p_scopes: [], p_capabilities: { archive: true, trash: true, read: true } });
    return { remembered: true };
  } catch {
    return { remembered: false, code: "GOOGLE_STORAGE_FAILURE" };
  }
}

// ---- BOOKING: THE HOST'S OWN MAILBOX ---------------------------------------------

export interface Mailbox { accessToken: string; email: string }

/** The mailbox a given user has connected, ready to send from, or null.
 *
 *  Null is an ordinary answer and not an error: a user who has never
 *  connected Google, or whose grant has been revoked, simply has no mailbox
 *  here, and every caller must be able to carry on without one. A DEAD row is
 *  skipped: it is never used. This never deletes anything; forgetting a grant
 *  is a decision that belongs to the sign-in path, which can tell the person
 *  about it. */
export async function ownerMailbox(opts: {
  supaUrl: string; service: string; tokenKey: string; tokenKeyPrev?: string; clients: GoogleClients; userId: string;
}): Promise<Mailbox | null> {
  const { supaUrl, service, tokenKey, clients, userId } = opts;
  if (!supaUrl || !service || !tokenKey || !clients.clientId) return null;
  const store: GoogleStore = { supaUrl, service, tokenKey, ...(opts.tokenKeyPrev ? { tokenKeyPrev: opts.tokenKeyPrev } : {}), clients };
  try {
    // The most recently refreshed mailbox, when somebody has connected more
    // than one: the account they are actually using.
    const list = async (cols: string) => fetch(`${supaUrl}/rest/v1/google_tokens?user_id=eq.${encodeURIComponent(userId)}&select=${cols}&order=updated_at.desc`, { headers: svc(store) });
    let r = await list("email,state");
    if (r.status === 400) r = await list("email");
    if (!r.ok) return null;
    const found = (await r.json()) as { email: string; state?: string }[];
    const row = found.find((x) => x.state !== "DEAD");
    if (!row) return null;
    const got = await getAccessToken(store, { userId, email: row.email, source: "booking" });
    return got.ok ? { accessToken: got.accessToken, email: got.email } : null;
  } catch {
    return null;
  }
}

/** Hand one already-encoded message to Gmail. Returns whether it went, never
 *  throws: every caller here is sending a courtesy alongside work that has
 *  already succeeded, and a failed courtesy must not undo it. */
export async function sendRaw(accessToken: string, raw: string): Promise<boolean> {
  try {
    const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
