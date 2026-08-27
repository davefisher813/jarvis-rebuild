export const ENTITY_PROGRAM = "program";
export const ENTITY_WORKOUT = "workout";

// Gym track (2026-08-03). Dave: "If it's not an actual lift they should still
// be able to enter data as well. Example: 40 yard dash/time."
//
// So an exercise is a FREE-TEXT name plus a measure kind, and the kind carries
// its own direction (faster-is-better vs longer-is-better) rather than a
// separate toggle nobody would get right. Every name and day label is the
// user's words; the app never requires a lift.
//
// HEALTH LINE (from CATEGORY_KINDS): performance data is fair game, body data
// is not. The weight on the bar is a fact about the bar. No body weight, no
// calories, no body metrics anywhere in here.
export type MeasureKind =
  | "weight_reps"
  | "reps"
  | "rounds"
  | "time_faster"
  | "time_longer"
  | "distance"
  | "distance_time"
  | "height"
  | "done";

export const MEASURE_LABEL: Record<MeasureKind, string> = {
  weight_reps: "Weight × Reps",
  reps: "Reps",
  rounds: "Rounds",
  time_faster: "Time, faster is better",
  time_longer: "Time, longer is better",
  distance: "Distance",
  distance_time: "Distance + Time",
  height: "Height",
  done: "Done, no numbers",
};

export const MEASURE_KINDS: MeasureKind[] = [
  "weight_reps", "reps", "rounds", "time_faster", "time_longer",
  "distance", "distance_time", "height", "done",
];

// Units per kind. Ambiguous numbers make nonsense PRs (inches vs meters), so
// every measured kind carries one. kg exists from day one: most of the world
// does not lift in pounds.
export const WEIGHT_UNITS = ["lb", "kg"] as const;
export const TIME_UNITS = ["sec", "min"] as const;
export const DISTANCE_UNITS = ["yd", "m", "mi", "ft"] as const;
export const HEIGHT_UNITS = ["in", "cm"] as const;

export function unitsFor(kind: MeasureKind): readonly string[] {
  if (kind === "weight_reps") return WEIGHT_UNITS;
  if (kind === "time_faster" || kind === "time_longer") return TIME_UNITS;
  if (kind === "distance" || kind === "distance_time") return DISTANCE_UNITS;
  if (kind === "height") return HEIGHT_UNITS;
  return [];
}

export function defaultUnit(kind: MeasureKind): string | undefined {
  return unitsFor(kind)[0];
}

/** One logged set/attempt/round. Fields used depend on the kind (see measures.ts). */
export interface SetLog {
  w?: number; // weight
  r?: number; // reps or rounds
  v?: number; // magnitude: time, distance, or height
  t?: number; // paired time, distance_time only
  done?: boolean; // filled with no numbers -- the "done, no numbers" mark
  skipped?: boolean;
}

/**
 * THE SET STRIP (catalog §3.1). One entry per set, independently editable:
 * its own w/r/v/t, or skipped, or a "done" mark. This is the SAME shape in
 * the program (unfilled/target chips -- the plan) and in a live or finished
 * session (filled chips -- the record): a chip in `Exercise.sets` is a
 * target; the identically shaped chip in `WorkoutExercise.sets` is what
 * actually happened. Planning and logging are one data model, not two.
 */
export interface SetEntry extends SetLog {
  id: string;
}

export interface Exercise {
  id: string;
  name: string; // the user's words, always
  kind: MeasureKind;
  unit?: string;
  timeUnit?: string; // distance_time only
  sets: SetEntry[]; // the strip: one planned entry per set
  note?: string; // reference, never coaching
}

export interface ProgramDay {
  id: string;
  name: string; // free text: "Pull", "Speed Work", "Tuesday"
  exercises: Exercise[];
}

/**
 * THE TIME AXIS (catalog §4.1). A program is a block of weeks; each week
 * holds its own days, so week 3 can carry a different plan than week 1
 * without the athlete retyping anything. `backOff` marks a lighter week --
 * never called "deload" (reads as failure, L1) and never rendered in red.
 */
export interface ProgramWeek {
  id: string;
  label: string; // "Week 1", the user's words; free text so open-ended training reads naturally
  backOff?: boolean;
  days: ProgramDay[];
}

export interface ProgramData {
  name: string;
  weeks: ProgramWeek[];
  order?: number;
  archived?: boolean;
}
export interface Program { id: string; data: ProgramData }

/** A finished session. Set logs are CONTENT (item data), never event_log rows. */
export interface WorkoutExercise {
  exerciseId: string;
  name: string;
  kind: MeasureKind;
  unit?: string;
  timeUnit?: string;
  sets: SetEntry[]; // the logged strip: unfilled chips never appear here, only what happened
  skipped?: boolean;
}
export interface WorkoutData {
  programId: string;
  dayId: string;
  dayName: string;
  date: string; // local ISO day
  startedAt: number;
  endedAt: number;
  exercises: WorkoutExercise[];
}
export interface Workout { id: string; data: WorkoutData }

export function newId(seed: string, n: number): string {
  return `${seed}${n}`;
}
