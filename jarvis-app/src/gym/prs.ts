import type { Workout, SetLog, MeasureKind, WorkoutExercise } from "./types";
import { beats, hasVolume, setVolume, formatSet, scoreOf } from "./measures";

// PRs and the finish receipt. Every number here is DERIVED from logged work.
// The app never prescribes ("try 140"); it reports what happened and what the
// user's own best is.

export interface BestEntry { set: SetLog; date: string }

/**
 * The best prior entry per exercise NAME (names are the user's words and
 * survive program edits, so history follows the exercise, not the id).
 *
 * distance_time compares only against the SAME distance: a faster mile is not
 * a record against a slower ten-miler.
 */
export function bestBefore(
  history: Workout[],
  name: string,
  kind: MeasureKind,
  opts: { sameDistanceAs?: number } = {},
): BestEntry | null {
  let best: BestEntry | null = null;
  for (const w of history) {
    for (const ex of w.data.exercises) {
      if (ex.name !== name || ex.kind !== kind) continue; // kind change = fresh history
      for (const s of ex.sets) {
        if (s.skipped) continue;
        if (!scoreOf(kind, s)) continue;
        if (kind === "distance_time" && opts.sameDistanceAs != null && (s.v ?? 0) !== opts.sameDistanceAs) continue;
        if (!best || beats(kind, s, best.set)) best = { set: s, date: w.data.date };
      }
    }
  }
  return best;
}

/** Is this entry a new personal best? A first-ever measured entry counts. */
export function isPR(history: Workout[], name: string, kind: MeasureKind, candidate: SetLog): boolean {
  if (candidate.skipped) return false;
  if (!scoreOf(kind, candidate)) return false;
  const best = bestBefore(history, name, kind, kind === "distance_time" ? { sameDistanceAs: candidate.v ?? 0 } : {});
  if (!best) return true; // first time on this exercise is its own moment
  return beats(kind, candidate, best.set);
}

export interface PRHit { name: string; text: string; from: string | null }

export interface Receipt {
  minutes: number;
  exercises: number;
  volume: number; // 0 when nothing had weight; the tile hides rather than lying
  volumeUnit: string | null;
  prs: PRHit[];
  /** THE `done` BLIND SPOT FIX (catalog §4.8). Sets logged in a kind other
   *  than weight_reps and done -- reps, rounds, timed or measured work. A
   *  second receipt tile so a speed or conditioning day is not left with
   *  nothing to show for itself just because it moved no weight. */
  otherSets: number;
  /** `done`-kind exercises logged this session, by NAME -- arm care and
   *  mobility get a receipt line of their own, not just folded into the
   *  exercise count. */
  doneNames: string[];
}

/**
 * The finish receipt. Volume is the secret weapon (a real number that feels
 * enormous, and a beginner racks it up on day one), but it is only spoken when
 * real weight work happened: a speed day does not get an invented "lbs moved".
 */
export function receiptFor(
  exercises: WorkoutExercise[],
  history: Workout[],
  startedAt: number,
  endedAt: number,
): Receipt {
  let volume = 0;
  let volumeUnit: string | null = null;
  const prs: PRHit[] = [];
  const doneNames: string[] = [];
  let done = 0;
  let otherSets = 0;

  for (const ex of exercises) {
    const logged = ex.sets.filter((s) => !s.skipped);
    if (ex.skipped || logged.length === 0) continue;
    done++;
    if (hasVolume(ex.kind)) {
      for (const s of logged) volume += setVolume(ex.kind, s);
      volumeUnit = volumeUnit ?? ex.unit ?? "lb";
    } else if (ex.kind === "done") {
      doneNames.push(ex.name);
    } else {
      otherSets += logged.length;
    }
    // One PR line per exercise: the best entry of the session, if it beat
    // everything before it.
    let bestOfSession: SetLog | null = null;
    for (const s of logged) if (!bestOfSession || beats(ex.kind, s, bestOfSession)) bestOfSession = s;
    if (bestOfSession && isPR(history, ex.name, ex.kind, bestOfSession)) {
      const prior = bestBefore(history, ex.name, ex.kind, ex.kind === "distance_time" ? { sameDistanceAs: bestOfSession.v ?? 0 } : {});
      prs.push({
        name: ex.name,
        text: formatSet(ex, bestOfSession),
        from: prior ? formatSet(ex, prior.set) : null,
      });
    }
  }

  return {
    minutes: Math.max(1, Math.round((endedAt - startedAt) / 60000)),
    exercises: done,
    volume: Math.round(volume),
    volumeUnit: volume > 0 ? volumeUnit : null,
    prs,
    otherSets,
    doneNames,
  };
}

/**
 * The in-session PR pill (audit 2026-08-25). isPR judges against SAVED
 * history only, so on a new exercise every set wore the pill: the second
 * 135 x 8 "beat" a best that had not been written yet, and three pills on
 * one screen said more than the receipt, which correctly counts one. A set
 * earns the pill only if it also beats every EARLIER set logged this
 * session; a tie keeps the first pill and no other.
 */
export function isSessionPR(
  history: Workout[],
  name: string,
  kind: MeasureKind,
  sets: SetLog[],
  i: number,
): boolean {
  const s = sets[i];
  if (!s || !isPR(history, name, kind, s)) return false;
  for (let j = 0; j < i; j++) {
    const prev = sets[j];
    if (!prev || prev.skipped || !scoreOf(kind, prev)) continue;
    if (!beats(kind, s, prev)) return false; // an earlier set already stands
  }
  return true;
}

/** "Last time: 135 lb × 8, 8, 7" for the in-gym header. Null when new. */
export function lastTimeLine(history: Workout[], name: string, kind: MeasureKind): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const w = history[i]!;
    const ex = w.data.exercises.find((e) => e.name === name && e.kind === kind);
    const logged = ex?.sets.filter((s) => !s.skipped) ?? [];
    if (ex && logged.length) {
      return "Last time: " + logged.map((s) => formatSet(ex, s)).join(", ");
    }
  }
  return null;
}
