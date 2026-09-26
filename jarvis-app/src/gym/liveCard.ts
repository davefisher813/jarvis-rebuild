// THE LIVE SESSION, AS TODAY READS IT.
//
// (Dave, 2026-09-14: "when I hit start workout ... it automatically feeds to
// the today page and renders what we drew up. It still isn't doing that.")
//
// The card has existed since S5-Q31 and said two things: "Back to Push" and
// the name of whichever exercise was on screen. That is a bookmark. What he
// drew up is the PLAN -- the exercises, in order, with the numbers on them --
// and the plan is already sitting in the live session (`plan` is copied onto
// every exercise at start, deliberately, so a mid-session program edit cannot
// reach it). Nothing was reading it.
//
// So this file turns a LiveSession into the lines Today shows. Pure, and
// separate from the page, because "what is this session, in words" is a
// question worth being able to test without mounting anything.
//
// TWO RULES:
//   1. NOTHING IS INVENTED. Every line is read off the session. An exercise
//      with no plan says how many entries it expects and nothing more; a
//      session with no elapsed time says nothing about time.
//   2. IT COUNTS WHAT HAPPENED, NEVER WHAT IS OWED. "3 of 7 logged" is a
//      fact. "4 remaining" is a debt, and the gym does not keep a tab (the
//      same rule the receipt has kept since GYM1).

import type { Exercise, WorkoutExercise } from "./types";
import { targetLine } from "./measures";
import { elapsedMs, type LiveSession } from "./liveSession";
import { capAfterNumber } from "../shared/casing";

export interface LiveLine {
  /** The exercise's name, exactly as the session carries it. */
  name: string;
  /** What was drawn up for it: "3 × 225 lb × 5", "4 attempts". Null when the
   *  exercise carries no plan at all, which is legal. */
  plan: string | null;
  /** Sets actually logged against it so far. */
  logged: number;
  /** True for the exercise the session is sitting on. */
  current: boolean;
  /** Skipped exercises still show, because they are part of what happened. */
  skipped: boolean;
}

export interface LiveCard {
  dayName: string;
  /** "12 min in", or null before a minute has passed -- a session that says
   *  "0 min in" reads as broken rather than as new. */
  elapsed: string | null;
  /** "23 min left" against the budget the fit set, "Time's up" once it is
   *  gone, null when no budget was set (Dave 2026-09-19: "the time left in
   *  the workout if there's a timer set"). Read off budgetMin and the
   *  session's own clock, so a parked session holds its number. */
  left: string | null;
  /** "2 of 6 logged", always true, never a countdown of what is owed. */
  progress: string;
  /** The whole plan, in order. */
  lines: LiveLine[];
  /** The exercise the session is on. Today's facts line leads with its name
   *  and its plan as separate facts; nothing here joins them into a string. */
  current: LiveLine | null;
  /** True when nothing has been logged yet: the session is drawn up and
   *  waiting, which is exactly the moment Dave is describing. */
  fresh: boolean;
}

/** A logged WorkoutExercise read as the Exercise shape targetLine wants. The
 *  plan lives on `plan` during a session (the program's own strip is copied
 *  in at start); `sets` there is what has been LOGGED. */
function planOf(ex: WorkoutExercise): string | null {
  const plan = ex.plan ?? [];
  if (!plan.length) return null;
  const asExercise = {
    id: ex.exerciseId, name: ex.name, kind: ex.kind,
    ...(ex.unit ? { unit: ex.unit } : {}),
    ...(ex.timeUnit ? { timeUnit: ex.timeUnit } : {}),
    sets: plan,
  } as Exercise;
  return targetLine(asExercise);
}

export function liveCard(s: LiveSession, now: number = Date.now()): LiveCard {
  const lines: LiveLine[] = s.exercises.map((ex, i) => ({
    name: ex.name,
    plan: planOf(ex),
    logged: ex.sets.filter((x) => !x.skipped).length,
    current: i === s.idx,
    skipped: !!ex.skipped,
  }));
  const done = lines.filter((l) => l.logged > 0).length;
  const ms = elapsedMs(s, now);
  const mins = Math.floor(ms / 60_000);
  const leftMs = s.budgetMin ? s.budgetMin * 60_000 - ms : null;
  return {
    dayName: s.dayName,
    elapsed: mins >= 1 ? capAfterNumber(`${mins} min in`) : null,
    left: leftMs === null ? null : leftMs >= 60_000 ? capAfterNumber(`${Math.ceil(leftMs / 60_000)} min left`) : "Time's up",
    progress: capAfterNumber(`${done} of ${lines.length} logged`),
    lines,
    current: lines.find((l) => l.current) ?? null,
    fresh: done === 0,
  };
}
