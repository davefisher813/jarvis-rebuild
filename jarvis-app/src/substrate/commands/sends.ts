// EXTERNAL COMMANDS, FROM THE CLIENT'S SIDE (IMPLEMENTATION-SPEC.md 07.3).
// A send is two taps apart from a save: "Review send" asks the server for an
// immutable snapshot of exactly what would leave (command_review, which also
// computes the hash the approval binds to), and "Send this message" consumes
// that review's nonce (command_approve), which queues the durable outbox
// command. Nothing here talks to Gmail; the worker in ../outbox does, from
// the server, and slice 07 builds the snapshot from a draft.

import { callCommand, newRequestId, type CommandResult, type RpcClient } from "./errors";
import type { ActionResult } from "./captures";

export type CommandKind = "send_email" | "modify_labels";

export interface ReviewResult {
  action_id: string;
  review_nonce: string;
  /** The server's hash over the snapshot, the account and the draft revision. Show it back on the tap. */
  payload_hash: string;
  expires_at: string;
  outbox_id: string;
}

/** The exact review. `verb` is the receipt's line if it leaves: "Sent reply to coach@example.test". */
export function reviewCommand(client: RpcClient, kind: CommandKind, payload: Record<string, unknown>, accountId: string, verb: string, expectedRevision?: number): Promise<CommandResult<ReviewResult>> {
  return callCommand<ReviewResult>(client, "command_review", { p_kind: kind, p_payload: payload, p_provider_account: accountId, p_verb: verb, p_expected_revision: expectedRevision ?? null });
}

/** The final tap. The nonce binds one logical action; a second tap replays; a changed snapshot is REVIEW_CHANGED. */
export function approveCommand(client: RpcClient, reviewNonce: string, shownPayloadHash: string, requestId: string = newRequestId()): Promise<CommandResult<ActionResult & { outbox_id?: string }>> {
  return callCommand(client, "command_approve", { p_review_nonce: reviewNonce, p_shown_payload_hash: shownPayloadHash, p_idempotency_key: requestId });
}

/** Cancel before it leaves. Once a worker holds it the answer is cancellation_requested, and the outcome decides. */
export function cancelCommand(client: RpcClient, actionId: string): Promise<CommandResult<{ action_id: string; state: string; replay?: boolean }>> {
  return callCommand(client, "command_cancel", { p_action: actionId });
}

/** A review nonce lives five minutes (07.1). */
export const REVIEW_TTL_MS = 5 * 60_000;
export function reviewExpired(expiresAt: string, now: string): boolean {
  const e = Date.parse(expiresAt), n = Date.parse(now);
  return !Number.isFinite(e) || !Number.isFinite(n) || n >= e;
}
