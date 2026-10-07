// A CONNECTION INCIDENT: THE ONE FACT THE LOUD ANNOUNCEMENT KEYS ON (Foundation
// Fix Spec 3, 2026-10-07).
//
// Spec 1 made every surface agree on a status. Spec 2 made a dead grant a kept,
// recorded fact. This is the line between "a status" and "something Dave must be
// told about, once": an INCIDENT is a confirmed loss of an account, with a stable
// ID, an open time and a cause. The server and the app import this file, so there
// is one meaning of "confirmed" and one way to compute the ID.
//
// Two kinds, because they are told differently (failure-modes section 16a):
//   auth      the provider said the grant is gone (invalid_grant and kin, or a 401
//             that survived a fresh token). Confirmed the moment it is seen.
//             Reconnect is the right offer.
//   degraded  refreshes keep failing for reasons that never confirm as auth loss
//             (an outage, a throttle, a flaky network). Promoted to the full loud
//             treatment only after ESCALATE_AFTER_FAILURES failures in a row or
//             ESCALATE_AFTER_MS without a successful sync. Reconnect is NOT
//             offered, because nothing says reconnecting would help.
//
// The ID is derived, never stored on its own: a hash of the address, the kind and
// the ANCHOR instant (when this incident began). Every path that sees the same
// incident computes the same anchor, so the same incident is the same ID whoever
// finds it first (the sync route, the keep-alive worker, a status check), and a
// resolved incident can never be "reopened": a new loss has a new anchor.

import type { AccountStatus } from "./connectionStatus";

export const INCIDENT_KINDS = ["auth", "degraded"] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export interface Incident {
  id: string;
  kind: IncidentKind;
  /** The anchor: when the loss began. ISO. */
  openedAt: string;
  /** Likely cause as a stable code (testing_mode_7_day, revoked_or_password_change...), or null when nothing says. */
  cause: string | null;
}

/** What the stored grant knows about itself (migration 0057), or null where that migration is not applied. */
export interface GrantMeta {
  deadAt: string | null;
  /** last_auth_error.oauthRefreshFailedAt: the instant the first confirmed failure was recorded. */
  oauthFailedAt: string | null;
  consecutiveFailures: number;
  lastRefreshOkAt: string | null;
  cause: string | null;
}

/** Work that was waiting on the mailbox and cannot proceed. Counts only, never a subject or a recipient. */
export interface PausedWork {
  replies: number;
  other: number;
  /** Why the work is held, recorded where it is counted (Spec 4): it waits at its last committed checkpoint for re-consent, and resumes from there. */
  reason?: string;
}

/** The reason a lost grant holds queued work. Nothing retries in a loop and nothing is discarded: the work waits. */
export const PAUSED_REASON = "Paused · Re-Consent Required";

/** Refresh failures in a row that promote a transient trouble to the full loud treatment. */
export const ESCALATE_AFTER_FAILURES = 10;
/** Without a successful sync for this long, a transient trouble is promoted too. */
export const ESCALATE_AFTER_MS = 24 * 3600e3;

/** A short, stable, non-secret ID a person can read out: JC- and eight hex digits. */
export function incidentId(email: string, kind: IncidentKind, anchorIso: string): string {
  const text = `${email.trim().toLowerCase()}|${kind}|${anchorIso}`;
  // Two independent 32-bit FNV-1a passes. An ID, not a secret: it only has to be stable and unlikely to collide across a handful of accounts.
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x811c9dc5) >>> 0;
  }
  return "JC-" + a.toString(16).padStart(8, "0").toUpperCase().slice(0, 4) + b.toString(16).padStart(8, "0").toUpperCase().slice(0, 4);
}

const ms = (v: string | null | undefined): number | null => {
  if (!v) return null;
  const n = new Date(v).getTime();
  return Number.isFinite(n) ? n : null;
};

/** Why a transient trouble has become an incident, or null when it has not. */
export function escalationOf(i: { consecutiveFailures: number; lastSuccessfulSyncAt: string | null; now: Date }): "failures" | "silence" | null {
  if (i.consecutiveFailures >= ESCALATE_AFTER_FAILURES) return "failures";
  const t = ms(i.lastSuccessfulSyncAt);
  return t !== null && i.now.getTime() - t >= ESCALATE_AFTER_MS ? "silence" : null;
}

/** The incident this account is in, if it is in one. Pure.
 *
 *  `previous` is the incident the last recorded proof carried. It keeps the ID steady across proofs while nothing better is known
 *  (a 401 from Gmail on a token that still refreshes leaves no grant record to anchor on), and it is dropped the moment the account
 *  proves healthy, so a later loss opens a NEW incident. */
export function incidentOf(i: { email: string; status: AccountStatus; previous: Incident | null; grant: GrantMeta | null; now: Date }): Incident | null {
  const { status: s, grant: g } = i;
  const nowIso = i.now.toISOString();

  // Confirmed loss of the grant: the provider said so, or there is no stored sign-in left at all.
  if (s.auth_state === "revoked" && s.state === "pending_auth") {
    const prior = i.previous?.kind === "auth" ? i.previous : null;
    const openedAt = g?.oauthFailedAt ?? g?.deadAt ?? prior?.openedAt ?? nowIso;
    return { id: incidentId(i.email, "auth", openedAt), kind: "auth", openedAt, cause: g?.cause ?? prior?.cause ?? (s.lastError === "no_stored_signin" ? "no_stored_signin" : null) };
  }

  // Trouble that never confirmed as a lost grant: loud only once it has lasted.
  if (s.state === "warning" && s.transient !== null) {
    const why = escalationOf({ consecutiveFailures: g?.consecutiveFailures ?? 0, lastSuccessfulSyncAt: s.lastSuccessfulSyncAt, now: i.now });
    if (!why) return null;
    const prior = i.previous?.kind === "degraded" ? i.previous : null;
    // Anchor on the last good moment where there is one (it does not move while the trouble lasts); otherwise on when it was first seen.
    const openedAt = s.lastSuccessfulSyncAt ?? g?.lastRefreshOkAt ?? prior?.openedAt ?? nowIso;
    return { id: incidentId(i.email, "degraded", openedAt), kind: "degraded", openedAt, cause: why };
  }

  return null;
}

export const INCIDENT_PATTERN = /^JC-[0-9A-F]{8}$/;
