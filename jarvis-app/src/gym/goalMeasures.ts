import type { Workout, WorkoutExercise, MeasureKind, SetLog } from "./types";
import { scoreOf, has } from "./measures";
import { capAfterNumber } from "../shared/casing";

// GOALS ON THE BAR, D12-A/C (Training Catalog V2, approved 2026-08-31).
//
// "A goal with a finish line" (bigger/measure.ts) already has three kinds --
// count, cadence, projects -- each derived from evidence the app already
// has. A lift target is a fourth: "Bench 225 x 5" is not a count of
// completions, it is a single set somewhere in the log that met or beat a
// number. Hitting it in a session is the celebration; nothing here invents
// a percentage that pretends to be more precise than that.
//
// TrainingMeasure is the fifth: "20 sessions this block" or "Squat twice a
// week" are COUNTED or CADENCED sessions, not reps -- Architecture-C-style
// evidence read straight off the workout list instead of Time Sense
// samples, because a gym session has its own dated record and needs no
// second one. Never a streak (LAW 15's ban on streaks for tasks holds here
// too): a missed week is an off week, not a broken chain.
//
// Both kinds are pure functions of `Workout[]`, same as chartData.ts and
// prs.ts -- no store, no write door, so Track 3's Supabase port carries them
// unchanged.

export interface LiftMeasure {
  kind: "lift";
  /** The exercise's own name, matched the same way history and PRs already
   *  match: by name + kind, not by program id (a name survives program
   *  edits; an id does not follow a swapped exercise). */
  exercise: string;
  measureKind: MeasureKind;
  /** The target set. Shaped exactly like a SetLog because it IS one -- the
   *  same w/r/v/t shape every planned chip and every logged set already
   *  uses, so "225 lb x 5" is `{ w: 225, r: 5 }`, no new vocabulary. */
  target: Pick<SetLog, "w" | "r" | "v" | "t">;
  /** Carried from the exercise at goal-creation time so the progress line
   *  can speak real units ("205 of 225 lb") instead of a bare number.
   *  Absent goals (pre-existing data) just render without a unit. */
  unit?: string;
  timeUnit?: string;
}

export type TrainingCadence = "week" | "month" | "block";

export interface TrainingMeasure {
  kind: "training";
  /** "20 sessions this block" (open-ended, count from `since`) or a weekly
   *  or monthly rhythm -- the same "count vs cadence" split bigger/measure's
   *  CountMeasure/CadenceMeasure already draw, applied to sessions instead
   *  of tasks. */
  per: TrainingCadence;
  times: number;
  /** Stamped when the goal is set, same reason CountMeasure carries one:
   *  without it a fresh goal would inherit every session ever logged.
   *  Cadence windows (week/month) need no stamp -- a window is a window. */
  since?: string;
  /** Only sessions that trained this exercise count, when set. Absent means
   *  any workout counts: "20 sessions this block" with no lift named. */
  exercise?: string;
}

export interface LiftMeasureState {
  done: number;
  target: number;
  met: boolean;
  pct: number;
  line: string;
}

/**
 * Does this ONE logged set meet or beat the target? weight_reps is the one
 * two-field case (both weight AND reps must clear the bar); every other kind
 * reads through scoreOf's own single value and its own direction, so a
 * faster-is-better kind is beaten by going LOWER, exactly as beats() already
 * treats it everywhere else in the gym.
 */
export function meetsLiftTarget(kind: MeasureKind, target: Pick<SetLog, "w" | "r" | "v" | "t">, s: SetLog): boolean {
  if (s.warmup || s.skipped) return false; // THE RAMP IS NOT THE WORK, same as scoreOf itself
  if (kind === "weight_reps") {
    if (!has(s.w) || !has(s.r)) return false;
    if (target.w != null && s.w! < target.w) return false;
    if (target.r != null && s.r! < target.r) return false;
    return true;
  }
  const t = scoreOf(kind, target as SetLog);
  const v = scoreOf(kind, s);
  if (!t || !v) return false; // "done" has no score at all -- no lift goal can ever fire on it
  return t.lowerWins ? v.value <= t.value : v.value >= t.value;
}

/** The target as one number, for the progress line -- weight for
 *  weight_reps (reps is the qualifying gate, not the tracked axis),
 *  scoreOf's own value for everything else. */
function targetValue(kind: MeasureKind, target: Pick<SetLog, "w" | "r" | "v" | "t">): number {
  if (kind === "weight_reps") return target.w ?? 0;
  return scoreOf(kind, target as SetLog)?.value ?? 0;
}

/**
 * The best a logger has ever put up TOWARD this target -- for weight_reps,
 * the heaviest weight touched at or above the target's rep floor (a heavier
 * set at fewer reps does not count: the goal named a rep count on purpose).
 * Every other kind tracks its own best score, direction-aware. Never counts
 * a warmup or a skipped chip.
 */
function bestToward(kind: MeasureKind, target: Pick<SetLog, "w" | "r" | "v" | "t">, workouts: Workout[], exercise: string): number {
  if (kind === "weight_reps") {
    let best = 0;
    for (const w of workouts) {
      const ex = w.data.exercises.find((e) => e.name === exercise && e.kind === kind);
      if (!ex || ex.skipped) continue;
      for (const s of ex.sets) {
        if (s.warmup || s.skipped || !has(s.w) || !has(s.r)) continue;
        if (target.r != null && s.r! < target.r) continue;
        if (s.w! > best) best = s.w!;
      }
    }
    return best;
  }
  let bestScore: { value: number; lowerWins: boolean } | null = null;
  for (const w of workouts) {
    const ex = w.data.exercises.find((e) => e.name === exercise && e.kind === kind);
    if (!ex || ex.skipped) continue;
    for (const s of ex.sets) {
      if (s.warmup || s.skipped) continue;
      const sc = scoreOf(kind, s);
      if (!sc) continue;
      if (!bestScore || (sc.lowerWins ? sc.value < bestScore.value : sc.value > bestScore.value)) bestScore = sc;
    }
  }
  return bestScore?.value ?? 0;
}

/** The progress line's own words -- reps named on the weight_reps line
 *  because the number alone ("205 of 225") would silently drop the rep
 *  floor the goal actually asked for. */
function liftLine(m: LiftMeasure, done: number, target: number, met: boolean): string {
  const u = m.unit ? ` ${m.unit}` : "";
  if (m.measureKind === "weight_reps") {
    const reps = m.target.r != null ? ` at ${m.target.r}+ reps` : "";
    return met
      ? capAfterNumber(`${target}${u}${reps} -- hit it`)
      : capAfterNumber(`${done} of ${target}${u}${reps}`);
  }
  return met ? capAfterNumber(`${target}${u} -- hit it`) : capAfterNumber(`${done} of ${target}${u}`);
}

/**
 * A lift goal's state. `met` is a fact (some logged set cleared the bar,
 * ever); `pct` is a courtesy for the progress bar and is direction-aware,
 * so a faster-time goal fills as the best time drops toward the target
 * rather than climbing away from it.
 */
export function liftMeasureState(m: LiftMeasure, workouts: Workout[]): LiftMeasureState {
  let met = false;
  for (const w of workouts) {
    const ex = w.data.exercises.find((e) => e.name === m.exercise && e.kind === m.measureKind);
    if (!ex || ex.skipped) continue;
    if (ex.sets.some((s) => meetsLiftTarget(m.measureKind, m.target, s))) { met = true; break; }
  }
  const target = targetValue(m.measureKind, m.target);
  const done = bestToward(m.measureKind, m.target, workouts, m.exercise);
  const lowerWins = m.measureKind !== "weight_reps" ? (scoreOf(m.measureKind, m.target as SetLog)?.lowerWins ?? false) : false;
  let pct: number;
  if (target <= 0) pct = 0;
  else if (lowerWins) pct = done > 0 ? Math.min(100, Math.round((target / done) * 100)) : 0;
  else pct = Math.min(100, Math.round((done / target) * 100));
  return { done, target, met, pct: met ? 100 : pct, line: liftLine(m, done, target, met) };
}

const DAY = 86400000;

/** Start of the window holding `now`, for a week or month training cadence
 *  -- the identical Monday-first / calendar-month read bigger/measure.ts's
 *  windowStart already uses for tasks, so a "twice a week" lift goal and a
 *  "run 3x a week" life goal agree on what a week is. */
function trainingWindowStart(per: "week" | "month", now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (per === "month") { d.setDate(1); return d.getTime(); }
  const dow = d.getDay();
  const back = dow === 0 ? 6 : dow - 1;
  return d.getTime() - back * DAY;
}

/** Sessions this training goal counts: any workout that logged real work
 *  somewhere, or (when `exercise` is set) only one that logged it on that
 *  lift specifically. A session that ended with everything skipped is not a
 *  session -- the same "did anything actually happen" gate finish() itself
 *  uses (liveSession's hasWork) before a workout is even saved. */
function countsSession(m: TrainingMeasure, w: Workout): boolean {
  const worked = (e: WorkoutExercise) => !e.skipped && e.sets.some((s) => !s.skipped && scoreOf(e.kind, s));
  if (m.exercise) return w.data.exercises.some((e) => e.name === m.exercise && worked(e));
  return w.data.exercises.some(worked);
}

/** A training goal's state -- count from `since`, or a rolling weekly or
 *  monthly rhythm. Same shape and same honesty as bigger/measure's cadence
 *  and count kinds: no streak field exists to read, so nothing downstream
 *  can render one. */
export function trainingMeasureState(m: TrainingMeasure, workouts: Workout[], now: number = Date.now()): LiftMeasureState {
  const target = Math.max(1, m.times);
  let done: number;
  if (m.per === "block") {
    const from = m.since ? new Date(m.since + "T00:00:00").getTime() : 0;
    done = workouts.filter((w) => countsSession(m, w) && new Date(w.data.date + "T12:00:00").getTime() >= from).length;
  } else {
    const from = trainingWindowStart(m.per, now);
    done = workouts.filter((w) => countsSession(m, w) && new Date(w.data.date + "T12:00:00").getTime() >= from).length;
  }
  const met = done >= target;
  const per = m.per === "block" ? "this block" : m.per === "week" ? "this week" : "this month";
  return {
    done, target, met,
    pct: Math.min(100, Math.round((done / target) * 100)),
    line: capAfterNumber(`${done} of ${target} ${per}`),
  };
}
