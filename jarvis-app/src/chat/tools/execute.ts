// MAKING THE CHANGE (chat box order, 2026-10-24). This is the only place a proposal becomes a write, and it is reached from exactly one
// place: the person's tap on the card, through ProposalStore.approve (proposals.ts), which has already checked the proposal is open, inside
// its five minutes, and bound to the content the card showed. Nothing the model says reaches this file: it never receives a proposal, only
// a note that one is waiting.
//
// What it returns is the dispatcher's own account of what happened, and the thread draws its receipt from that and from nothing else
// (law 3: "action claims render ONLY from dispatcher states, never from the model's words"). Every write brings its own Undo, built from the
// record as it was just before, so Undo puts back what was there and not what the card guessed.
//
// The record is looked at once more before it is touched. A card is a promise about a task as the person saw it; if the task has changed since
// (edited, finished, deleted somewhere else) the change is not made, and the person is told, instead of a stale card overwriting something new.

import type { TaskData } from "../../notes/types";
import { weekdayShortDate } from "../../shared/dateFormat";
import type { RecordRef } from "./dispatcher";
import { plain, type Priority, type ProposalContent } from "./proposals";

/** The writes a proposal may make, and the reads that check the record first. Handed in by the hook; nothing else reaches the services. */
export interface WriteDeps {
  task(id: string): Promise<TaskData | null>;
  createTask(text: string, opts: { due?: string; priority?: Priority; personId?: string }): Promise<string | null>;
  deleteTask(id: string): Promise<void>;
  setDue(id: string, due: string | null): Promise<boolean>;
  completeTask(id: string): Promise<{ ok: boolean }>;
  restoreCompletion(id: string, before: TaskData): Promise<boolean>;
  editText(id: string, text: string): Promise<boolean>;
  setPriority(id: string, priority: Priority | null): Promise<boolean>;
  createDecision(d: { decision: string; why?: string; ruledOut?: string }): Promise<string | null>;
  removeDecision(id: string): Promise<void>;
}

export type Executed =
  | {
      ok: true;
      /** The thread's receipt line, from what was done. */
      receipt: string;
      /** The toast's words, with Undo. */
      toast: string;
      refs: RecordRef[];
      undo: () => Promise<void>;
    }
  | { ok: false; message: string };

const failed = (message: string): Executed => ({ ok: false, message });

export async function executeProposal(c: ProposalContent, deps: WriteDeps): Promise<Executed> {
  try {
    switch (c.kind) {
      case "create_task": {
        const id = await deps.createTask(c.text, { ...(c.due ? { due: c.due } : {}), ...(c.priority ? { priority: c.priority } : {}), ...(c.personId ? { personId: c.personId } : {}) });
        if (!id) return failed("That task could not be saved · Nothing was added");
        return {
          ok: true,
          receipt: `Added: ${c.text}`,
          toast: "Task added",
          refs: [{ kind: "task", id, label: c.text }],
          undo: () => deps.deleteTask(id),
        };
      }

      case "update_task": {
        const now = await deps.task(c.taskId);
        if (!now) return failed("That task is gone · Nothing was changed");
        if (now.done) return failed("That task is already done · Nothing was changed");
        if (now.bill || now.reminder) return failed("That one is changed somewhere else · Nothing was changed");
        // The record must still be what the card was drawn from.
        if (now.text !== c.basis.text || (now.due ?? null) !== c.basis.due || (now.priority ?? null) !== c.basis.priority) {
          return failed("That task changed since this card was drawn · Nothing was changed");
        }
        const ch = c.change;
        // Each step is recorded as it lands, so a failure part-way undoes what did land and says it was partial, never success.
        const undone: (() => Promise<unknown>)[] = [];
        const step = async (ok: boolean, undo: () => Promise<unknown>) => { if (!ok) throw new Error("step failed"); undone.unshift(undo); };
        try {
          if (ch.text !== undefined) await step(await deps.editText(c.taskId, ch.text), () => deps.editText(c.taskId, now.text));
          if (ch.priority !== undefined) await step(await deps.setPriority(c.taskId, ch.priority), () => deps.setPriority(c.taskId, (now.priority ?? null) as Priority | null));
          if (ch.due !== undefined) await step(await deps.setDue(c.taskId, ch.due), () => deps.setDue(c.taskId, now.due ?? null));
          if (ch.done) {
            const r = await deps.completeTask(c.taskId);
            await step(r.ok, () => deps.restoreCompletion(c.taskId, now));
          }
        } catch {
          for (const u of undone) await u().catch(() => undefined);
          return failed("That change could not be saved · Nothing was changed");
        }
        return {
          ok: true,
          receipt: receiptFor(c),
          toast: ch.done ? "Task completed" : ch.due !== undefined ? "Task moved" : "Task changed",
          refs: [{ kind: "task", id: c.taskId, label: ch.text ?? plain(c.title) }],
          // Every step is put back even if one will not go, and the caller is told when any did not.
          undo: async () => {
            let missed = false;
            for (const u of undone) { try { await u(); } catch { missed = true; } }
            if (missed) throw new Error("undo incomplete");
          },
        };
      }

      case "capture_decision": {
        const id = await deps.createDecision({ decision: c.decision, ...(c.why ? { why: c.why } : {}), ...(c.ruledOut ? { ruledOut: c.ruledOut } : {}) });
        if (!id) return failed("That decision could not be saved · Nothing was added");
        return {
          ok: true,
          receipt: `Saved decision · ${c.decision}`,
          toast: "Saved decision",
          refs: [{ kind: "decision", id, label: c.decision }],
          undo: () => deps.removeDecision(id),
        };
      }
    }
  } catch {
    return failed("Couldn't Save · Check Your Connection");
  }
}

/** The thread's line for an update, from the change that was made. */
function receiptFor(c: Extract<ProposalContent, { kind: "update_task" }>): string {
  const ch = c.change;
  const title = plain(c.title);
  const keys = Object.keys(ch).filter((k) => (ch as Record<string, unknown>)[k] !== undefined);
  if (keys.length === 1 && ch.done) return `Done: ${title}`;
  if (keys.length === 1 && ch.due !== undefined) return ch.due === null ? `Cleared the date: ${title}` : `Moved to ${weekdayShortDate(ch.due)}: ${title}`;
  if (keys.length === 1 && ch.text !== undefined) return `Renamed: ${ch.text}`;
  return `Changed: ${ch.text ?? title}`;
}
