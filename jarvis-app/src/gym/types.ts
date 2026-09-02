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
  /** THE CONDITIONING BLOCK (ruled 2026-09-01, built 2026-09-02). Reps past
   *  the last full round on an AMRAP: "7 + 12". Only the rounds kind reads
   *  it. */
  extra?: number;
  /** Seconds the clock ran for this attempt, when the app's own clock ran
   *  it. Absent on anything typed in by hand. */
  elapsed?: number;
  /** ROUND SPLITS, captured free: the clock's elapsed seconds at each round
   *  boundary, in order (cumulative, so per-round time is the difference).
   *  The single most-praised feature of the timer apps this borrows from. */
  splits?: number[];
  done?: boolean; // filled with no numbers -- the "done, no numbers" mark
  skipped?: boolean;
  /** THE RAMP, D3 (Training Catalog V2, approved 2026-08-31). A warm-up set:
   *  real work the athlete did, but never a PR, never volume, and never part
   *  of what makes a strip "uniform" -- a ramp is by definition not uniform
   *  with its working sets. Sits here beside `skipped` because every
   *  derivation that takes a bare SetLog (scoreOf, setVolume) has to see it.
   *  Absent means an ordinary working set, so everything logged before this
   *  field existed reads correctly. */
  warmup?: boolean;
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
  /** HOW IT MOVED (catalog §4.5). Set once the set happened, never asked
   *  before it -- an observable event ("all clean", "last one was a grind",
   *  "missed one"), never an interoception/feelings scale. Feeds history as
   *  a fact, never a prescription. */
  moved?: "clean" | "grind" | "missed";
  /** LEARNED PACING, D7 (Training Catalog V2, approved 2026-08-31).
   *  Wall-clock ms when this entry was LOGGED in a live session -- stamped
   *  by liveSession's two write doors (logSet / setLoggedSets), never asked
   *  of the user, never rendered as a judgment. Plan chips never carry one;
   *  a duplicated chip is a new event and drops it; a backdated session's
   *  stamps say when it was typed in, so pacing derivations (Wave 3) must
   *  skip backdated workouts. Additive: absent on everything logged before
   *  this field existed, and a legacy chip is never back-stamped with a
   *  guess. */
  at?: number;
}

export interface Exercise {
  id: string;
  name: string; // the user's words, always
  kind: MeasureKind;
  unit?: string;
  timeUnit?: string; // distance_time only
  sets: SetEntry[]; // the strip: one planned entry per set
  note?: string; // reference, never coaching
  /** THE EXERCISE LIBRARY (catalog §3.5). A stable identity assigned once,
   *  never derived from the name, so a later rename can never fork history.
   *  Picking a name from the autocomplete carries the picked entry's own key
   *  forward; free text always mints a fresh one on save. Absent on
   *  exercises that predate the library -- those fall back to name+kind. */
  exerciseKey?: string;
  /** Optional per-exercise rest target in seconds (catalog §4.3). */
  restSec?: number;
  /** The id of another exercise in the SAME day this one alternates with --
   *  A1/A2 notation (catalog §4.2). Pairing is symmetric: both sides carry
   *  the other's id. */
  pairWith?: string;
  /** Offered during the rest of its paired parent lift instead of standing
   *  around (catalog §4.2): "Rest 2:00 -- or do your T-Spine Rotations." */
  filler?: boolean;
  /** THE RAMP, D3-A. On means the session offers warm-up sets built from
   *  this exercise's own first working weight (see ramp.ts). The generated
   *  sets are never stored in the program: the plan is the work, and a ramp
   *  is derived from it, so changing the working weight re-ramps for free. */
  ramp?: boolean;
  /** PUBLISHED RANGES, D13-C. Which muscle this lift trains, for the weekly
   *  hard-set row against the published growth range -- set by hand in the
   *  editor, same doctrine as gameCategoryId and the Training Door: the app
   *  never guesses a lift's muscle from its free-text name. Absent means the
   *  range row simply never claims this exercise. */
  muscleGroup?: import("./muscles").MuscleGroup;
  /** THE CONDITIONING BLOCK (Closing Round, ruled 2026-09-01: "Two states:
   *  timer while it runs, log after, round splits captured free"). Present
   *  on an exercise that is a clock, not a strip: the format and its cap.
   *  The kind still says what the score is (rounds for an AMRAP, time_faster
   *  for a For Time, done for an EMOM or Tabata that is simply completed). */
  cond?: CondBlock;
}

export type CondFormat = "amrap" | "emom" | "for_time" | "tabata";

export const COND_LABEL: Record<CondFormat, string> = {
  amrap: "AMRAP", emom: "EMOM", for_time: "For Time", tabata: "Tabata",
};
export const COND_FORMATS: CondFormat[] = ["amrap", "emom", "for_time", "tabata"];

export interface CondBlock {
  format: CondFormat;
  /** The clock's whole length in seconds: an AMRAP's window, a For Time's
   *  cap, an EMOM's rounds × interval, a Tabata's rounds × (work + rest). */
  capSec: number;
  /** EMOM: the interval (60 for a true minute). Tabata: the work length. */
  intervalSec?: number;
  /** Tabata only: the rest length. */
  restSec?: number;
  /** EMOM and Tabata: how many intervals. */
  rounds?: number;
}

/**
 * A DAY BLOCK, D3-C. What readies the body rather than one lift: "Bike, easy
 * 5 min", "Couch stretch". A checklist with its own minutes, skippable as
 * one unit, and its minutes count toward the session estimate D5 fits
 * against -- eight real minutes are eight minutes.
 */
export interface DayBlock {
  id: string;
  name: string;
  /** The user's own words for how much: "5 min", "2 x 15". Free text on
   *  purpose; a warm-up is not a measured lift. */
  amount?: string;
}

export interface ProgramDay {
  id: string;
  name: string; // free text: "Pull", "Speed Work", "Tuesday"
  exercises: Exercise[];
  /** PINS, D4 (Training Catalog V2, approved 2026-08-31). The weekdays this
   *  day is trained, Mon=0..Sun=6 (the gym module's own week convention,
   *  see summary.ts). Absent means unpinned: the program keeps its rotation
   *  and the calendar claims nothing. */
  pinDays?: number[];
  /** D3-C. Opening and closing blocks, each with its own budgeted minutes.
   *  Absent means the day has none, which is the state every existing day
   *  is in -- no migration. */
  warmUp?: DayBlock[];
  coolDown?: DayBlock[];
  warmUpMin?: number;
  coolDownMin?: number;
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
  /** THE SEASON LINK (catalog §4.7). Marked in-season or off-season, by the
   *  athlete or coach's own hand -- never inferred, and never a status the
   *  program is graded on. */
  inSeason?: boolean;
  /** Which of the athlete's OWN calendar categories means "a game" (catalog
   *  §4.7). Chosen by the athlete, never guessed: the calendar has no
   *  built-in idea of what a game is, so reading "a game in 14 hours" as a
   *  fact requires the athlete to say which category carries that meaning.
   *  Absent means the gym does not claim to know. */
  gameCategoryId?: string;
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
  exerciseKey?: string;
  /** Mid-session Swap or Add (catalog §3.9-3.10): this entry does not read
   *  its identity from the program day at this index -- name/kind/unit above
   *  are the real thing to show, and `plan` (not the day's own strip) is
   *  what unfilled ghost chips come from, if anything does. The program
   *  itself is never touched by either action. */
  custom?: boolean;
  plan?: SetEntry[];
}
export interface WorkoutData {
  programId: string;
  dayId: string;
  dayName: string;
  date: string; // local ISO day
  startedAt: number;
  endedAt: number;
  exercises: WorkoutExercise[];
  /** LOG IT LATER (catalog §3.8): a session entered for a day other than
   *  today. `date` above already carries the real day; this just marks that
   *  the live-session recovery sweep (which treats a stale `date` as an
   *  abandoned session from a prior day) must leave it alone while it is
   *  still open. */
  backdated?: boolean;
}
export interface Workout { id: string; data: WorkoutData }

export function newId(seed: string, n: number): string {
  return `${seed}${n}`;
}
