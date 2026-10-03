import type { ItemData } from "@core";
import { madeBy } from "../../shared/provenance";
import { isRealDate } from "../../money/ledger/dates";
import { hashPayload } from "../canonical";
import { CAPTURE_PAYLOAD_VERSION, type EvidenceField, type Json, type WaitingPayload } from "../contracts";
import { ENTITY_WAITING, type WaitingData } from "../waiting/types";
import { WaitingService } from "../waiting/WaitingService";
import { notPrepared, undoGuard, type Committed, type DestinationAdapter, type PrepareContext, type PrepareResult, type UndoCheck } from "./types";

// WAITING. The tracker is Email's own, so this adapter writes the one record
// WaitingService writes. A follow-up date is kept on the record and never
// becomes a task or an event (spec section 12).

export const WAITING_ADAPTER_VERSION = "waiting-service-2026-10-03";

function waitingData(input: WaitingPayload, evidence: EvidenceField[], ctx: PrepareContext): WaitingData {
  const data: WaitingData = {
    title: input.title.trim(),
    waitingFor: input.waiting_for.trim(),
    counterpartyDisplay: input.counterparty_display.trim(),
    status: "open",
    startedAt: ctx.now(),
  };
  if (input.contact_id) data.contactId = input.contact_id;
  if (input.follow_up_on) data.followUpOn = input.follow_up_on;
  const first = evidence[0];
  if (first) data.sourceEvidenceId = first.evidence_id;
  if (ctx.threadId) {
    data.threadId = ctx.threadId;
    data.source = madeBy("email", ctx.threadId, () => Date.parse(ctx.now()));
  }
  if (ctx.account) data.account = ctx.account;
  return data;
}

export const waitingAdapter: DestinationAdapter<WaitingPayload> = {
  kind: "waiting",
  destinationKind: ENTITY_WAITING,
  moduleVersion: WAITING_ADAPTER_VERSION,

  async prepare(input, evidence, ctx): Promise<PrepareResult<WaitingPayload>> {
    const missing: string[] = [];
    if (!input.title.trim()) missing.push("title");
    if (!input.waiting_for.trim()) missing.push("waiting_for");
    if (!input.counterparty_display.trim()) missing.push("counterparty_display");
    if (input.follow_up_on !== null && !isRealDate(input.follow_up_on)) missing.push("follow_up_on");
    if (missing.length) return notPrepared(missing);
    const data = waitingData(input, evidence, ctx);
    const normalizedPayload: WaitingPayload = { ...input, title: data.title, waiting_for: data.waitingFor, counterparty_display: data.counterpartyDisplay };
    return {
      ok: true,
      kind: "waiting",
      destinationKind: ENTITY_WAITING,
      data: data as unknown as ItemData,
      normalizedPayload,
      displaySummary: `${data.title} · ${data.counterpartyDisplay}${data.followUpOn ? " · Follow Up " + data.followUpOn : ""}`,
      exactEffect: `Tracked · ${data.title}`,
      payloadHash: await hashPayload(CAPTURE_PAYLOAD_VERSION, normalizedPayload as unknown as Json),
      moduleVersion: WAITING_ADAPTER_VERSION,
    };
  },

  async commit(store, ownerId, prepared, ctx, id): Promise<Committed> {
    const data = prepared.data as unknown as WaitingData;
    const made = await new WaitingService(store, ownerId, () => {}, ctx.now).create(data, id);
    return { itemId: made, revision: (await store.read(ownerId, made))?.serverTime ?? 0, exactEffect: prepared.exactEffect };
  },

  async canUndo(store, ownerId, itemId, recordedRevision): Promise<UndoCheck> {
    return undoGuard(store, ownerId, itemId, recordedRevision);
  },
};
