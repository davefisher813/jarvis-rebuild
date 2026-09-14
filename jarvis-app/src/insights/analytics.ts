import type { Workout, WorkoutData, WorkoutExercise } from "../gym/types";
import type { MetricDef, MetricLog } from "../gym/metrics";
import { scoreOf, loadStyleOf } from "../gym/measures";
import { daysBetween } from "../upnext/upnext";

// THE ONE SET OF DEFINITIONS (the approved Health design, 2026-09-14, item
// 10: "Use shared calculation logic across the landing page, Insights,
// details, and export"). Every number those surfaces show comes through
// here, and docs/ANALYTICS.md is the prose twin of this file. Pure: no
// Store, no clock but the one handed in.
//
// The rules, stated once:
//   A WORKING SET is a logged set that is not skipped, not a warm-up and not
//     a drop segment, and either scores (weight, reps, time, distance) or is
//     a done mark.
//   A COMPLETED WORKOUT is a saved session with at least one working set. A
//     saved session with none is kept as a record but counts as no workout.
//     A live or parked session is not a workout until it is finished.
//   DURATION has three readings. Elapsed is the wall clock, start to end.
//     Active is elapsed less the time the session sat parked, which is what
//     every "minutes" on a training surface means. Set span is the first
//     logged set's stamp to the last one's, when the sets carry stamps. A
//     session whose active time is far past its set span is flagged for
//     review, never capped or rewritten.
//   A NIGHT of sleep is the Sleep metric's log, dated the local day the
//     night ENDED (that is the date the Sleep screen asks for). Sleep that
//     crosses midnight therefore belongs to the morning it ended on.
//   DAILY BOUNDARIES are the device's local timezone, the same one every
//     local ISO day in the app is written in.
//   A PERIOD is inclusive of both its local ISO days.
//   NO RECORDS is null, never zero. A count of zero is a count of zero.

export type RangeKey = "7d" | "28d" | "90d" | "custom";
export interface Period { key: RangeKey; from: string; to: string; days: number }

function shiftDay(iso: string, by: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + by);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The window a range key means, ending today (inclusive). A custom pair is
 *  taken as given when it is a real pair, else it falls back to 7 days. */
export function periodFor(key: RangeKey, today: string, custom?: { from: string; to: string }): Period {
  if (key === "custom" && custom && /^\d{4}-\d{2}-\d{2}$/.test(custom.from) && /^\d{4}-\d{2}-\d{2}$/.test(custom.to) && custom.from <= custom.to) {
    return { key, from: custom.from, to: custom.to, days: daysBetween(custom.from, custom.to) + 1 };
  }
  const days = key === "28d" ? 28 : key === "90d" ? 90 : 7;
  return { key: key === "custom" ? "7d" : key, from: shiftDay(today, -(days - 1)), to: today, days };
}

export function inPeriod(date: string, p: Period): boolean {
  return date >= p.from && date <= p.to;
}

/** The period just before this one, the same length, for a comparison. */
export function previousPeriod(p: Period): Period {
  return { key: p.key, from: shiftDay(p.from, -p.days), to: shiftDay(p.from, -1), days: p.days };
}

export function isWorkingSet(ex: Pick<WorkoutExercise, "kind" | "unit">, s: WorkoutExercise["sets"][number]): boolean {
  if (s.skipped || s.warmup || s.drop) return false;
  if (s.done) return true;
  return scoreOf(ex.kind, s, ex.unit, loadStyleOf(ex as WorkoutExercise)) != null;
}

export function workingSetsIn(ex: WorkoutExercise): number {
  if (ex.skipped) return 0;
  return ex.sets.filter((s) => isWorkingSet(ex, s)).length;
}

export function workingSetsOf(w: Pick<WorkoutData, "exercises">): number {
  return w.exercises.reduce((n, ex) => n + workingSetsIn(ex), 0);
}

export function isCompletedWorkout(w: Pick<WorkoutData, "exercises">): boolean {
  return workingSetsOf(w) > 0;
}

/** Active minutes past which a session is worth a look, and how far past
 *  its own set span. Both are review thresholds, never caps. */
export const SUSPECT_ACTIVE_MIN = 240;
export const SUSPECT_PAST_SPAN_MIN = 120;

export interface Duration {
  elapsedMin: number;
  activeMin: number;
  pausedMin: number;
  /** First logged set stamp to the last, in minutes; null without stamps. */
  setSpanMin: number | null;
  firstSetAt: number | null;
  lastSetAt: number | null;
  flagged: boolean;
}

export function durationOf(w: Pick<WorkoutData, "startedAt" | "endedAt" | "pausedMs" | "exercises">): Duration {
  const elapsedMs = Math.max(0, w.endedAt - w.startedAt);
  const pausedMs = Math.max(0, w.pausedMs ?? 0);
  const activeMs = Math.max(0, elapsedMs - pausedMs);
  const stamps = w.exercises.flatMap((ex) => ex.sets.map((s) => s.at)).filter((t): t is number => typeof t === "number" && Number.isFinite(t));
  const firstSetAt = stamps.length ? Math.min(...stamps) : null;
  const lastSetAt = stamps.length ? Math.max(...stamps) : null;
  const setSpanMin = firstSetAt != null && lastSetAt != null ? Math.round((lastSetAt - firstSetAt) / 60000) : null;
  const activeMin = Math.max(1, Math.round(activeMs / 60000));
  const flagged = activeMin > SUSPECT_ACTIVE_MIN || (setSpanMin != null && activeMin > setSpanMin + SUSPECT_PAST_SPAN_MIN);
  return { elapsedMin: Math.round(elapsedMs / 60000), activeMin, pausedMin: Math.round(pausedMs / 60000), setSpanMin, firstSetAt, lastSetAt, flagged };
}

export interface DayActivity { date: string; workouts: number; workingSets: number; activeMin: number }

export interface SleepSummary {
  /** Mean hours over the logged nights, null with no night logged. */
  avgHours: number | null;
  nights: number;
  /** One entry per day of the period: hours, or null for a night not logged. */
  byDay: { date: string; hours: number | null }[];
}

export function sleepNights(def: MetricDef | null, logs: MetricLog[], p: Period): SleepSummary {
  const byDate = new Map<string, number>();
  if (def) for (const l of logs) if (l.data.metricId === def.id && l.data.value != null && inPeriod(l.data.date, p)) byDate.set(l.data.date, l.data.value);
  const byDay: { date: string; hours: number | null }[] = [];
  for (let i = 0; i < p.days; i++) { const d = shiftDay(p.from, i); byDay.push({ date: d, hours: byDate.get(d) ?? null }); }
  const vals = [...byDate.values()];
  return { avgHours: vals.length ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)) : null, nights: vals.length, byDay };
}

export interface PeriodOverview {
  period: Period;
  workouts: number;
  workingSets: number;
  /** Active minutes summed over completed workouts. */
  trainingMin: number;
  days: DayActivity[];
  sleep: SleepSummary;
  /** Sessions in the period whose duration is flagged for review. */
  flagged: Workout[];
}

export function periodOverview(workouts: Workout[], sleepDef: MetricDef | null, logs: MetricLog[], p: Period): PeriodOverview {
  const days: DayActivity[] = [];
  for (let i = 0; i < p.days; i++) days.push({ date: shiftDay(p.from, i), workouts: 0, workingSets: 0, activeMin: 0 });
  const byDate = new Map(days.map((d) => [d.date, d] as const));
  let count = 0, sets = 0, min = 0;
  const flagged: Workout[] = [];
  for (const w of workouts) {
    if (!inPeriod(w.data.date, p)) continue;
    const ws = workingSetsOf(w.data);
    if (ws === 0) continue;
    const dur = durationOf(w.data);
    count++; sets += ws; min += dur.activeMin;
    if (dur.flagged) flagged.push(w);
    const d = byDate.get(w.data.date);
    if (d) { d.workouts++; d.workingSets += ws; d.activeMin += dur.activeMin; }
  }
  return { period: p, workouts: count, workingSets: sets, trainingMin: min, days, sleep: sleepNights(sleepDef, logs, p), flagged };
}

/** "7h 24m" from hours; "45m" under an hour. */
export function hoursLabel(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Mon, Tue, ... for a local ISO day. */
export function weekdayShort(iso: string): string {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(iso + "T12:00:00").getDay()]!;
}

// ---- Muscle volume and a lift's table (Insights) ----

import type { MuscleGroup } from "../gym/muscles";
import { rolesFor, type MuscleMap } from "../gym/insights";
import { liftRef, sameLift } from "../gym/identity";
import { formatSet } from "../gym/measures";

export interface MuscleBreakdown {
  rows: { muscle: MuscleGroup; sets: number }[];
  /** Working sets of exercises that carry no muscle. Still in `total`. */
  unassigned: number;
  /** Working sets of exercises that carry at least one muscle. */
  assigned: number;
  /** Every working set in the period. */
  total: number;
  untagged: { name: string; exerciseKey?: string; sets: number }[];
}

/** Where the period's working sets went. Every set is in `total`; a set
 *  counts toward a muscle only once its exercise carries that muscle, the
 *  first muscle whole and the rest half (the app's convention, stated on
 *  the card). Unassigned sets are shown, never dropped. */
export function muscleBreakdown(workouts: Workout[], map: MuscleMap, p: Period): MuscleBreakdown {
  const totals = new Map<MuscleGroup, number>();
  const untagged = new Map<string, { name: string; exerciseKey?: string; sets: number }>();
  let total = 0, assigned = 0, unassigned = 0;
  for (const w of workouts) {
    if (!inPeriod(w.data.date, p)) continue;
    for (const ex of w.data.exercises) {
      const working = workingSetsIn(ex);
      if (working === 0) continue;
      total += working;
      // The classification's two lists (Cowork 2026-09-14), read through the
      // same scope window the Weekly Volume card uses: primaries whole,
      // secondaries half, and a secondary that is also a primary not twice.
      const roles = rolesFor(map, ex, w.data.date);
      if (roles.primary.length + roles.secondary.length === 0) {
        unassigned += working;
        const id = ex.exerciseKey ?? ex.name;
        const prev = untagged.get(id);
        untagged.set(id, { name: ex.name, ...(ex.exerciseKey ? { exerciseKey: ex.exerciseKey } : {}), sets: (prev?.sets ?? 0) + working });
        continue;
      }
      assigned += working;
      for (const m of roles.primary) totals.set(m, (totals.get(m) ?? 0) + working);
      for (const m of roles.secondary) {
        if (roles.primary.includes(m)) continue;
        totals.set(m, (totals.get(m) ?? 0) + working / 2);
      }
    }
  }
  const rows = [...totals.entries()].map(([muscle, sets]) => ({ muscle, sets })).sort((a, b) => b.sets - a.sets);
  return { rows, unassigned, assigned, total, untagged: [...untagged.values()].sort((a, b) => b.sets - a.sets) };
}

export interface LiftSessionRow { workoutId: string; date: string; working: number; sets: string[] }

/** Every session of one lift, newest first, with its logged sets spelled
 *  out: the accessible twin of any chart, and the list a chart point opens. */
export function liftTable(workouts: Workout[], lift: { name: string; exerciseKey?: string; kind: Workout["data"]["exercises"][number]["kind"] }): LiftSessionRow[] {
  const ref = liftRef(lift, lift.kind);
  const out: LiftSessionRow[] = [];
  for (const w of workouts) {
    const ex = w.data.exercises.find((e) => sameLift(ref, e));
    if (!ex || ex.skipped) continue;
    const logged = ex.sets.filter((s) => !s.skipped);
    if (logged.length === 0) continue;
    out.push({ workoutId: w.id, date: w.data.date, working: workingSetsIn(ex), sets: logged.map((s) => formatSet(ex, s) + (s.warmup ? " (warm-up)" : s.drop ? " (drop)" : "")) });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
