import type { TaskData } from "../notes/types";

// THE RIGHT SLOT'S THIRD FORM, BUILT ONCE (TRACE-02b, 2026-09-07).
//
// Contract 4.1 rules the task row's right slot as holding exactly one of an
// action pill, a duration or a time, or a step count, and TRACE-02 shipped
// the count for Today's rows on 2026-09-06. A day later it was still the
// only surface that had it: Life > Tasks answered Start on every open row
// and said nothing about a checklist at all, which is the half of "there is
// no trace of events or steps (for tasks) anywhere in the app" that survived
// the first fix.
//
// Section 0 says no screen defines its own version of a shared component, so
// the second surface takes the markup out of the first rather than copying
// it. ruled.css already carries the treatment (.tr-steps: 12.5/600, --tx-2,
// tabular, numerals in section 5's inline number emphasis); this is the one
// piece of markup that wears it.

export interface StepRollup {
  done: number;
  total: number;
}

// Display only, read off the record and never recomputed anywhere else. The
// same pair the task sheet's own Checklist group prints (TaskSheet.tsx:329)
// and the same one the AI context sends (TRACE-03).
export function stepsOf(t: TaskData): StepRollup {
  const steps = t.steps ?? [];
  return { done: steps.filter((s) => s.done).length, total: steps.length };
}

// UNFINISHED IS THE STATE THAT EARNS THE SLOT (ruled 2026-09-07, on "whatever
// makes the most sense"). A row reading "2 of 5" is a task he has already
// begun, and offering Start on it is telling him to begin a thing he is in
// the middle of; where he is in the list is the more useful fact, and the
// move he actually wants (open it, tick the next item) is the row tap, which
// this does not touch. So for a task underway the Start action does not
// apply, which is 4.1 read literally rather than bent.
//
// A fully ticked list is not underway and hands the slot back. Every item
// done means the checklist has stopped being the thing to say: the sheet
// makes the same turn at the same moment, dropping the item talk for the
// Close Task offer (TaskSheet.tsx:359).
export function hasUnfinishedSteps(s: StepRollup): boolean {
  return s.total > 0 && s.done < s.total;
}

export default function StepCount({ done, total }: StepRollup) {
  return (
    <span className="tr-steps" aria-label={`Checklist ${done} of ${total} done`}>
      <b>{done}</b> of <b>{total}</b>
    </span>
  );
}
