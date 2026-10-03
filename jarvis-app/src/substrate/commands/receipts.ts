// READING RECEIPTS (IMPLEMENTATION-SPEC.md 07.4; screens H7 Activity and
// M7 in slice 04). The feed and the detail come from two database functions
// that run as the person, so the row policies decide what is read. The
// global feed never carries a provisional Email row, only their count; the
// detail says whether it belongs inside Email. This module shapes the lines
// a receipt row shows: the actor, the assurance, the status pill, the
// export text. Nothing here decides anything.

import { callCommand, type CommandResult, type RpcClient } from "./errors";

export type ActorKind = "user" | "rule" | "agent";
export type Assurance = "verified_jarvis" | "provider_ack" | "reported_external";

export interface FeedRow {
  receipt_id: string;
  action_id: string;
  sequence: number;
  state: string;
  exact_verb: string;
  occurred_at: string;
  actor_kind: ActorKind;
  actor_display: string;
  assurance: Assurance;
  error_code: string | null;
  erased: boolean;
  reversal_action_id: string | null;
  kind: string;
  surface: "project" | "email" | "system";
  destination_id: string | null;
  undoable: boolean;
}

export interface Feed {
  rows: FeedRow[];
  /** The one thing about provisional Email that may leave Email: how many cards wait. */
  email_review_count: number;
  scope: "global" | "email";
}

export interface FeedOptions { limit?: number; before?: string }

export function activityFeed(client: RpcClient, scope: Feed["scope"] = "global", opts: FeedOptions = {}): Promise<CommandResult<Feed>> {
  return callCommand<Feed>(client, "activity_feed", { p_limit: opts.limit ?? 50, p_before: opts.before ?? null, p_scope: scope });
}

export interface ReceiptEvent {
  receipt_id: string;
  sequence: number;
  state: string;
  exact_verb: string;
  occurred_at: string;
  actor_kind: ActorKind;
  actor_id: string | null;
  actor_display: string;
  scope_summary: string;
  before_ref: string | null;
  after_ref: string | null;
  diff: Array<{ field: string; before: unknown; after: unknown }>;
  evidence_refs: string[];
  provider_ack: Record<string, unknown> | null;
  error_code: string | null;
  reversal_action_id: string | null;
  assurance: Assurance;
  erased_at: string | null;
}

export interface EvidenceRow {
  id: string;
  type: "email" | "manual" | "import";
  message_id: string | null;
  provider_message_id: string | null;
  thread_id: string | null;
  excerpt: string;
  captured_at: string;
  availability: "available" | "deleted" | "disconnected";
}

export interface ReceiptDetail {
  action_id: string;
  kind: string;
  surface: "project" | "email" | "system";
  state: string;
  verb: string;
  actor_kind: ActorKind;
  actor_id: string | null;
  actor_display: string;
  approved_by_user: boolean;
  destination_id: string | null;
  provider_account_id: string | null;
  created_at: string;
  updated_at: string;
  error_code: string | null;
  /** True for a suggestion, an inert draft or an unlanded capture: the detail renders inside Email, not in Activity. */
  inside_email: boolean;
  undoable: boolean;
  item_updated_at: string | null;
  outbox: { state: string; attempt: number; error_code: string | null; dispatched_at: string | null; provider_ack: Record<string, unknown> | null } | null;
  receipts: ReceiptEvent[];
  evidence: EvidenceRow[];
}

export function receiptDetail(client: RpcClient, actionId: string): Promise<CommandResult<ReceiptDetail>> {
  return callCommand<ReceiptDetail>(client, "receipt_detail", { p_action: actionId });
}

export const ERASE_NOTE = "Deleting This Receipt Does Not Undo the Action";

/** Erase: the payload goes, a tombstone stays, the action is not undone. */
export function eraseReceipt(client: RpcClient, actionId: string): Promise<CommandResult<{ action_id: string; erased_receipts: number }>> {
  return callCommand(client, "receipt_erase", { p_action: actionId });
}

/** "Suggested by Claude · Approved by You" (07.4). */
export function actorLine(d: Pick<ReceiptDetail, "actor_kind" | "actor_display" | "approved_by_user"> & { assurance?: Assurance }): string {
  if (d.assurance === "reported_external") return `Reported by ${d.actor_display} · Not Verified by JARVIS`;
  if (d.actor_kind === "agent") return d.approved_by_user ? `Suggested by ${d.actor_display} · Approved by You` : `Suggested by ${d.actor_display}`;
  if (d.actor_kind === "rule") return d.approved_by_user ? "Suggested by a Rule · Approved by You" : "By a Rule";
  return "You";
}

export function assuranceLine(a: Assurance): string {
  switch (a) {
    case "verified_jarvis": return "Verified by JARVIS";
    case "provider_ack": return "Accepted by Gmail";
    case "reported_external": return "Reported by Assistant · Not Verified";
  }
}

/** The status pill (07.1 states, the person's words). */
export function statusLine(state: string): string {
  switch (state) {
    case "proposed": return "Suggested";
    case "approved": return "Approved";
    case "running": return "Working";
    case "confirmed": return "Done";
    case "failed": return "Not Done";
    case "cancelled": return "Cancelled";
    case "outcome_unknown": return "Unknown";
    case "cancellation_requested": return "Cancel Requested";
    default: return state;
  }
}

/** The one line a global surface may show about provisional Email. */
export function reviewCountLine(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  return n === 1 ? "1 To Review in Email" : `${n} To Review in Email`;
}

/**
 * Copy / export receipt: the facts, as text. No hashes, no keys, no payload
 * beyond the diff the receipt already shows; a provider ack keeps only its
 * ids. The caller decides where it goes (clipboard, share sheet).
 */
export function exportReceipt(d: ReceiptDetail): string {
  const ack = d.outbox?.provider_ack ?? d.receipts.find((r) => r.provider_ack)?.provider_ack ?? null;
  const out = {
    action_id: d.action_id,
    kind: d.kind,
    state: statusLine(d.state),
    exact_effect: d.verb,
    actor: actorLine({ ...d, assurance: d.receipts[d.receipts.length - 1]?.assurance }),
    created_at: d.created_at,
    receipts: d.receipts.map((r) => ({
      at: r.occurred_at, state: statusLine(r.state), effect: r.exact_verb, assurance: assuranceLine(r.assurance),
      scope: r.scope_summary || undefined, diff: r.erased_at ? undefined : r.diff, error: r.error_code ?? undefined,
    })),
    evidence: d.evidence.map((e) => ({ type: e.type, excerpt: e.excerpt, captured_at: e.captured_at, availability: e.availability })),
    provider_ack: ack ? { id: ack.id ?? ack.provider_message_id ?? null, thread_id: ack.threadId ?? ack.thread_id ?? null } : null,
  };
  return JSON.stringify(out, null, 2);
}
