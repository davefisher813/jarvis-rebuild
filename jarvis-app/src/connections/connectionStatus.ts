// ONE STATUS PER ACCOUNT, PROVEN BY EVIDENCE (Foundation Fix Spec 1, 2026-10-06).
//
// The failure this exists for: the app said "connected", the backend said
// invalid_grant, and both were reading a stored token as if its presence were
// evidence. A stored token is not evidence. A successful authenticated
// provider request is. So the server (api/connections/status.ts) refreshes the
// token and makes ONE named, harmless read against Gmail (users.getProfile),
// checks the address Google answers with is the address the row was stored
// for, and reports what it saw. This file is the pure half: the vocabulary,
// the classification of what came back, and the client's own staleness clock.
// The server and the app import the same functions, so there is one meaning.
//
// Dimensions are separate fields, never one enum (failure-modes section 17):
// whether the credential is valid says nothing about whether mail is arriving,
// and neither says whether a send would go.

import { AUTH_ERRORS } from "./google/tokenLifecycle";
import type { Incident, PausedWork } from "./incident";

export const STATUS_PATH = "/api/connections/status";

/** The named read that proves a mailbox. Recorded in every receipt. */
export const VERIFIED_READ_OP = "gmail.users.getProfile";

export const AUTH_STATES = ["valid", "revoked", "unknown"] as const;
export type AuthState = (typeof AUTH_STATES)[number];

/** The four honest states a surface may show. */
export const UI_STATES = ["connected", "warning", "error", "pending_auth"] as const;
export type UiState = (typeof UI_STATES)[number];

/** Transient causes. None of them ever offers a reconnect. */
export const TRANSIENTS = ["service_unavailable", "temporarily_limited"] as const;
export type Transient = (typeof TRANSIENTS)[number];

/** A receipt names exactly which operation was tested and what came of it. No token, no mail, no address of anyone else. */
export interface Receipt {
  operation: string;
  at: string;
  ok: boolean;
  /** The address Google answered with matched the address this sign-in is stored for. Null when no read was made. */
  identityMatched: boolean | null;
}

export interface AccountStatus {
  email: string;
  auth_state: AuthState;
  state: UiState;
  transient: Transient | null;
  lastSuccessfulRefreshAt: string | null;
  /** A stable machine code (invalid_grant, http_429, identity_mismatch...), never provider text. */
  lastError: string | null;
  lastErrorAt: string | null;
  lastSuccessfulSyncAt: string | null;
  syncCoverage: { days: number; through: string } | null;
  sendReady: { ready: boolean; reason: string };
  /** Delivery-channel health, separate from credential health. This build has
   *  no push channel (nothing calls Gmail watch), so delivery is polling and
   *  its liveness is how recent the last successful sync is. */
  delivery: { kind: "poll"; liveness: "fresh" | "stale" | "never" };
  receipt: Receipt | null;
  /** When the server last proved this account. */
  checkedAt: string;
  /** The confirmed loss this account is in, if any (Spec 3). Absent on an answer from before incidents, which reads as none. */
  incident?: Incident | null;
  /** Work waiting on this mailbox, only while an incident is open. Counts, never content. */
  paused?: PausedWork | null;
}

export interface StatusResponse {
  checkedAt: string;
  accounts: AccountStatus[];
}

/** Sync coverage window the Email tab keeps (the 90-day rule). */
export const COVERAGE_DAYS = 90;
/** A server answer older than this is stale, whatever it says. */
export const STATUS_STALE_MS = 15 * 60e3;
/** Delivery is stale when nothing has synced for this long. */
export const SYNC_STALE_MS = 24 * 3600e3;
/** The server re-proves an account no more often than this unless asked. */
export const REPROVE_AFTER_MS = 5 * 60e3;


export type RefreshOutcome =
  | { ok: true; scope?: string }
  | { ok: false; error: string }
  | { thrown: true };

export interface ReadOutcome { ok: boolean; status: number; emailAddress?: string }

export interface DeriveInput {
  email: string;
  /** What the refresh attempt did. Null when there was no stored sign-in to try. */
  refresh: RefreshOutcome | null;
  /** The getProfile read. Null when it was not made (the refresh failed first). */
  read: ReadOutcome | null;
  lastSyncAt: string | null;
  now: Date;
  /** What the last proof said, so a failure keeps the time of the last success. */
  previousRefreshAt?: string | null;
}

const iso = (d: Date) => d.toISOString();

function sendReadyOf(connected: boolean, scope: string | undefined): AccountStatus["sendReady"] {
  if (!connected) return { ready: false, reason: "Account needs attention" };
  if (scope === undefined) return { ready: false, reason: "Send permission not confirmed" };
  return /gmail\.send|gmail\.modify|mail\.google\.com/.test(scope)
    ? { ready: true, reason: "Send permission confirmed" }
    : { ready: false, reason: "Send permission missing" };
}

export function deliveryOf(lastSyncAt: string | null, now: Date): AccountStatus["delivery"] {
  if (!lastSyncAt) return { kind: "poll", liveness: "never" };
  const age = now.getTime() - new Date(lastSyncAt).getTime();
  return { kind: "poll", liveness: Number.isFinite(age) && age <= SYNC_STALE_MS ? "fresh" : "stale" };
}

/** What a refresh and a read, taken together, prove about one account. */
export function deriveStatus(i: DeriveInput): AccountStatus {
  const at = iso(i.now);
  const base = {
    email: i.email,
    lastSuccessfulSyncAt: i.lastSyncAt,
    syncCoverage: i.lastSyncAt ? { days: COVERAGE_DAYS, through: i.lastSyncAt } : null,
    delivery: deliveryOf(i.lastSyncAt, i.now),
    checkedAt: at,
  };
  const fail = (o: { auth: AuthState; state: UiState; transient: Transient | null; code: string; receipt: Receipt | null }): AccountStatus => ({
    ...base,
    auth_state: o.auth,
    state: o.state,
    transient: o.transient,
    lastSuccessfulRefreshAt: i.previousRefreshAt ?? null,
    lastError: o.code,
    lastErrorAt: at,
    sendReady: sendReadyOf(false, undefined),
    receipt: o.receipt,
  });

  // No stored sign-in at all: there is nothing to prove, and Dave's tap is the only fix.
  if (i.refresh === null) return fail({ auth: "revoked", state: "pending_auth", transient: null, code: "no_stored_signin", receipt: null });

  // The request to Google never completed. Nothing is known about the grant.
  if ("thrown" in i.refresh) return fail({ auth: "unknown", state: "warning", transient: "service_unavailable", code: "network_error", receipt: { operation: "token_refresh", at, ok: false, identityMatched: null } });

  if (!i.refresh.ok) {
    const receipt: Receipt = { operation: "token_refresh", at, ok: false, identityMatched: null };
    if (AUTH_ERRORS.test(i.refresh.error)) {
      return fail({ auth: "revoked", state: "pending_auth", transient: null, code: i.refresh.error.match(AUTH_ERRORS)![0].toLowerCase(), receipt });
    }
    // A refusal that is not the provider saying the grant is gone (an HTML 5xx page, a throttle) cannot prove the grant is bad.
    return fail({ auth: "unknown", state: "warning", transient: "service_unavailable", code: "refresh_unavailable", receipt });
  }

  // The refresh worked: the credential is valid. Now the read decides whether the mailbox is.
  const refreshedAt = at;
  const receiptOf = (ok: boolean, matched: boolean | null): Receipt => ({ operation: `token_refresh+${VERIFIED_READ_OP}`, at, ok, identityMatched: matched });
  const credentialValid = (state: UiState, transient: Transient | null, code: string, matched: boolean | null): AccountStatus => ({
    ...base,
    auth_state: "valid",
    state,
    transient,
    lastSuccessfulRefreshAt: refreshedAt,
    lastError: code,
    lastErrorAt: at,
    sendReady: sendReadyOf(false, undefined),
    receipt: receiptOf(false, matched),
  });

  const r = i.read;
  if (!r) return credentialValid("warning", "service_unavailable", "read_not_attempted", null);
  if (r.status === 401) return { ...credentialValid("pending_auth", null, "http_401", null), auth_state: "revoked" };
  if (r.status === 429) return credentialValid("warning", "temporarily_limited", "http_429", null);
  if (r.status === 0 || r.status >= 500) return credentialValid("warning", "service_unavailable", r.status === 0 ? "network_error" : `http_${r.status}`, null);
  if (!r.ok) return credentialValid("error", null, `http_${r.status}`, null);

  const matched = !!r.emailAddress && r.emailAddress.trim().toLowerCase() === i.email.trim().toLowerCase();
  if (!matched) return credentialValid("error", null, "identity_mismatch", false);

  const scope = i.refresh.scope;
  return {
    ...base,
    auth_state: "valid",
    state: "connected",
    transient: null,
    lastSuccessfulRefreshAt: refreshedAt,
    lastError: null,
    lastErrorAt: null,
    sendReady: sendReadyOf(true, scope),
    receipt: receiptOf(true, true),
  };
}

// ---- The client's own clock ------------------------------------------------

export interface ClientView {
  /** What the surface may show. Never "connected" on a stale or offline answer. */
  state: UiState | "offline" | "stale";
  headline: string;
  detail: string | null;
  /** Reconnect is offered only for a confirmed auth loss. */
  offerReconnect: boolean;
}

// The app's own form (email/copy.ts: "Offline · Showing Saved Mail"): a middle dot, never two sentences (the short-copy law).
export const OFFLINE_LINE = "Offline · Showing the Last Known Status";

function clock(iso_: string | null): string {
  if (!iso_) return "";
  const d = new Date(iso_);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** The same answer, judged again by this device's clock. A frozen "healthy"
 *  response cannot mask staleness: the answer is only as good as how long ago
 *  the server proved it, and an offline phone says so instead of inventing a
 *  fresh status. */
export function viewOf(a: AccountStatus, now: Date, online: boolean): ClientView {
  if (!online) return { state: "offline", headline: "Offline", detail: OFFLINE_LINE, offerReconnect: false };
  const age = now.getTime() - new Date(a.checkedAt).getTime();
  if (!Number.isFinite(age) || age > STATUS_STALE_MS) {
    return { state: "stale", headline: "Status Unconfirmed", detail: `Last checked ${clock(a.checkedAt) || "a while ago"}`, offerReconnect: false };
  }
  if (a.state === "pending_auth") return { state: "pending_auth", headline: "Needs Reconnecting", detail: a.lastErrorAt ? `Stopped working ${clock(a.lastErrorAt)}` : null, offerReconnect: true };
  if (a.state === "error") return { state: "error", headline: "Can't Read Mail", detail: a.lastError === "identity_mismatch" ? "Signed in as a different account" : "Gmail refused the last check", offerReconnect: false };
  if (a.state === "warning") {
    return { state: "warning", headline: a.transient === "temporarily_limited" ? "Temporarily Limited" : "Service Unavailable", detail: "JARVIS keeps retrying", offerReconnect: false };
  }
  if (a.delivery.liveness !== "fresh") {
    return { state: "warning", headline: "Mail Not Updating", detail: a.lastSuccessfulSyncAt ? `Last updated ${clock(a.lastSuccessfulSyncAt)}` : "Nothing synced yet", offerReconnect: false };
  }
  return { state: "connected", headline: "Connected", detail: null, offerReconnect: false };
}
