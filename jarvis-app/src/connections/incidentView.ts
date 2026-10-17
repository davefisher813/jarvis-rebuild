// WHAT THE LOUD SURFACES SAY (Foundation Fix Spec 3, failure-modes section 16a).
// One place for the words, so the Email banner, the Today alert and the
// notification cannot drift apart. Pure.
//
// The copy follows the spec's: a title, the address, when mail last updated,
// how much work is waiting, and the three ways out. Where the app's own copy
// laws differ from the spec's letters (Title Case on a title, one sentence per
// line, a middle dot where the spec has a dash) the law wins and the words are
// the same. There is NO dismiss: acknowledging compacts the banner to a strip,
// and the failure stays visible for as long as it is true. And there is never
// an "All Caught Up" or a healthy zero on a surface that is in a failure state.

import type { AccountStatus } from "./connectionStatus";
import type { Ledger, ResolvedEntry } from "./incidentLedger";
import type { IncidentKind } from "./incident";
import { clock12 } from "../shared/clock";

export const BANNER_TITLE: Record<IncidentKind, string> = {
  auth: "Gmail Needs Reconnecting",
  degraded: "Gmail Isn't Updating",
};
export const RECONNECT_LABEL = "Reconnect Gmail";
export const PAUSED_LABEL = "View Paused Actions";
export const OPEN_GMAIL_LABEL = "Open Gmail";
export const RESTORED_TITLE = "Access Restored";
export const CAUGHT_UP_TITLE = "Mail Up to Date";
export const RESTORED_DETAIL = "Catching Up";
export const GMAIL_URL = "https://mail.google.com/mail/";

/** Gmail opens signed in as this address when it can. */
export const gmailUrlFor = (email: string): string => `${GMAIL_URL}?authuser=${encodeURIComponent(email)}`;

function when(iso: string | null): { date: string; time: string } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return {
    date: d.toLocaleDateString([], { month: "short", day: "numeric" }),
    time: clock12(d),
  };
}

/** The two lines under the address. Each is one sentence, so each passes the short-copy law on its own. */
export function updatedLines(lastSyncAt: string | null): [string, string] {
  const w = when(lastSyncAt);
  return [w ? `Mail last updated ${w.date} at ${w.time}.` : "Mail has not updated yet.", "New mail may be missing."];
}

export function pausedLine(p: { replies: number; other: number }): string {
  // Title Case after a leading number: the catalog law (laws/catalogSetup) refuses a lowercase word there.
  return `${p.replies} ${p.replies === 1 ? "Reply" : "Replies"} Unsent · ${p.other} Other ${p.other === 1 ? "Action" : "Actions"} Paused`;
}

export interface BannerModel {
  incidentId: string;
  email: string;
  kind: IncidentKind;
  title: string;
  address: string;
  /** Two lines: when mail last updated, and that new mail may be missing. */
  lines: [string, string];
  paused: string | null;
  /** Replies and other actions paused on this mailbox, as the status counted them (0 when none). */
  pausedCount: number;
  /** Reconnect only where the loss is confirmed to be the grant. A degraded incident never offers it. */
  reconnect: boolean;
  /** Acknowledged: compact to one line. The failure itself stays on screen. */
  strip: boolean;
}

/** One model per open incident, in the order the accounts came. */
export function bannerModels(accounts: AccountStatus[], ledger: Ledger): BannerModel[] {
  const out: BannerModel[] = [];
  for (const a of accounts) {
    const inc = a.incident;
    if (!inc || ledger.resolved[inc.id]) continue;
    out.push({
      incidentId: inc.id,
      email: a.email,
      kind: inc.kind,
      title: BANNER_TITLE[inc.kind],
      address: a.email,
      lines: updatedLines(a.lastSuccessfulSyncAt),
      paused: a.paused ? pausedLine(a.paused) : null,
      pausedCount: a.paused ? (Number(a.paused.replies) || 0) + (Number(a.paused.other) || 0) : 0,
      reconnect: inc.kind === "auth",
      strip: !!ledger.acked[inc.id],
    });
  }
  return out;
}

/** "Checked Just Now" only while it is true; after that the time itself. */
export function checkedLine(at: string, now: Date): string {
  const t = new Date(at).getTime();
  if (!Number.isFinite(t) || now.getTime() - t < 2 * 60e3) return "Checked Just Now";
  return `Checked ${clock12(t)}`;
}

export interface RecoveryNote { incidentId: string; email: string; state: "restored" | "caught_up"; title: string; detail: string }

/** The account's sync dimension (spec 8.1; migration 0065), by lowercase address. Undefined where it is not known. */
export type SyncStateOf = (email: string) => string | null | undefined;

/** After a loss is resolved: access restored first, mail caught up only once a sync has finished after that. Shown once, until seen.
 *  "Mail Up to Date" also needs the account's own sync state to be current (2026-10-12, spec 8.1: "Connected" does not mean
 *  "Current"): a mailbox the server says is still catching up stays "Access Restored · Catching Up", whatever the ledger saw.
 *  Where the sync state is not known (a database before 0065) the ledger's finished sync decides alone. */
export function recoveryNotes(accounts: AccountStatus[], ledger: Ledger, now: Date = new Date(), syncStateOf?: SyncStateOf): RecoveryNote[] {
  const out: RecoveryNote[] = [];
  const open = new Set(accounts.filter((a) => a.incident).map((a) => a.email.toLowerCase()));
  for (const [id, r] of Object.entries(ledger.resolved) as [string, ResolvedEntry][]) {
    if (r.seen || open.has(r.email)) continue;
    const sync = syncStateOf?.(r.email.toLowerCase());
    const current = sync === undefined || sync === null || sync === "current";
    out.push(r.caughtUpAt && current
      ? { incidentId: id, email: r.email, state: "caught_up", title: CAUGHT_UP_TITLE, detail: `${r.email} · ${checkedLine(r.caughtUpAt, now)}` }
      : { incidentId: id, email: r.email, state: "restored", title: RESTORED_TITLE, detail: `${r.email} · ${RESTORED_DETAIL}` });
  }
  return out;
}
