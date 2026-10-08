// THE RULES OF A STORED GOOGLE GRANT, AS PURE FUNCTIONS (Foundation Fix Spec 2).
//
// api/_google.ts does the I/O. What it DECIDES lives here, so each rule can be
// held by a test without a network, and so the status code and the lifecycle
// code cannot come to mean two different things by "revoked".

/** The provider saying the grant itself is gone. Terminal: never retried, at any level. */
export const AUTH_ERRORS = /invalid_grant|invalid_token|invalid_client|unauthorized_client/i;

/** A token within this of dying is refreshed inline, before the call that needs it can 401. */
export const SKEW_MS = 10 * 60e3;

/** How long one worker may hold an account's refresh lock. A dead worker blocks it for this long, never forever. */
export const LOCK_TTL_SECONDS = 15;

/** How long a caller that lost the race waits for the winner's result before giving up as transient. */
export const WAIT_FOR_WINNER_MS = 8_000;
export const WAIT_POLL_MS = 250;

/** An account nobody has refreshed for this long is refreshed by the background worker, ahead of Google's six-month non-use death. */
export const IDLE_REFRESH_AFTER_MS = 30 * 24 * 3600e3;

/** The attempts a transient failure gets, counting the first. */
export const MAX_ATTEMPTS = 3;

export type RefreshVerdict = "terminal" | "transient" | "rejected";

/** What a failed refresh means.
 *   terminal   the grant is gone (invalid_grant and kin): mark it DEAD, never retry, wait for the person.
 *   transient  Google or the network, a throttle or a 5xx: back off and try again.
 *   rejected   Google refused the request itself (a malformed one, an unsupported grant type): retrying cannot help and the
 *              grant is not proven bad, so neither retry nor DEAD. */
export function classifyRefresh(error: string, status: number): RefreshVerdict {
  if (AUTH_ERRORS.test(error)) return "terminal";
  if (status === 0 || status === 429 || status >= 500) return "transient";
  // An unreadable body on a 4xx says nothing about the grant either; only a named client error is a rejection.
  return /invalid_request|unsupported_grant_type|invalid_scope|redirect_uri_mismatch|access_denied/i.test(error) ? "rejected" : "transient";
}

/** Full jitter, honouring Retry-After: wait a random time up to an exponentially growing ceiling, or what Google asked for when it asked. */
export function backoffMs(attempt: number, retryAfterSeconds: number | undefined, random: () => number = Math.random): number {
  if (retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds, 8) * 1000;
  }
  const ceiling = Math.min(4000, 400 * 2 ** attempt);
  return Math.floor(random() * ceiling);
}

/** The absolute instant a token dies, from what Google said when it arrived. Missing, unparseable or non-positive means "refresh now":
 *  there is no assuming an hour, because an assumed hour is how a token expires under a call that trusted it. */
export function expiryOf(expiresIn: unknown, arrivedAtMs: number): number {
  const s = typeof expiresIn === "number" ? expiresIn : typeof expiresIn === "string" ? Number(expiresIn) : NaN;
  return Number.isFinite(s) && s > 0 ? arrivedAtMs + Math.floor(s * 1000) : arrivedAtMs;
}

/** Whether a cached access token is still good enough to hand out. An unparseable stamp is never good enough. */
export function isFresh(expiresAt: string | number | null | undefined, nowMs: number, skewMs: number = SKEW_MS): boolean {
  if (expiresAt === null || expiresAt === undefined) return false;
  const t = typeof expiresAt === "number" ? expiresAt : new Date(expiresAt).getTime();
  return Number.isFinite(t) && t - nowMs > skewMs;
}

export type DeathCause = "testing_mode_7_day" | "six_month_non_use" | "revoked_or_password_change";

const DAY = 24 * 3600e3;

/** WHY A GRANT PROBABLY DIED, from what the row itself shows. A hint for the person and the operator, never a verdict: Google does not say.
 *  Google's documented causes: a Testing-mode app's seven-day refresh-token life (the refresh response reports refresh_token_expires_in),
 *  six months without use, and the person revoking, changing a password that held Gmail scopes, a Workspace admin blocking the app, or
 *  the hundred-token cap silently retiring the oldest. The last four look the same from here. */
export function likelyDeathCause(i: { nowMs: number; grantedAtMs: number | null; lastRefreshOkMs: number | null; refreshExpiresAtMs: number | null }): DeathCause {
  if (i.refreshExpiresAtMs !== null && i.nowMs >= i.refreshExpiresAtMs - 60_000) return "testing_mode_7_day";
  const idle = i.nowMs - (i.lastRefreshOkMs ?? i.grantedAtMs ?? i.nowMs);
  if (idle >= 180 * DAY) return "six_month_non_use";
  if (i.grantedAtMs !== null) {
    const age = i.nowMs - i.grantedAtMs;
    // About a week old with nothing else changed: the Testing-mode clock, even when Google never said so.
    if (age >= 6.5 * DAY && age <= 7.5 * DAY) return "testing_mode_7_day";
  }
  return "revoked_or_password_change";
}
