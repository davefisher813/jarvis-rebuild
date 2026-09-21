// WHAT A HOLDING BLOCK IS HOLDING (2026-08-24).
//
// Dave, on a screenshot showing "1:00 PM Deep Work / Protected" with
// "1:00 PM Finish Jarvis Visuals · Proposed" as the next sibling row: "the
// tasks should be inside deep work. That's another bug."
//
// He is right, and the app half agreed with him already. A focus block PULLS
// TASKS IN by design (routine/types.ts: a block like Deep Work is time set
// aside FOR tasks, so the planner deliberately schedules into it). The
// Schedule tab already drew committed events nested inside their holder. Two
// things were missing:
//
//   1. PROPOSALS were never nested anywhere. They joined the flat time sort,
//      so a task the planner had deliberately placed INTO Deep Work rendered
//      as an unrelated row at the same minute, which reads as a clash.
//   2. Today's Your Day had no nesting at all, for either kind. Its local
//      LockedRange type narrowed the range down to { s, e, label } and threw
//      away the `kind`/`mode` fields that say whether a block holds, so the
//      question could not even be asked there.
//
// One definition, used by both surfaces, covering both kinds of child. This
// module answers exactly one question and does no grouping or rendering, so
// each surface keeps its own anatomy.

import { isFocusRange } from "../routine/types";

// The shared shape. Both surfaces declared their own narrower copy of this;
// Your Day's dropped the very fields nesting depends on.
export interface HoldRange {
  s: number;
  e: number;
  label: string;
  soft?: boolean;
  kind?: string;
  mode?: string;
  // The routine block's own id (2026-08-28), so a tap can jump straight back
  // to editing it. Optional: not every HoldRange producer has one.
  id?: string;
  // Deliberately NOT redeclaring `free` here. RoutineData types it as a list
  // of channels, and a narrower guess would make every real ProtectedRange
  // fail to assign. Nesting does not read it; anything that does should take
  // the routine type directly.
}

export const holdersIn = (locked: HoldRange[]): HoldRange[] => locked.filter(isFocusRange);

/** A COMMITTED EVENT IS A WALL, NOT WORK THE BLOCK PULLED IN (Dave,
 *  2026-09-21, on a screenshot of his own Today: "I also have a job interview
 *  at 3 today and Jarvis is aware. How is that not in the schedule?").
 *
 *  It was in the schedule. It was INSIDE "Deep Work 3:00 PM - 7:00 PM",
 *  behind a collapsed disclosure that called it one of "5 tasks", because
 *  this module nested any event wholly contained by a holding block and both
 *  day lists then filtered it out of the top level. A job interview is not
 *  work Deep Work pulled in. It is the reason Deep Work is not happening.
 *
 *  The August request that built the nesting said TASKS, on a screenshot of a
 *  PROPOSAL drawn beside the block it had been planned into: "the tasks
 *  should be inside deep work". That reading is still right and proposals
 *  still nest. Applying it to committed events was the overreach, and
 *  planDay.ts had already written the opposite rule for the planner it feeds:
 *  "Zones are preferences, not walls: events and hard blocks inside a zone
 *  still win."
 *
 *  So the two kinds of child are not the same kind of thing:
 *
 *    a PROPOSAL is there BECAUSE of the block -- the planner put it there,
 *      and drawing it as a sibling reads as a clash that does not exist.
 *    an EVENT is there DESPITE the block -- nothing consulted the block, and
 *      drawing it inside hides a commitment behind a count.
 *
 *  Nothing may hide a committed event. Both day lists ask this before they
 *  nest, so the rule cannot be true on one surface and not the other, which
 *  is exactly how it came to be wrong on both.
 */
export const NESTABLE = { proposal: true, event: false } as const;

// Stable within a day: two blocks cannot share a label AND a start minute.
export const holderKey = (l: HoldRange): string => l.label + "@" + l.s;

// The holder that wholly contains [startMin, endMin), or null.
//
// WHOLLY, deliberately. A task that starts inside Deep Work and runs past its
// end is not "in" the block, it is overrunning it, and hiding that inside the
// block would hide the overrun. Those stay top-level rows where the overlap
// is visible, which is what the Overlaps badge is for.
export function holderFor(holders: HoldRange[], startMin: number, endMin: number): HoldRange | null {
  // Innermost wins, so a short block nested in a long one takes its own work.
  let best: HoldRange | null = null;
  for (const h of holders) {
    if (startMin < h.s || endMin > h.e) continue;
    if (!best || h.e - h.s < best.e - best.s) best = h;
  }
  return best;
}

// Convenience for the common shape: minutes from an "HH:MM" pair, where a
// missing end means the app's usual hour default.
export const toMin = (hhmm: string): number => {
  const p = hhmm.split(":");
  return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0);
};

export function spanOf(start: string, end?: string): [number, number] {
  const s = toMin(start);
  return [s, end ? toMin(end) : s + 60];
}
