// THE DESTINATION ADAPTER CONTRACT (IMPLEMENTATION-SPEC.md section 14;
// docs/jarvis-unified/ADAPTER-CONTRACT.md is the written version shared with
// the Money work).
//
// A capture lands in exactly one existing module: bills and receipts in
// Money, tasks in Tasks, events in Schedule, waiting in Email's own tracker.
// Each adapter does three things and nothing else:
//
//   prepare   pure. Validates, normalises, and produces EXACTLY the item.data
//             the module's own writer would store, plus the words a receipt
//             will carry. Side-effect free; safe to call on every keystroke.
//   commit    writes through the module's own writer (LedgerService.addBill,
//             TasksService.createTask, ...). The server command of slice 03
//             instead inserts `prepared.data` under `prepared.destinationKind`
//             inside one database transaction; the contract tests hold the
//             two paths equal so a record saved either way reads the same in
//             its module.
//   canUndo   whether a compensating delete is still honest: the item is
//             unchanged since it was written and nothing else refers to it.
//
// A bill is never a task. That is not a rule an adapter checks; it is the
// shape of this registry (DESTINATION_OF) and of the database trigger that
// refuses a bill candidate pointed at a task.

import type { Store, ItemData } from "@core";
import type { CaptureKind, CapturePayload, EvidenceField } from "../contracts";

export type DestinationKind = "money_bill" | "money_receipt" | "task" | "event" | "waiting";

export const DESTINATION_OF: Record<CaptureKind, DestinationKind> = {
  bill: "money_bill",
  receipt: "money_receipt",
  task: "task",
  event: "event",
  waiting: "waiting",
};

export const MODULE_OF: Record<CaptureKind, "Money" | "Tasks" | "Schedule" | "Email"> = {
  bill: "Money",
  receipt: "Money",
  task: "Tasks",
  event: "Schedule",
  waiting: "Email",
};

export interface PrepareContext {
  /** The ISO instant for history lines and provenance. Injected so a test can pin it. */
  now: () => string;
  /** The person's local date, YYYY-MM-DD. */
  today: string;
  /** The reader's IANA zone: a timed event's wall clock is stored in it, the way the mail importer does. */
  zone: string;
  /** The mail thread the evidence came from, when it came from mail. */
  threadId?: string;
  /** The mailbox address, when the evidence came from mail. */
  account?: string;
}

export interface Prepared<P extends CapturePayload = CapturePayload> {
  ok: true;
  kind: P["kind"];
  destinationKind: DestinationKind;
  /** Exactly the item.data the module's writer stores. */
  data: ItemData;
  /** The payload after normalisation (trimmed names, resolved dates). */
  normalizedPayload: P;
  /** One line for the card: "Con Edison · $142.30 · Due Oct 15". */
  displaySummary: string;
  /** The receipt's exact verb once committed: "Saved $142.30 Bill to Money". */
  exactEffect: string;
  /** SHA-256 over the normalised payload; what the approval binds to. */
  payloadHash: string;
  moduleVersion: string;
}

export interface NotPrepared {
  ok: false;
  /** MISSING_DETAILS: the person can fix it. UNSUPPORTED: the module cannot hold it yet; the candidate stays in Email. */
  code: "MISSING_DETAILS" | "UNSUPPORTED";
  missing: string[];
  reason: string;
}

export type PrepareResult<P extends CapturePayload = CapturePayload> = Prepared<P> | NotPrepared;

export interface Committed {
  itemId: string;
  /** The item's server revision at commit (updated_at as epoch millis). */
  revision: number;
  exactEffect: string;
  /** Set when the module recognised an existing record and wrote nothing new. */
  duplicateOf?: string;
}

export interface UndoCheck { eligible: boolean; reason: string | null }

export interface DestinationAdapter<P extends CapturePayload = CapturePayload> {
  kind: P["kind"];
  destinationKind: DestinationKind;
  moduleVersion: string;
  prepare(input: P, evidence: EvidenceField[], ctx: PrepareContext): Promise<PrepareResult<P>>;
  commit(store: Store, ownerId: string, prepared: Prepared<P>, ctx: PrepareContext, id?: string): Promise<Committed>;
  canUndo(store: Store, ownerId: string, itemId: string, recordedRevision: number): Promise<UndoCheck>;
}

export const ITEM_REMOVED = "Item Removed";
export const ITEM_CHANGED = "This Item Changed · Open It to Review";

export function notPrepared(missing: string[], reason = "Add the Highlighted Details Before Saving"): NotPrepared {
  return { ok: false, code: "MISSING_DETAILS", missing, reason };
}

export function unsupported(missing: string[], reason: string): NotPrepared {
  return { ok: false, code: "UNSUPPORTED", missing, reason };
}

/** The revision guard every canUndo starts with. */
export async function undoGuard(store: Store, ownerId: string, itemId: string, recordedRevision: number): Promise<UndoCheck & { changed?: true }> {
  const row = await store.read(ownerId, itemId);
  if (!row) return { eligible: false, reason: ITEM_REMOVED };
  if (row.serverTime !== recordedRevision) return { eligible: false, reason: ITEM_CHANGED };
  return { eligible: true, reason: null };
}
