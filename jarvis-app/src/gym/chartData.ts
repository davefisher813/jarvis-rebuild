import type { Workout, SetLog, MeasureKind } from "./types";
import { beats, scoreOf, hasVolume, setVolume, toLb, LB_PER_KG } from "./measures";
import { liftRef, sameLift, sameLiftAnyKind, type LiftLike } from "./identity";

// LIFT TREND CHARTS, D9-A (Training Catalog V2, approved 2026-08-31).
// "Boostcamp's most loved analytics are e1RM curves and PR tracking. Our
// History is text." One canonical per-session series -- the same shape
// history.ts's exerciseHistory already builds, but carrying the NUMBER, not
// just its formatted text, because a chart needs to plot it and D11/D12/D13
// all need to compare it. Everything downstream (the chart itself, the
// metric-correlation panels, plateau detection, goal-crossing) reads this
// one series so there is exactly one definition of "what a session did".

export interface LiftSession {
  /** GYM-F-30 (2026-09-05): the workout this row came from. Two sessions can
   *  share a date -- logging a past workout onto a day that already has one,
   *  or training the same lift morning and evening -- and the date alone was
   *  being used as identity, which made duplicate React keys on the lift
   *  page's Sessions list and could render the wrong row. */
  workoutId: string;
  date: string;
  /** The session's best working set for this exercise (warmups and skipped
   *  chips excluded by scoreOf itself -- LAW 16 is not re-litigated here). */
  top: SetLog;
  /** scoreOf's own value: weight for weight_reps, reps for reps/rounds,
   *  seconds for time kinds, pace for distance_time. Direction-aware
   *  comparisons still go through beats(), never a raw > on this alone. */
  score: number;
  /** Estimated one-rep max (Epley), weight_reps only. Null for every other
   *  kind -- a rep count or a pace has no "1RM" to estimate. */
  e1rm: number | null;
  /** GYM-F-06 (2026-09-05): the unit `top` was logged in. `score` and `e1rm`
   *  are always in POUNDS so the chart is one continuous line across a unit
   *  change; a screen printing `top` converts it into the unit it is showing
   *  rather than relabelling last year's number. */
  unit?: string;
}

/** Epley: the formula the D9 research settled on. Rounded, because a
 *  fractional pound estimate reads as false precision. */
export function e1rm(w: number, r: number): number {
  return Math.round(w * (1 + r / 30));
}

/** One row per workout that actually logged a scoring set for this exercise,
 *  oldest first -- the chart's x-axis is chronological. */
export function liftSessions(workouts: Workout[], lift: LiftLike, kind: MeasureKind): LiftSession[] {
  // GYM-F-04 (2026-09-05): identity, not the name, so a renamed lift keeps one
  // chart instead of restarting.
  const ref = liftRef(lift, kind);
  const sorted = [...workouts].sort((a, b) => a.data.date.localeCompare(b.data.date));
  const out: LiftSession[] = [];
  for (const w of sorted) {
    const ex = w.data.exercises.find((e) => sameLift(ref, e));
    if (!ex || ex.skipped) continue;
    let top: SetLog | null = null;
    for (const s of ex.sets) {
      if (s.skipped || !scoreOf(kind, s, ex.unit)) continue;
      if (!top || beats(kind, s, top)) top = s; // one session, one unit
    }
    if (!top) continue;
    // GYM-F-06: the plotted numbers are pounds, whatever the session logged in,
    // so switching a lift to kg no longer plunges its e1RM chart.
    const score = scoreOf(kind, top, ex.unit)!.value;
    out.push({
      workoutId: w.id, date: w.data.date, top, score, unit: ex.unit,
      e1rm: kind === "weight_reps" ? e1rm(toLb(top.w ?? 0, ex.unit), top.r ?? 0) : null,
    });
  }
  return out;
}

/** The chart's own value for a session: e1RM when the kind has one,
 *  otherwise the same score everything else in the gym already ranks by. */
export function chartValue(s: LiftSession): number {
  return s.e1rm ?? s.score;
}

/** "Est 1RM" only where an estimate is actually being made; every other kind
 *  is charting a real logged number, so it is named plainly. */
export function chartLabel(kind: MeasureKind): string {
  return kind === "weight_reps" ? "Est 1RM" : "Best";
}

/**
 * Indexes into a chronological session list that were a new best at the
 * time -- a running PR line, aware of which direction wins (a faster time
 * chart's PRs are its new LOWS, not its highs).
 */
export function prIndexes(sessions: LiftSession[], kind: MeasureKind): number[] {
  const out: number[] = [];
  let best: LiftSession | null = null;
  sessions.forEach((s, i) => {
    // GYM-F-06: units named on both sides, or a kg session reads as a collapse.
    if (!best || beats(kind, s.top, best.top, { of: s.unit, than: best.unit })) { out.push(i); best = s; }
  });
  return out;
}

/**
 * Whole calendar days between a workout's own date and `now`, midnight-
 * anchored on BOTH sides (not `now` itself against the date's noon) so the
 * result is never a stray -1 from same-day time-of-day noise: a workout
 * logged this morning has to read as "0 days ago" all day, not just after
 * whatever hour its own noon-anchor happened to land on. A bug in this
 * exact shape (comparing raw `now` against a date's T12:00:00) silently
 * dropped TODAY's own session from every weekly bucket and D13-C range row
 * whenever it was checked before noon -- caught live, by actually loading
 * the app before noon, not by any test (every existing test's `now` is
 * itself pinned to noon, which hides the bug completely).
 */
export function daysAgo(dateISO: string, now: number): number {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const day = new Date(dateISO + "T00:00:00");
  return Math.round((today.getTime() - day.getTime()) / 86400000);
}

/**
 * Working sets per week for this exercise, oldest to newest, `weeks` wide.
 * Rolling from `now` (not calendar-aligned) -- the sealed preview's own
 * bucketing, and simplest to reason about for a chart with no fixed start.
 * Warmup and skipped chips never count: they are not the work being
 * measured (LAW 16).
 */
export function weeklySetCounts(workouts: Workout[], lift: LiftLike, weeks = 8, now: number = Date.now()): number[] {
  const out = new Array(weeks).fill(0) as number[];
  for (const w of workouts) {
    const ex = w.data.exercises.find((e) => sameLiftAnyKind(lift, e));
    if (!ex || ex.skipped) continue;
    const days = daysAgo(w.data.date, now);
    const bucket = Math.floor(days / 7);
    if (bucket < 0 || bucket >= weeks) continue;
    const working = ex.sets.filter((s) => !s.skipped && !s.warmup && scoreOf(ex.kind, s, ex.unit)).length;
    out[weeks - 1 - bucket]! += working;
  }
  return out;
}

/** Same bucketing, in the exercise's own volume unit -- null when the kind
 *  carries no volume at all (a sprint has no "weight moved" bar to draw). */
export function weeklyVolume(workouts: Workout[], lift: LiftLike, kind: MeasureKind, weeks = 8, now: number = Date.now()): number[] | null {
  if (!hasVolume(kind)) return null;
  const ref = liftRef(lift, kind);
  const out = new Array(weeks).fill(0) as number[];
  for (const w of workouts) {
    const ex = w.data.exercises.find((e) => sameLift(ref, e));
    if (!ex || ex.skipped) continue;
    const days = daysAgo(w.data.date, now);
    const bucket = Math.floor(days / 7);
    if (bucket < 0 || bucket >= weeks) continue;
    let v = 0;
    // GYM-F-06: summed in pounds, then shown in the unit the caller asked in,
    // so a bar chart cannot silently add lb and kg together.
    for (const s of ex.sets) { if (!s.skipped) v += setVolume(kind, s, ex.unit); }
    out[weeks - 1 - bucket]! += ref.unit === "kg" ? v / LB_PER_KG : v;
  }
  return out.map((v) => Math.round(v));
}

/** Every distinct exercise name+kind ever logged, most recently trained
 *  first -- the door list for "which lift has a chart". Muscle group is a
 *  PROGRAM fact (set on the plan's own Exercise), not a workout one, so it
 *  is not part of this: a caller with the current program joins it by name. */
export function chartableExercises(workouts: Workout[]): { name: string; exerciseKey?: string; kind: MeasureKind; unit?: string; timeUnit?: string }[] {
  // GYM-F-04 (2026-09-05): one entry per LIFT, not per name, so a renamed lift
  // is one chartable series wearing its newest name rather than two.
  const seen: { name: string; exerciseKey?: string; kind: MeasureKind; unit?: string; timeUnit?: string; date: string }[] = [];
  for (const w of workouts) {
    for (const ex of w.data.exercises) {
      if (ex.skipped || !ex.sets.some((s) => !s.skipped && scoreOf(ex.kind, s, ex.unit))) continue;
      const prior = seen.find((x) => sameLift(x, ex));
      if (!prior) {
        seen.push({ name: ex.name, ...(ex.exerciseKey ? { exerciseKey: ex.exerciseKey } : {}), kind: ex.kind, unit: ex.unit, timeUnit: ex.timeUnit, date: w.data.date });
      } else if (w.data.date > prior.date) {
        prior.name = ex.name; prior.unit = ex.unit; prior.timeUnit = ex.timeUnit; prior.date = w.data.date;
        if (ex.exerciseKey) prior.exerciseKey = ex.exerciseKey;
      } else if (ex.exerciseKey && !prior.exerciseKey) {
        prior.exerciseKey = ex.exerciseKey;
      }
    }
  }
  return [...seen].sort((a, b) => b.date.localeCompare(a.date)).map(({ name, exerciseKey, kind, unit, timeUnit }) => ({ name, exerciseKey, kind, unit, timeUnit }));
}
