// THE EDIT SHEET'S SAVE, WRITTEN ONCE (issue 102, "completion does not persist
// from the Edit Task sheet").
//
// Four screens open the same TaskSheet (Today, Tasks, Schedule, a project's
// page) and each carried its own copy of this chain: twelve field writes, then
// "if Close Task was tapped, toggleDone". Three things were wrong with every
// copy, and one place is how they stay fixed:
//
//  1. Mark Done was a FLIP. A task finished behind the sheet's back was
//     reopened by the tap, and the Done filter's sheet reopened what it listed.
//     It is completeTask now: it sets, and finishing a finished task is a no-op.
//  2. The sheet always closed. A failed write toasted "Couldn't Save" and then
//     closed the sheet anyway, taking the draft with it; and a refused write
//     (the store answering false) did not even toast. A failure keeps the sheet
//     open with its draft and gives the Save button back (BRAIN-F-09 already
//     built that half in TaskSheet, which resets on a false answer).
//  3. The sheet closed in silence. Ticking the ring celebrates with an Undo;
//     Mark Done said nothing, and on a repeating task (which ROLLS to its next
//     date by design, LIFE-F-03) the task just vanished from Today. It speaks
//     now, and says the roll in words.
//
// The draft's fields are written here and nowhere else. A field the sheet gains
// has to be added once, below, and saveTaskEdit.test.ts fails if one is missed.

import type { TasksService } from "./TasksService";
import type { TaskDraft } from "./screens/TaskSheet";
import type { Recurrence, TaskData } from "../notes/types";
import { attemptWrite } from "../shared/guard";
import { showToast } from "../shared/toast";
import { celebrationLine } from "../shared/completion";
import { shortDate } from "../shared/dateFormat";
import { todayISO } from "./grouping";
import { addDays } from "../schedule/calendar";

type Completion = Awaited<ReturnType<TasksService["completeTask"]>>;

/** What a repeating task's roll is called on the toast: "Tomorrow" or "Oct 14". */
const rollWord = (nextDue: string): string => (nextDue === addDays(todayISO(), 1) ? "Tomorrow" : shortDate(nextDue));

/** The line that follows a completion from the sheet. One place, so the four
 *  screens say the same thing. Exported for the tests that pin the wording. */
export function completionLine(c: Completion, id: string): string {
  if (c.rolled) {
    const next = c.nextDue ? ` · Next Due ${rollWord(c.nextDue)}` : "";
    return (c.changed ? "Checked Off For Today" : "Already Checked Off For Today") + next;
  }
  return c.changed ? celebrationLine("task", id) : "Already Done";
}

/**
 * Save the draft onto task `id`, and finish the task too when `closeNow`.
 *
 * Resolves true when everything was written, false when something was not (the
 * failure toast has already been shown, and the caller must leave the sheet
 * open and answer false so Save comes back). `closeNow` is the sheet's one
 * action that is not a stored field, so it is passed by the caller rather than
 * read off the draft. `reload` re-reads the caller's list.
 */
export async function saveTaskEdit(
  svc: TasksService,
  id: string,
  draft: TaskDraft,
  opts: { closeNow?: boolean; reload: () => Promise<unknown> },
): Promise<boolean> {
  const rec = (draft.repeat || "") as "" | Recurrence;
  const landed: { before?: TaskData; completion?: Completion } = {};
  const ok = await attemptWrite(async () => {
    await svc.editText(id, draft.text);
    await svc.setCategories(id, [draft.category, ...(draft.extraCategories ?? [])].filter(Boolean));
    await svc.setDue(id, draft.due || null);
    await svc.setProject(id, draft.projectId ?? null);
    await svc.setGoal(id, draft.goalId ?? null);
    await svc.setEvent(id, draft.eventId ?? null);
    await svc.setRecurrence(id, rec || null);
    await svc.setPlan(id, draft.plan ?? null);
    await svc.setSteps(id, draft.steps ?? []);
    await svc.setNotes(id, draft.notes ?? null);
    await svc.setEstimate(id, draft.estimateMin ?? null);
    await svc.setPerson(id, draft.personId ?? null);
    if (opts.closeNow) {
      // Read after the field writes and before the completion: Undo puts back
      // what the completion changed and nothing else.
      const before = await svc.task(id);
      const completion = await svc.completeTask(id);
      // A completion that did not land is a failed save, not a closed sheet.
      if (!before || !completion.ok) throw new Error("completion was not written");
      landed.before = before;
      landed.completion = completion;
    }
  });
  if (!ok) {
    // Some of the fields may have landed before the one that did not.
    await opts.reload();
    return false;
  }
  const { before, completion } = landed;
  if (before && completion) {
    // Undo sets the state read before the tap and never toggles (SHARED-F-03):
    // it lands on the same answer however late or often it is tapped. Nothing
    // changed, nothing to undo.
    showToast({
      message: completionLine(completion, id),
      ...(completion.changed
        ? { actionLabel: "Undo", onAction: async () => { await attemptWrite(() => svc.restoreCompletion(id, before)); await opts.reload(); } }
        : {}),
    });
  }
  return true;
}
