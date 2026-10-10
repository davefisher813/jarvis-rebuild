import type { Exercise, MeasureKind, Program, ProgramDay, SetEntry, Workout, WorkoutData, WorkoutExercise } from "./types";
import { fallbackKey } from "./library";
import { SCRATCH_DAY_ID, SCRATCH_DAY_NAME } from "./nextDay";
import { classOf, type ClassStore } from "./classify";
import { MUSCLE_GROUPS, type MuscleGroup } from "./muscles";
import { dayWithSessionEntry } from "./edit";
import { entryFrom } from "./strip";

// THE PROGRAM EMERGES FROM WHAT HE DOES (Dave 2026-10-09: "Most people don't
// have programs... connect the workout to a program OR save it as a new
// program. The program emerges from behavior"). Two jobs, both pure:
//
// 1. Turning a finished workout into a program day, or adding it to one, and
//    pointing the workout at that day so its history reads as the day's.
// 2. Noticing when the same workout keeps happening without a program, so the
//    app can OFFER to save it as one (mockup 10, opt-in: nothing is created or
//    attached without his tap).
//
// THE RULE, stated once so it can be checked: a workout started from scratch
// (no program day) suggests a program when, counting itself, at least
// PATTERN_MIN scratch workouts in the last PATTERN_DAYS days share at least
// SIMILAR_AT of their exercises with it. "Share" is measured on the exercises
// that were actually logged, by library identity (so a rename does not break
// it), as the overlap over the larger of the two lists. It stays quiet when a
// program day already holds that workout, when he said Not Now to it before,
// and when the workout has fewer than two exercises (one exercise is a habit,
// not a routine).
export const PATTERN_MIN = 3;
export const PATTERN_DAYS = 60;
export const SIMILAR_AT = 0.6;

type Identity = { exerciseKey?: string; name: string; kind: MeasureKind };

/** The library identity of an exercise: its key, or the name and kind it was logged under. */
function keyOf(e: Identity): string {
  return e.exerciseKey ?? fallbackKey(e.name, e.kind);
}

/** The exercises in a workout that have at least one set that happened. */
function loggedExercises(exercises: WorkoutExercise[]): WorkoutExercise[] {
  return exercises.filter((e) => !e.skipped && e.sets.some((s) => !s.skipped));
}

/** The set of exercise identities a workout actually did. */
export function workoutKeys(exercises: WorkoutExercise[]): string[] {
  return [...new Set(loggedExercises(exercises).map(keyOf))];
}

/** How much two workouts share: the overlap over the larger one, 0 to 1. */
export function similarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const bs = new Set(b);
  const shared = new Set(a.filter((k) => bs.has(k))).size;
  return shared / Math.max(new Set(a).size, bs.size);
}

/** A workout that belongs to no program day. */
export function isScratch(data: Pick<WorkoutData, "dayId" | "programId">): boolean {
  return data.dayId === SCRATCH_DAY_ID || !data.programId;
}

function daysApart(a: string, b: string): number {
  const ms = Math.abs(new Date(a + "T12:00:00").getTime() - new Date(b + "T12:00:00").getTime());
  return Math.round(ms / 86_400_000);
}

const PUSH: MuscleGroup[] = ["chest", "shoulders", "triceps"];
const PULL: MuscleGroup[] = ["back", "traps", "biceps", "forearms"];
const LEGS: MuscleGroup[] = ["quads", "hamstrings", "glutes", "calves"];

export interface ProgramSuggestion {
  /** The name a program made from it would carry: "Push Day", or his own word for it. */
  name: string;
  /** The sheet's title: "Looks Like a Push Day", or "Looks Like a Routine" when no muscle says what it is. */
  title: string;
  /** How many similar workouts, this one included. */
  count: number;
  /** The primary muscles he has classified on these exercises, in the app's own order. */
  muscles: MuscleGroup[];
  /** What a Not Now remembers: the exercise identities, so a near copy stays quiet too. */
  signature: string;
}

/** The name a pattern carries. Only from muscles he classified, never guessed
 *  from a free-text exercise name: all within push, pull or legs names the day;
 *  anything else is the name he gave these workouts most often, else My Routine. */
function nameFor(muscles: MuscleGroup[], dayNames: string[]): { name: string; title: string } {
  const within = (set: MuscleGroup[]) => muscles.length > 0 && muscles.every((m) => set.includes(m));
  if (within(PUSH)) return { name: "Push Day", title: "Looks Like a Push Day" };
  if (within(PULL)) return { name: "Pull Day", title: "Looks Like a Pull Day" };
  if (within(LEGS)) return { name: "Leg Day", title: "Looks Like a Leg Day" };
  const counts = new Map<string, number>();
  for (const n of dayNames) {
    const t = n.trim();
    if (!t || t === SCRATCH_DAY_NAME || t === "Open Session") continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  return { name: top ?? "My Routine", title: "Looks Like a Routine" };
}

/** Whether to offer a program for this just-finished workout, and what to call it. */
export function suggestProgram(
  current: WorkoutData,
  workouts: Workout[],
  opts: { store: ClassStore; programs: Program[]; declined?: string[] },
): ProgramSuggestion | null {
  if (!isScratch(current)) return null;
  const keys = workoutKeys(current.exercises);
  if (keys.length < 2) return null;
  if ((opts.declined ?? []).some((sig) => similarity(sig.split("|"), keys) >= SIMILAR_AT)) return null;
  const days = opts.programs.filter((p) => !p.data.archived).flatMap((p) => p.data.weeks.flatMap((w) => w.days));
  if (days.some((d) => similarity([...new Set(d.exercises.map(keyOf))], keys) >= SIMILAR_AT)) return null;
  const matches = workouts.filter((w) =>
    isScratch(w.data)
    && w.data.startedAt !== current.startedAt
    && daysApart(w.data.date, current.date) <= PATTERN_DAYS
    && similarity(workoutKeys(w.data.exercises), keys) >= SIMILAR_AT);
  const count = matches.length + 1;
  if (count < PATTERN_MIN) return null;
  const primaries = new Set<MuscleGroup>();
  for (const e of loggedExercises(current.exercises)) {
    for (const m of classOf(opts.store, { key: keyOf(e), exerciseKey: e.exerciseKey, name: e.name, kind: e.kind }).primary) primaries.add(m);
  }
  const muscles = MUSCLE_GROUPS.filter((m) => primaries.has(m));
  const { name, title } = nameFor(muscles, [current.dayName, ...matches.map((m) => m.data.dayName)]);
  return { name, title, count, muscles, signature: [...keys].sort().join("|") };
}

/** Working sets only, numbers only: what a plan is made of (the same rule as Same as Last Time). */
function planFrom(sets: SetEntry[]): SetEntry[] {
  return sets.filter((s) => !s.skipped && !s.warmup && !s.drop).map(entryFrom);
}

/** Add what this workout did to a program day: each exercise once, with the
 *  sets he logged as its plan and its equipment and reading with it. An
 *  exercise the day already holds (by identity, or by name and kind) is left
 *  as it is. */
export function appendWorkoutToDay(day: ProgramDay, data: WorkoutData, newId: (prefix: string) => string): ProgramDay {
  let next = day;
  for (const e of loggedExercises(data.exercises)) {
    next = dayWithSessionEntry(next, {
      // Never a program exercise's id: the match is by identity, below.
      exerciseId: "",
      name: e.name, kind: e.kind,
      ...(e.unit ? { unit: e.unit } : {}),
      ...(e.timeUnit ? { timeUnit: e.timeUnit } : {}),
      ...(e.exerciseKey ? { exerciseKey: e.exerciseKey } : {}),
      ...(e.equipment ? { equipment: e.equipment } : {}),
      ...(e.counted ? { counted: e.counted } : {}),
      ...(e.sided ? { sided: true } : {}),
      plan: planFrom(e.sets),
      ...(e.program ? { program: e.program } : {}),
    }, () => newId("e"));
  }
  return next;
}

/** A brand-new program day made from one workout. */
export function dayFromWorkout(data: WorkoutData, name: string, newId: (prefix: string) => string): ProgramDay {
  return appendWorkoutToDay({ id: newId("d"), name, exercises: [] }, data, newId);
}

const sameExercise = (a: Identity, b: Identity) =>
  (!!a.exerciseKey && a.exerciseKey === b.exerciseKey)
  || (a.name.trim().toLowerCase() === b.name.trim().toLowerCase() && a.kind === b.kind);

/** The workout, now belonging to that day: its program, its day and the day's
 *  name, and each exercise pointing at the day's own exercise, so Same as Last
 *  Time and the day's history read it like any other session of the day. */
export function workoutOnDay(data: WorkoutData, programId: string, day: ProgramDay): WorkoutData {
  return {
    ...data,
    programId,
    dayId: day.id,
    dayName: day.name,
    exercises: data.exercises.map((e) => {
      const match: Exercise | undefined = day.exercises.find((x) => sameExercise(x, e));
      return match ? { ...e, exerciseId: match.id } : e;
    }),
  };
}
