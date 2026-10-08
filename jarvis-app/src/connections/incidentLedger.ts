// WHAT THIS DEVICE HAS ALREADY BEEN TOLD (Foundation Fix Spec 3, 2026-10-07).
//
// The server says which incidents are open. This is the device's own memory of
// which of them it has announced, which Dave has acknowledged, and which have
// been resolved. It is what makes the rules hold:
//   * ONE notification per confirmed incident: an incident ID already in `open`
//     is never posted again, however many times the status is re-read.
//   * Grouped: several accounts that fail in the same read are ONE notice.
//   * Replaced, then withdrawn on recovery: the notice follows the open set.
//   * NEVER REOPENED: a resolved incident ID is remembered, and a status that
//     still carries it (a stale answer, a slow server) is ignored, so a fixed
//     problem cannot announce itself again. A genuinely new loss has a new ID.
//   * Access restored and mail caught up are SEPARATE states: restored the
//     moment the account proves healthy, caught up only after a sync that
//     finished after that.
//
// Pure functions over a plain object, plus a tiny localStorage wrapper, so the
// rules are held by tests with no phone. Only IDs, an address (already on this
// device in the account list) and timestamps are kept. Never a token or mail.

import { STATUS_STALE_MS, type AccountStatus } from "./connectionStatus";
import type { IncidentKind } from "./incident";

export const LEDGER_KEY = "jarvis.connections.incidents.v1";
/** Resolved incidents are remembered this long (so a stale answer cannot reopen one), then forgotten. */
export const RESOLVED_KEEP_MS = 30 * 24 * 3600e3;

export interface OpenEntry { id: string; kind: IncidentKind; announcedAt: string }
export interface ResolvedEntry {
  resolvedAt: string;
  /** When the account proved healthy again. Mail is "caught up" only after a sync later than this. */
  restoredAt: string;
  caughtUpAt: string | null;
  /** The address, so the recovery note can name it. */
  email: string;
  /** Dave saw the recovery note and it has been put away. */
  seen: boolean;
}

export interface Ledger {
  v: 1;
  userId: string;
  open: Record<string, OpenEntry>;
  resolved: Record<string, ResolvedEntry>;
  /** Incident ID -> when Dave acknowledged it. An acknowledged incident compacts to a strip; it never disappears while it is open. */
  acked: Record<string, string>;
}

export const emptyLedger = (userId: string): Ledger => ({ v: 1, userId, open: {}, resolved: {}, acked: {} });

export interface Plan {
  ledger: Ledger;
  /** Post (or replace) the one notification with these incidents, or null when nothing new needs saying. */
  post: { incidentIds: string[]; kind: IncidentKind } | null;
  /** The open set is now empty after having been non-empty: take the notification down. */
  withdraw: boolean;
}

const lc = (s: string) => s.trim().toLowerCase();

/** One status read, against what the device already knows. Pure. */
export function planAnnouncements(before: Ledger, accounts: AccountStatus[], now: Date): Plan {
  const nowIso = now.toISOString();
  const open: Record<string, OpenEntry> = { ...before.open };
  const resolved: Record<string, ResolvedEntry> = { ...before.resolved };
  const acked: Record<string, string> = { ...before.acked };
  const newIds: string[] = [];
  let changedOpen = false;
  const hadOpen = Object.keys(before.open).length > 0;

  const byEmail = new Map(accounts.map((a) => [lc(a.email), a]));

  for (const a of accounts) {
    const inc = a.incident;
    if (!inc) continue;
    if (resolved[inc.id]) continue; // never reopened
    const key = lc(a.email);
    const cur = open[key];
    if (!cur) {
      open[key] = { id: inc.id, kind: inc.kind, announcedAt: nowIso };
      newIds.push(inc.id);
      changedOpen = true;
    } else if (cur.id !== inc.id) {
      // The same account, still in trouble, under a better-anchored or stronger ID: same announcement, newer name. Not a second one.
      const was = acked[cur.id];
      if (was && !acked[inc.id]) acked[inc.id] = was;
      open[key] = { id: inc.id, kind: inc.kind, announcedAt: cur.announcedAt };
      changedOpen = true;
    }
  }

  // Recovery: an open incident is resolved when its account is plainly connected again, or is gone altogether.
  for (const [key, entry] of Object.entries(open)) {
    const a = byEmail.get(key);
    if (a && (a.incident || a.state !== "connected")) continue;
    // A healthy answer that is itself stale proves nothing: only a fresh one may close an incident.
    if (a && now.getTime() - new Date(a.checkedAt).getTime() > STATUS_STALE_MS) continue;
    delete open[key];
    delete acked[entry.id];
    resolved[entry.id] = { resolvedAt: nowIso, restoredAt: a?.lastSuccessfulRefreshAt ?? nowIso, caughtUpAt: null, email: key, seen: false };
    changedOpen = true;
  }

  // Caught up: a sync that finished after access came back.
  for (const r of Object.values(resolved)) {
    if (r.caughtUpAt) continue;
    const a = byEmail.get(lc(r.email));
    const synced = a?.lastSuccessfulSyncAt ? new Date(a.lastSuccessfulSyncAt).getTime() : NaN;
    if (a && Number.isFinite(synced) && synced > new Date(r.restoredAt).getTime()) r.caughtUpAt = nowIso;
  }

  // Forgetting: old resolved incidents go, so the ledger does not grow without end.
  for (const [id, r] of Object.entries(resolved)) {
    if (now.getTime() - new Date(r.resolvedAt).getTime() > RESOLVED_KEEP_MS) delete resolved[id];
  }

  const openList = Object.values(open);
  const post = newIds.length > 0 ? { incidentIds: openList.map((o) => o.id).sort(), kind: (openList.some((o) => o.kind === "auth") ? "auth" : "degraded") as IncidentKind } : null;
  // Part of the set recovered while some remain: the notice is replaced so it names only what is still open.
  const shrank = !post && changedOpen && openList.length > 0 && Object.keys(before.open).length > openList.length;
  const replace = shrank ? { incidentIds: openList.map((o) => o.id).sort(), kind: (openList.some((o) => o.kind === "auth") ? "auth" : "degraded") as IncidentKind } : null;

  return {
    ledger: { v: 1, userId: before.userId, open, resolved, acked },
    post: post ?? replace,
    withdraw: hadOpen && openList.length === 0,
  };
}

export function acknowledge(l: Ledger, incidentId: string, now: Date): Ledger {
  return { ...l, acked: { ...l.acked, [incidentId]: now.toISOString() } };
}

export function markSeen(l: Ledger, incidentId: string): Ledger {
  const r = l.resolved[incidentId];
  return r ? { ...l, resolved: { ...l.resolved, [incidentId]: { ...r, seen: true } } } : l;
}

// ---- storage ---------------------------------------------------------------

export function readLedger(userId: string): Ledger {
  try {
    const raw = localStorage.getItem(LEDGER_KEY);
    if (!raw) return emptyLedger(userId);
    const l = JSON.parse(raw) as Ledger;
    return l && l.v === 1 && l.userId === userId && l.open && l.resolved && l.acked ? l : emptyLedger(userId);
  } catch {
    return emptyLedger(userId);
  }
}

type Listener = (l: Ledger) => void;
const listeners = new Set<Listener>();

export function writeLedger(l: Ledger): void {
  try { localStorage.setItem(LEDGER_KEY, JSON.stringify(l)); } catch { /* private mode: it lives in memory for this run */ }
  for (const fn of listeners) fn(l);
}

/** Surfaces re-read when the announcer or an acknowledgement changes the ledger. */
export function subscribeLedger(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
