// THE ATOMIC LOCAL SAVE, FROM THE CLIENT'S SIDE (IMPLEMENTATION-SPEC.md 07.2,
// 07.4). A card the person is looking at becomes a life record in ONE call to
// capture_approve: the adapter prepares exactly the item.data the module's
// own writer would store (pure, here), and the database checks the revision,
// the hash, the source, the module's invariants, then writes the item, the
// evidence, the candidate's transition, the approval and the confirmed
// receipt together, or none of them. Undo is a new compensating action under
// the item's revision. The cards that call this arrive with slice 06.

import type { CaptureKind, CapturePayload, EvidenceField } from "../contracts";
import { adapterFor } from "../destinations/registry";
import type { DestinationAdapter, PrepareContext, Prepared } from "../destinations/types";
import { callCommand, failure, newRequestId, type CommandResult, type RpcClient } from "./errors";

/** What a candidate card knows about itself when the person taps Save. */
export interface CandidateCard {
  id: string;
  kind: CaptureKind;
  /** The revision the card was rendered from; the server refuses any other. */
  revision: number;
  /** The server-computed hash of the payload the card shows; the approval binds to it. */
  payloadHash: string;
  payload: CapturePayload;
  evidence?: EvidenceField[];
  /** The excerpt the receipt's evidence row keeps (2,000 chars at most); the message snippet when absent. */
  evidenceExcerpt?: string;
}

/** The envelope every command returns (API-AND-VALIDATION.md "Endpoint envelope"). */
export interface ActionResult {
  action_id: string;
  state: string;
  destination_id: string | null;
  receipt_id: string | null;
  safe_message: string;
  /** True when this answer is the first tap's, replayed. */
  replay?: boolean;
  /** The item's revision at commit; what Undo must present. */
  item_updated_at?: string | null;
  evidence_id?: string;
  /** True when the module recognised an existing record and wrote nothing new. */
  already?: boolean;
  undone_action_id?: string;
}

/** The adapter's output in the shape capture_approve checks. */
export interface ServerPrepared {
  destination_kind: string;
  data: Record<string, unknown>;
  exact_effect: string;
  display_summary: string;
  module_version: string;
  evidence_excerpt?: string;
}

export function preparedForServer(p: Prepared, evidenceExcerpt?: string): ServerPrepared {
  const out: ServerPrepared = {
    destination_kind: p.destinationKind,
    data: p.data as Record<string, unknown>,
    exact_effect: p.exactEffect,
    display_summary: p.displaySummary,
    module_version: p.moduleVersion,
  };
  if (evidenceExcerpt) out.evidence_excerpt = evidenceExcerpt.slice(0, 2000);
  return out;
}

export interface ApproveOptions {
  /** The module readiness the screen already fetched; false short-circuits to MODULE_UNAVAILABLE without a round trip. */
  ready?: (kind: CaptureKind) => boolean;
  /** One id per tap; a retry of the same tap passes the same one. */
  requestId?: string;
}

/** Save this card: prepare locally, then one transaction on the server. */
export async function approveCapture(client: RpcClient, card: CandidateCard, ctx: PrepareContext, opts: ApproveOptions = {}): Promise<CommandResult<ActionResult>> {
  if (opts.ready && !opts.ready(card.kind)) return failure("MODULE_UNAVAILABLE", { destination: card.kind });
  const adapter = adapterFor(card.kind) as unknown as DestinationAdapter<CapturePayload>;
  const prep = await adapter.prepare(card.payload, card.evidence ?? [], ctx);
  if (!prep.ok) return failure(prep.code === "UNSUPPORTED" ? "UNSUPPORTED" : "MISSING_DETAILS", { missing: prep.missing }, prep.reason);
  return callCommand<ActionResult>(client, "capture_approve", {
    p_candidate: card.id,
    p_expected_revision: card.revision,
    p_shown_payload_hash: card.payloadHash,
    p_idempotency_key: opts.requestId ?? newRequestId(),
    p_prepared: preparedForServer(prep, card.evidenceExcerpt),
  });
}

/** Undo a save: the item is removed only if it is exactly as written and nothing refers to it. */
export function undoCapture(client: RpcClient, actionId: string, itemUpdatedAt: string, requestId: string = newRequestId()): Promise<CommandResult<ActionResult>> {
  return callCommand<ActionResult>(client, "action_undo", { p_action: actionId, p_expected_item_updated_at: itemUpdatedAt, p_idempotency_key: requestId });
}

/** The toast offers Undo for ten seconds after a save (07.4); the receipt keeps it while eligible. */
export const UNDO_TOAST_MS = 10_000;
export function undoToastOpen(savedAt: string, now: string): boolean {
  const a = Date.parse(savedAt), b = Date.parse(now);
  return Number.isFinite(a) && Number.isFinite(b) && b >= a && b - a <= UNDO_TOAST_MS;
}

export interface CandidateChange { candidate_id: string; revision: number; status: string; payload_hash?: string; replay?: boolean }

/**
 * Replace the card's typed fields. `userFields` are the ones the person
 * typed (tagged entered_by_user); `missing` the ones still empty, which keep
 * the card at needs_details. The hash moves with the edit.
 */
export function editCandidate(client: RpcClient, card: Pick<CandidateCard, "id" | "revision">, payload: Record<string, unknown>, userFields: string[], missing: string[] = []): Promise<CommandResult<CandidateChange>> {
  return callCommand<CandidateChange>(client, "candidate_edit", { p_candidate: card.id, p_expected_revision: card.revision, p_payload: payload, p_user_fields: userFields, p_missing: missing });
}

export function dismissCandidate(client: RpcClient, card: Pick<CandidateCard, "id" | "revision">): Promise<CommandResult<CandidateChange>> {
  return callCommand<CandidateChange>(client, "candidate_dismiss", { p_candidate: card.id, p_expected_revision: card.revision });
}

export function restoreCandidate(client: RpcClient, card: Pick<CandidateCard, "id" | "revision">): Promise<CommandResult<CandidateChange>> {
  return callCommand<CandidateChange>(client, "candidate_restore", { p_candidate: card.id, p_expected_revision: card.revision });
}
