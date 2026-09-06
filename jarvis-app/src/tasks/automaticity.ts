// REPETITIONS, NOT STREAKS (D1, approved 2026-08-20).
//
// Keller et al. 2021, a randomized controlled trial: routine-based and
// time-based cues produced the SAME habit automaticity. What predicted
// automaticity was neither cue type: it was how often the plan was actually
// enacted. Among people who formed the habit, peak automaticity arrived at a
// median of 59 days.
//
// That gives the honest version of the thing streaks pretend to be. A count
// of repetitions has all of the pull of a streak and none of the cliff:
// missing a day costs one day, not the whole run.
//
// This is deliberately NOT a streak, and the difference is the entire point:
//   - Nothing ever resets. A gap is a gap, not a failure.
//   - There is no "best run" to lose, so loss aversion has nothing to grip.
//   - The horizon is a MEDIAN from the study, framed as "most people", never
//     as a target he is behind on.

// Median days to peak automaticity among those who formed the habit.
export const AUTOMATIC_MEDIAN = 59;
// Below this a count is noise, and a progress line implies a precision the
// data does not have.
export const MIN_TO_SHOW = 3;

export interface Automaticity {
  done: number;
  // 0..1 against the study median, capped. Progress, never a grade.
  progress: number;
  automatic: boolean;
}

export function automaticityOf(doneCount: number): Automaticity {
  const done = Math.max(0, Math.floor(doneCount));
  return {
    done,
    progress: Math.min(1, done / AUTOMATIC_MEDIAN),
    automatic: done >= AUTOMATIC_MEDIAN,
  };
}

// The line under a reminder. Silent early, because "done 1 time" is not
// information. Never says how many were missed: the count is of what he DID,
// and a miss count is a streak in disguise.
export function automaticityLine(a: Automaticity): string | null {
  if (a.done < MIN_TO_SHOW) return null;
  const times = `Done ${a.done} times`;
  if (a.automatic) return `${times} · This one's automatic`;
  return `${times} · Most people are automatic around ${AUTOMATIC_MEDIAN}`;
}

// BAN-1 (2026-09-05): the bare count, for surfaces that show the fact
// without the automaticity framing. Area pages used to render "N in a row ·
// Best M" off the streak fields; the D1 ruling is a count, never a run, so
// they render this instead. Same floor as the reminder line: below
// MIN_TO_SHOW a count is noise, so it says nothing at all.
export function repetitionsLine(doneCount: number | undefined): string | null {
  const done = Math.max(0, Math.floor(doneCount ?? 0));
  if (done < MIN_TO_SHOW) return null;
  return `Done ${done} times`;
}

// Counting a repetition. Idempotent per day, because a reminder ticked,
// unticked and ticked again is one enactment, not three, and a count that can
// be farmed is a count that means nothing.
export function countEnactment(
  prev: number | undefined,
  lastCountedDay: string | undefined,
  today: string,
): { doneCount: number; lastCounted: string } {
  if (lastCountedDay === today) return { doneCount: prev ?? 0, lastCounted: today };
  return { doneCount: (prev ?? 0) + 1, lastCounted: today };
}
