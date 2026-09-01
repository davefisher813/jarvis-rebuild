import type { Workout, SetLog, MeasureKind } from "./types";
import { beats, scoreOf, hasVolume, setVolume } from "./measures";

// LIFT TREND CHARTS, D9-A (Training Catalog V2, approved 2026-08-31).
// "Boostcamp's most loved analytics are e1RM curves and PR tracking. Our
// History is text." One canonical per-session series -- the same shape
// history.ts's exerciseHistory already builds, but carrying the NUMBER, not
// just its formatted text, because a chart needs to plot it and D11/D12/D13
// all need to compare it. Everything downstream (the chart itself, the
// metric-correlation panels, plateau detection, goal-crossing) reads this
// one series so there is exactly one definition of "what a session did".

export interface LiftSession {
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
}

/** Epley: the formula the D9 research settled on. Rounded, because a
 *  fractional pound estimate reads as false precision. */
export function e1rm(w: number, r: number): number {
  return Math.round(w * (1 + r / 30));
}

/** One row per workout that actually logged a scoring set for this exercise,
 *  oldest first -- the chart's x-axis is chronological. */
export function liftSessions(workouts: Workout[], name: string, kind: MeasureKind): LiftSession[] {
  const sorted = [...workouts].sort((a, b) => a.data.date.localeCompare(b.data.date));
  const out: LiftSession[] = [];
  for (const w of sorted) {
    const ex = w.data.exercises.find((e) => e.name === name && e.kind === kind);
    if (!ex || ex.skipped) continue;
    let top: SetLog | null = null;
    for (const s of ex.sets) {
      if (s.skipped || !scoreOf(kind, s)) continue;
      if (!top || beats(kind, s, top)) top = s;
    }
    if (!top) continue;
    const score = scoreOf(kind, top)!.value;
    out.push({ date: w.data.date, top, score, e1rm: kind === "weight_reps" ? e1rm(top.w ?? 0, top.r ?? 0) : null });
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
  let best: SetLog | null = null;
  sessions.forEach((s, i) => {
    if (!best || beats(kind, s.top, best)) { out.push(i); best = s.top; }
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
export function weeklySetCounts(workouts: Workout[], name: string, weeks = 8, now: number = Date.now()): number[] {
  const out = new Array(weeks).fill(0) as number[];
  for (const w of workouts) {
    const ex = w.data.exercises.find((e) => e.name === name);
    if (!ex || ex.skipped) continue;
    const days = daysAgo(w.data.date, now);
    const bucket = Math.floor(days / 7);
    if (bucket < 0 || bucket >= weeks) continue;
    const working = ex.sets.filter((s) => !s.skipped && !s.warmup && scoreOf(ex.kind, s)).length;
    out[weeks - 1 - bucket]! += working;
  }
  return out;
}

/** Same bucketing, in the exercise's own volume unit -- null when the kind
 *  carries no volume at all (a sprint has no "weight moved" bar to draw). */
export function weeklyVolume(workouts: Workout[], name: string, kind: MeasureKind, weeks = 8, now: number = Date.now()): number[] | null {
  if (!hasVolume(kind)) return null;
  const out = new Array(weeks).fill(0) as number[];
  for (const w of workouts) {
    const ex = w.data.exercises.find((e) => e.name === name && e.kind === kind);
    if (!ex || ex.skipped) continue;
    const days = daysAgo(w.data.date, now);
    const bucket = Math.floor(days / 7);
    if (bucket < 0 || bucket >= weeks) continue;
    let v = 0;
    for (const s of ex.sets) { if (!s.skipped) v += setVolume(kind, s); }
    out[weeks - 1 - bucket]! += v;
  }
  return out;
}

/** Every distinct exercise name+kind ever logged, most recently trained
 *  first -- the door list for "which lift has a chart". Muscle group is a
 *  PROGRAM fact (set on the plan's own Exercise), not a workout one, so it
 *  is not part of this: a caller with the current program joins it by name. */
export function chartableExercises(workouts: Workout[]): { name: string; kind: MeasureKind; unit?: string; timeUnit?: string }[] {
  const seen = new Map<string, { name: string; kind: MeasureKind; unit?: string; timeUnit?: string; date: string }>();
  for (const w of workouts) {
    for (const ex of w.data.exercises) {
      if (ex.skipped || !ex.sets.some((s) => !s.skipped && scoreOf(ex.kind, s))) continue;
      const key = ex.name + "\u0000" + ex.kind;
      const prior = seen.get(key);
      if (!prior || w.data.date > prior.date) seen.set(key, { name: ex.name, kind: ex.kind, unit: ex.unit, timeUnit: ex.timeUnit, date: w.data.date });
    }
  }
  return [...seen.values()].sort((a, b) => b.date.localeCompare(a.date)).map(({ name, kind, unit, timeUnit }) => ({ name, kind, unit, timeUnit }));
}
