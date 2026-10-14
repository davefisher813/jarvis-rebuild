// THE ONE HEADLINE (Email v1 spec 2026-10-08, sections 2.5 and 8.1; 2026-10-12).
//
// The mail home shows ONE account status line, the most relevant one, and the per-account sheet (AccountStatusSheet)
// shows every dimension. Spec 8.1 fixes the order the headline chooses in:
//
//   1. user        the person paused or removed a mailbox (their own choice explains the silence)
//   2. auth        an authorization issue: needs reconnecting, or Gmail refused the read
//   3. send        a send whose outcome is unknown ("A Send Needs Checking"), opening that draft's Check Again screen
//   4. sync        catching up, stale, failed, or the service is limited or unreachable
//   5. healthy     nothing to say here: the header's "Last Checked 9:12 AM" is the whole of it
//
// Pure, so the order is held by tests with no screen.

import type { ClientView } from "../connections/connectionStatus";
import type { DraftRow } from "./drafts";
import { outcomeOf } from "./drafts";
import type { EmailAccount } from "./emailClient";
import type { EmailFact } from "./format";
import { STATE_WORD } from "./copy";

export type HeadlineTier = "user" | "auth" | "send" | "sync" | "healthy";
export const TIER_ORDER: readonly HeadlineTier[] = ["user", "auth", "send", "sync", "healthy"];

export const SYNC_PAUSED = "Sync Paused";
export const MAILBOX_REMOVED = "Mailbox Removed";
export const SEND_NEEDS_CHECKING = "A Send Needs Checking";
export const CHECK_SEND = "Check Send";
export const SYNC_FAILED = "Sync Failed";
export const MAIL_NOT_UPDATING = "Mail Not Updating";
export const RETRY_SYNC = "Retry Sync";
export const VIEW_ACCOUNTS = "View Accounts";
export const OPEN_CONNECTIONS = "Open Connections";

/** "2 Sends Need Checking": Title Case after a leading number. */
export const sendsNeedChecking = (n: number): string => (n === 1 ? SEND_NEEDS_CHECKING : `${n} Sends Need Checking`);

export type HeadlineAction =
  | { kind: "accounts" }
  | { kind: "connections" }
  | { kind: "reconnect"; email: string }
  | { kind: "check_send"; draft: DraftRow }
  | { kind: "retry_sync" };

export interface Headline {
  tier: HeadlineTier;
  /** The mailbox it is about, when it is about one. */
  email: string | null;
  /** The line, as facts (the first wears its tone; at most one grey). Empty for healthy, and for a catch-up the header already says. */
  facts: EmailFact[];
  action: HeadlineAction | null;
}

export interface HeadlineInput {
  accounts: readonly EmailAccount[];
  /** The proven status per lowercase address (Foundation Fix Spec 1). */
  views: ReadonlyMap<string, ClientView>;
  /** Sent rows from draft_list: those whose outcome is unknown are the send tier. */
  sent: readonly DraftRow[];
  /** The account picker's choice, or null for All Accounts. */
  scope: string | null;
}

const lc = (s: string) => s.trim().toLowerCase();

/** Sends whose outcome is unknown, newest first. */
export function unknownSends(sent: readonly DraftRow[]): DraftRow[] {
  return sent.filter((d) => outcomeOf(d) === "unknown");
}

export function statusHeadline(i: HeadlineInput): Headline {
  const inScope = (address: string) => i.scope === null || lc(i.scope) === lc(address);
  const accounts = i.accounts.filter((a) => inScope(a.address));
  const live = accounts.filter((a) => a.state !== "disconnected");
  const viewOf = (a: EmailAccount) => i.views.get(lc(a.address));

  // 1. The person's own choice. A paused mailbox always; a removed one only when it is what the screen is about (picked,
  //    or the only kind there is), so an account removed months ago does not hold the headline over a live problem.
  const paused = live.find((a) => a.sync_state === "paused");
  if (paused) return { tier: "user", email: paused.address, facts: [{ text: SYNC_PAUSED, tone: "warn" }, { text: paused.address }], action: { kind: "accounts" } };
  const removed = accounts.find((a) => a.state === "disconnected");
  if (removed && (i.scope !== null || live.length === 0)) {
    return { tier: "user", email: removed.address, facts: [{ text: MAILBOX_REMOVED, tone: "warn" }, { text: removed.address }], action: { kind: "connections" } };
  }

  // 2. Authorization: the proof first; the cache row's own state only until the first proof arrives.
  for (const a of live) {
    const v = viewOf(a);
    if (v ? v.offerReconnect : a.state === "reauth") {
      return { tier: "auth", email: a.address, facts: [{ text: v?.headline ?? STATE_WORD.reauth, tone: "warn" }, { text: a.address }], action: { kind: "reconnect", email: a.address } };
    }
  }
  for (const a of live) {
    const v = viewOf(a);
    if (v && v.state === "error") return { tier: "auth", email: a.address, facts: [{ text: v.headline, tone: "warn" }, { text: v.detail ?? a.address }], action: null };
  }

  // 3. A send whose outcome is unknown: its own persistent state (spec 10), never folded into a connection warning.
  const ids = new Set(accounts.map((a) => a.id));
  const unknown = unknownSends(i.sent).filter((d) => i.scope === null || ids.has(d.account_id));
  if (unknown.length > 0) return { tier: "send", email: null, facts: [{ text: sendsNeedChecking(unknown.length), tone: "warn" }], action: { kind: "check_send", draft: unknown[0]! } };

  // 4. Sync. A catch-up in progress is already the header's words, so it holds the tier and draws nothing more.
  for (const a of live) {
    const v = viewOf(a);
    // "Status Unconfirmed" (a stale answer) is the absence of proof, not a problem, so it never holds the headline (Dave 2026-10-13).
    if (v && v.state === "warning") {
      return { tier: "sync", email: a.address, facts: [{ text: v.headline, tone: "warn" }, ...(v.detail ? [{ text: v.detail }] : [])], action: null };
    }
  }
  for (const a of live) {
    if (a.sync_state === "failed") return { tier: "sync", email: a.address, facts: [{ text: SYNC_FAILED, tone: "warn" }, { text: a.address }], action: { kind: "retry_sync" } };
    if (a.sync_state === "stale") return { tier: "sync", email: a.address, facts: [{ text: MAIL_NOT_UPDATING, tone: "warn" }, { text: a.address }], action: { kind: "retry_sync" } };
  }
  const catching = live.find((a) => a.sync_state === "catching_up" || a.sync_state === "syncing");
  if (catching) return { tier: "sync", email: catching.address, facts: [], action: null };

  return { tier: "healthy", email: null, facts: [], action: null };
}
