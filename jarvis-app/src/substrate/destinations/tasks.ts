import type { Store, ItemData } from "@core";
import { TasksService } from "../../tasks/TasksService";
import { ENTITY_TASK, type TaskData } from "../../notes/types";
import { ENTITY_EVENT, type EventData } from "../../schedule/types";
import { madeBy } from "../../shared/provenance";
import { isRealDate } from "../../money/ledger/dates";
import { hashPayload } from "../canonical";
import { CAPTURE_PAYLOAD_VERSION, type EvidenceField, type Json, type TaskPayload } from "../contracts";
import { notPrepared, undoGuard, type Committed, type DestinationAdapter, type PrepareContext, type PrepareResult, type UndoCheck } from "./types";

// TASKS. A task from a card is the task TasksService.createTask makes, with
// its email provenance (source and fromThread), so Today folds it into the
// Email band and the From Email list the way it folds every mail task. No
// amount, no vendor, no bill: a bill-shaped thing never reaches this file,
// because the registry routes bills to Money and the task service's own guard
// is the second wall.

export const TASKS_ADAPTER_VERSION = "tasks-service-2026-10-03";

function nowMs(ctx: PrepareContext): () => number {
  return () => Date.parse(ctx.now());
}

function taskData(title: string, due: string | null, notes: string, ctx: PrepareContext): TaskData {
  const data: TaskData = { text: title, category: "", done: false };
  if (due) data.due = due;
  if (notes) data.notes = notes;
  if (ctx.threadId) {
    data.fromThread = ctx.threadId;
    data.source = madeBy("email", ctx.threadId, nowMs(ctx));
  }
  return data;
}

export const taskAdapter: DestinationAdapter<TaskPayload> = {
  kind: "task",
  destinationKind: ENTITY_TASK,
  moduleVersion: TASKS_ADAPTER_VERSION,

  async prepare(input, _evidence: EvidenceField[], ctx): Promise<PrepareResult<TaskPayload>> {
    const missing: string[] = [];
    const title = input.title.trim();
    if (!title) missing.push("title");
    if (input.due_date !== null && !isRealDate(input.due_date)) missing.push("due_date");
    if (missing.length) return notPrepared(missing);
    const notes = input.notes.trim();
    const normalizedPayload: TaskPayload = { kind: "task", title, due_date: input.due_date, notes };
    return {
      ok: true,
      kind: "task",
      destinationKind: ENTITY_TASK,
      data: taskData(title, input.due_date, notes, ctx) as unknown as ItemData,
      normalizedPayload,
      displaySummary: `${title} · ${input.due_date ? "Due " + input.due_date : "No Deadline"}`,
      exactEffect: `Added to Tasks · ${title}`,
      payloadHash: await hashPayload(CAPTURE_PAYLOAD_VERSION, normalizedPayload as unknown as Json),
      moduleVersion: TASKS_ADAPTER_VERSION,
    };
  },

  async commit(store, ownerId, prepared, ctx, id): Promise<Committed> {
    const p = prepared.normalizedPayload;
    const data = taskData(p.title, p.due_date, p.notes, ctx);
    const made = await new TasksService(store, ownerId).createTask(p.title, {
      due: data.due ?? null,
      ...(data.notes ? { notes: data.notes } : {}),
      ...(data.fromThread ? { fromThread: data.fromThread } : {}),
      ...(data.source ? { source: data.source } : {}),
    }, id);
    if (!made) throw new Error("MISSING_DETAILS:title");
    return { itemId: made, revision: (await store.read(ownerId, made))?.serverTime ?? 0, exactEffect: prepared.exactEffect };
  },

  async canUndo(store, ownerId, itemId, recordedRevision): Promise<UndoCheck> {
    const guard = await undoGuard(store, ownerId, itemId, recordedRevision);
    if (!guard.eligible) return guard;
    const events = await store.listForUser(ownerId, ENTITY_EVENT);
    const onSchedule = events.some((e) => {
      const d = e.data as unknown as EventData & { sourceTaskId?: string };
      return d.sourceTaskId === itemId || (d.taskIds ?? []).includes(itemId);
    });
    if (onSchedule) return { eligible: false, reason: "This Task Is on Your Schedule" };
    return { eligible: true, reason: null };
  },
};
