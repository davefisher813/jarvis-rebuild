import type { TaskData } from "../notes/types";

// A TASK ROW'S ONE QUICKEST VERB (Dave 2026-10-05, locked; docs/jarvis-unified/ROW-ACTIONS-SPEC.md section 1).
//
// A row has no pill. Its verb is the swipe-left, the first button in the tray, and, once the row's moment has come
// (it is overdue), the one quiet word on the row itself (shared/RowCtxAction). The same verb in all three places, so a
// row never says Start in one and Begin in another. The tap opens the sheet (every action), the long press opens the
// menu, and swipe right completes.
//
//   ready to work            Start        (Unblock when the task is marked blocked: the same door, the honest word)
//   active (work in hand)    Wrap Up      (a saved session with work in it, the "Resume" of the old pill)
//   low priority or parked   Move         (the task that keeps sliding: one tap puts it on tomorrow, the sheet holds Drop)
//   a bill                   Mark Paid
//   otherwise                Done
//
// A caller with no way to start (the Health page's reminder rows, a list with no Start) falls through to Done, and a
// done task has no verb at all (it keeps Delete behind the reveal and nothing else).
export type TaskVerb = "Start" | "Unblock" | "Wrap Up" | "Move" | "Mark Paid" | "Done";

export function taskVerb(
  t: Pick<TaskData, "done" | "bill">,
  o: { canStart: boolean; canMove: boolean; canDone: boolean; startLabel?: "Start" | "Resume" | "Unblock"; lowPriority?: boolean },
): TaskVerb | null {
  if (t.done) return null;
  if (t.bill) return o.canDone ? "Mark Paid" : null;
  if (o.lowPriority && o.canMove) return "Move";
  if (o.canStart) {
    if (o.startLabel === "Resume" && o.canDone) return "Wrap Up";
    return o.startLabel === "Unblock" ? "Unblock" : "Start";
  }
  return o.canDone ? "Done" : null;
}

/** The verbs that begin work rather than finish it: the ones whose tap hands the task to Start. */
export const isStartVerb = (v: TaskVerb | null): boolean => v === "Start" || v === "Unblock";
