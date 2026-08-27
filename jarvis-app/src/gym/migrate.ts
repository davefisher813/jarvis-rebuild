import type { Exercise, MeasureKind, ProgramData, ProgramDay, ProgramWeek, SetEntry, WorkoutData, WorkoutExercise } from "./types";
import { uniformStrip, newSetId } from "./strip";

// MIGRATION (catalog §4.1, §3.1, open question 6). Existing users have
// programs in the old shape: `{ name, days: [{ exercises: [{ sets: number,
// target }] }] }`. The set strip is the actual storage now, so an old
// exercise's `sets + target` becomes the convenience INPUT that expands into
// a uniform strip -- it does not survive as a second persisted shape. A
// program with no time axis becomes ONE week, everything it already had,
// unchanged, just given the axis it was missing.
//
// Read-only: this runs on load and hands callers the new shape. Nothing is
// rewritten in storage until the program is next saved, which happens
// naturally through the normal edit paths (all of which now write the new
// shape). Old workouts are migrated the same way, on the way out of
// GymService.listWorkouts.

interface OldTarget { w?: unknown; r?: unknown; v?: unknown; t?: unknown }
interface OldExercise {
  id: string; name: string; kind: string; unit?: string; timeUnit?: string;
  sets?: unknown; target?: OldTarget; note?: string;
}
interface OldDay { id: string; name: string; exercises?: OldExercise[] }
interface OldProgramData {
  name: string; days?: OldDay[]; weeks?: unknown; order?: number; archived?: boolean;
}

function num(x: unknown): number | undefined {
  return typeof x === "number" && Number.isFinite(x) ? x : undefined;
}

function migrateExercise(e: OldExercise): Exercise {
  const count = typeof e.sets === "number" && e.sets > 0 ? e.sets : 1;
  const target = { w: num(e.target?.w), r: num(e.target?.r), v: num(e.target?.v), t: num(e.target?.t) };
  const sets = e.kind === "done"
    ? uniformStrip(count, {})
    : uniformStrip(count, target);
  return {
    id: e.id,
    name: e.name,
    kind: e.kind as MeasureKind,
    ...(e.unit ? { unit: e.unit } : {}),
    ...(e.timeUnit ? { timeUnit: e.timeUnit } : {}),
    sets,
    ...(e.note ? { note: e.note } : {}),
  };
}

function isNewShapeExercise(e: unknown): e is Exercise {
  const ex = e as { sets?: unknown };
  return Array.isArray(ex.sets);
}

function migrateDay(d: OldDay): ProgramDay {
  const exercises = (d.exercises ?? []).map((e) => (isNewShapeExercise(e) ? e : migrateExercise(e)));
  return { id: d.id, name: d.name, exercises };
}

/** Old shape -> new shape. Already-migrated data (carries `weeks`) passes
 *  through untouched, so this is safe to call on every read. */
export function migrateProgramData(raw: unknown): ProgramData {
  const p = raw as OldProgramData;
  if (Array.isArray(p.weeks)) return p as unknown as ProgramData;
  const days: ProgramDay[] = (p.days ?? []).map(migrateDay);
  const week: ProgramWeek = { id: "w1", label: "Week 1", days };
  return {
    name: p.name,
    weeks: [week],
    ...(p.order !== undefined ? { order: p.order } : {}),
    ...(p.archived !== undefined ? { archived: p.archived } : {}),
  };
}

interface OldSetLog { w?: unknown; r?: unknown; v?: unknown; t?: unknown; skipped?: unknown; done?: unknown }
interface OldWorkoutExercise {
  exerciseId: string; name: string; kind: string; unit?: string; timeUnit?: string;
  sets?: OldSetLog[]; skipped?: boolean;
}
interface OldWorkoutData {
  programId: string; dayId: string; dayName: string; date: string;
  startedAt: number; endedAt: number; exercises?: OldWorkoutExercise[];
}

function migrateSetLog(s: OldSetLog): SetEntry {
  return {
    id: newSetId(),
    ...(num(s.w) !== undefined ? { w: num(s.w) } : {}),
    ...(num(s.r) !== undefined ? { r: num(s.r) } : {}),
    ...(num(s.v) !== undefined ? { v: num(s.v) } : {}),
    ...(num(s.t) !== undefined ? { t: num(s.t) } : {}),
    ...(s.done ? { done: true } : {}),
    ...(s.skipped ? { skipped: true } : {}),
  };
}

function migrateWorkoutExercise(e: OldWorkoutExercise): WorkoutExercise {
  const sets = (e.sets ?? []).map((s) => (typeof (s as SetEntry).id === "string" ? (s as SetEntry) : migrateSetLog(s)));
  return {
    exerciseId: e.exerciseId,
    name: e.name,
    kind: e.kind as MeasureKind,
    ...(e.unit ? { unit: e.unit } : {}),
    ...(e.timeUnit ? { timeUnit: e.timeUnit } : {}),
    sets,
    ...(e.skipped ? { skipped: true } : {}),
  };
}

export function migrateWorkoutData(raw: unknown): WorkoutData {
  const w = raw as OldWorkoutData;
  return {
    programId: w.programId,
    dayId: w.dayId,
    dayName: w.dayName,
    date: w.date,
    startedAt: w.startedAt,
    endedAt: w.endedAt,
    exercises: (w.exercises ?? []).map(migrateWorkoutExercise),
  };
}
