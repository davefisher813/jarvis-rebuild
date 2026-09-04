import type { Goal } from "../life/types";
import type { MonthSealData } from "./seal";
import { liveGoals, goalTags } from "../bigger/reach";

// "STILL TRUE?" (Brain build handoff item 10, the remnant of it that is worth
// building here).
//
// Item 10 asked for a small schema for a stated goal, reviewed monthly, no
// daily tracking, retired without guilt. Almost all of that already exists in
// this app and is richer than the spec: real goals with measures, derived
// health, tag reach into areas, and a monthly review. The handoff's own
// do-not-build list forbids a second goals store, so the item was reported as
// mostly-already-here on 2026-09-04 with one piece worth keeping:
//
//   "you said this mattered, and nothing has moved, still true?"
//
// Dave took it. This is that, and only that.
//
// POSITIVE EVIDENCE OF A STOP, NOT ABSENCE OF EVIDENCE. The whole question
// turns on the difference. A goal with no activity might be a goal that has
// gone quiet, or it might be a goal added last Tuesday, or one whose work
// simply is not tagged. So the question is only asked about a goal that WAS
// moving last month and moved in no way at all this month: nothing finished
// under any of its areas, and nothing scheduled for them either. That is the
// same standard measure.ts's own idle() keeps ("silence with no history says
// nothing"), and it is what makes this a question a person recognises rather
// than a nag at whoever writes the fewest tags.
//
// IT IS A QUESTION AND THE ANSWER MAY BE YES. A goal can matter enormously
// and have a month where nothing happens: an injury, an exam period, a month
// the money was not there. The card asks; it does not conclude. Nothing here
// changes a goal's state, and the app has a real "cut" path with a decision
// attached for when the answer is no. That path is not this one.

/** Completions under a goal's areas last month, below which "it was moving"
 *  is not a claim worth making. Three is a week of touching it, roughly. */
export const STILL_TRUE_MIN_PREV = 3;

/** At most this many asked in one report. Two is a question; six is an
 *  inventory of everything you are failing at, which is the opposite. */
export const STILL_TRUE_MAX = 2;

export interface StillTrueGoal {
  id: string;
  title: string;
  /** Completions under its areas in the previous month. The receipt. */
  wasDone: number;
}

function sumOver(map: Record<string, number> | undefined, keys: string[]): number {
  if (!map) return 0;
  let n = 0;
  for (const k of keys) n += map[k] ?? 0;
  return n;
}

/**
 * The live goals worth asking about this month.
 *
 * Needs the previous month's seal: with nothing to compare against there is
 * no "was moving", so the question cannot be asked honestly and none is.
 * Returns them worst-first, meaning the one that dropped the furthest.
 */
export function stillTrueGoals(seal: MonthSealData, prev: MonthSealData | null, goals: Goal[]): StillTrueGoal[] {
  if (!prev) return [];
  const out: StillTrueGoal[] = [];
  for (const g of liveGoals(goals)) {
    const tags = goalTags(g);
    // No tags means no reach, which means the app genuinely cannot see
    // whether anything moved. Silence, not a guess.
    if (tags.length === 0) continue;
    const wasDone = sumOver(prev.byCategory, tags);
    if (wasDone < STILL_TRUE_MIN_PREV) continue;
    const nowDone = sumOver(seal.byCategory, tags);
    if (nowDone > 0) continue;
    // Scheduled time counts as movement even with nothing finished: a month
    // of showing up and finishing nothing is still a month of caring about it.
    const nowScheduled = sumOver(seal.hours, tags);
    if (nowScheduled > 0) continue;
    out.push({ id: g.id, title: g.data.title, wasDone });
  }
  return out.sort((a, b) => b.wasDone - a.wasDone || a.title.localeCompare(b.title)).slice(0, STILL_TRUE_MAX);
}
