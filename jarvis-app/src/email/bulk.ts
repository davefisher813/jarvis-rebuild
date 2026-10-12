// SELECT MODE'S COMMANDS (Email v1 spec section 11, V04). The selection is a
// frozen list of exact messages, each with its account and provider id taken
// at the tap that selected it: a row that arrives later is never in it, and a
// row that leaves the list is still answered for. A command is sent in batches
// of at most 100 ids (api/email/message.ts, a body with `items`), and every
// item comes back with its own outcome. Nothing here is optimistic: a row
// changes on the screen when Gmail's read back says it changed.

import { BATCH_MAX, batchMessages, type BatchItem, type BatchOp, type Fetch, type InboxRow, type ItemResult } from "./emailClient";

/** One selected message, frozen at the tap that selected it. */
export interface Picked extends BatchItem { rowId: string }

export const pickOf = (r: Pick<InboxRow, "id" | "account" | "provider_id">): Picked => ({ rowId: r.id, email: r.account, id: r.provider_id });

/** The tray's four verbs and the op each sends. Delete is Gmail's Trash. */
export type TrayVerb = "read" | "unread" | "archive" | "delete";
export const OP_OF: Record<TrayVerb, BatchOp> = { read: "read", unread: "unread", archive: "archive", delete: "trash" };

/** The command that puts back what an op changed. */
export const REVERSE: Record<BatchOp, BatchOp> = { read: "unread", unread: "read", archive: "unarchive", unarchive: "archive", trash: "untrash", untrash: "trash" };

export interface BatchOutcome { picked: Picked; result: ItemResult }

/**
 * Run one op over the picked messages, 100 ids a request. A request that fails as a whole answers for each of its
 * items: not sent (no session, offline) is failed; a transport failure after sending may have landed, so unknown.
 */
export async function runBatch(token: string | null | undefined, op: BatchOp, picked: readonly Picked[], doFetch?: Fetch): Promise<BatchOutcome[]> {
  const out: BatchOutcome[] = [];
  for (let i = 0; i < picked.length; i += BATCH_MAX) {
    const chunk = picked.slice(i, i + BATCH_MAX);
    const r = await batchMessages(token, op, chunk.map(({ email, id }) => ({ email, id })), doFetch);
    if (!r.ok) {
      const status = r.code === "UNAVAILABLE" ? "unknown" : "failed";
      for (const p of chunk) out.push({ picked: p, result: { email: p.email, id: p.id, status, code: r.code, retryable: r.code !== "AUTH_REQUIRED" && r.code !== "PROVIDER_AUTH" } });
      continue;
    }
    const by = new Map(r.value.results.map((x) => [`${x.email.toLowerCase()}|${x.id}`, x]));
    for (const p of chunk) {
      const x = by.get(`${p.email.toLowerCase()}|${p.id}`);
      out.push({ picked: p, result: x ?? { email: p.email, id: p.id, status: "unknown" } });
    }
  }
  return out;
}

export interface Tally { done: BatchOutcome[]; attention: BatchOutcome[]; retryable: Picked[] }

/** Done is accepted; everything else needs attention; only a proven failure that can be retried is offered again. */
export function tally(outcomes: readonly BatchOutcome[]): Tally {
  const done = outcomes.filter((o) => o.result.status === "accepted");
  const attention = outcomes.filter((o) => o.result.status !== "accepted");
  const retryable = attention.filter((o) => o.result.status === "failed" && o.result.retryable === true).map((o) => o.picked);
  return { done, attention, retryable };
}

const DONE_WORD: Record<BatchOp, string> = { read: "Marked Read", unread: "Marked Unread", archive: "Archived", unarchive: "Put Back", trash: "Moved to Trash", untrash: "Restored" };

/** "28 Archived". */
export function doneLine(op: BatchOp, n: number): string {
  return `${n} ${DONE_WORD[op]}`;
}

/** "2 Need Attention", "1 Needs Attention". */
export function attentionLine(n: number): string {
  return `${n} ${n === 1 ? "Needs" : "Need"} Attention`;
}

/** The verb on the tray's own button. */
export const TRAY_LABEL: Record<TrayVerb, string> = { read: "Read", unread: "Unread", archive: "Archive", delete: "Delete" };

/** Why one item needs attention, in the tab's words. */
export function reasonOf(r: Pick<ItemResult, "status" | "code">): string {
  if (r.status === "unknown") return "Not Confirmed by Gmail";
  if (r.status === "conflict") return "Changed Elsewhere";
  switch (r.code) {
    case "NOT_FOUND": return "Not in Saved Mail";
    case "PROVIDER_AUTH": return "Gmail Needs Reconnecting";
    case "AUTH_REQUIRED": return "Sign In Needed";
    case "RATE_LIMITED": return "Gmail Needs a Moment";
    case "OFFLINE": return "Offline";
    default: return "Gmail Didn't Change It";
  }
}

/** The attention list folded by reason, in first-seen order: [reason, count]. */
export function reasonsOf(outcomes: readonly BatchOutcome[]): Array<[string, number]> {
  const by = new Map<string, number>();
  for (const o of outcomes) { const k = reasonOf(o.result); by.set(k, (by.get(k) ?? 0) + 1); }
  return [...by.entries()];
}
