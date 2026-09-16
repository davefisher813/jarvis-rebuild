import type { Source } from "../shared/provenance";

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
  /** A DROP SEGMENT (Part 3 wave 2, 2026-09-13; handoff acceptance 9: "drop
   *  segments remain attached to their parent"). Logged straight after a
   *  working set, at whatever weight the athlete then lifted. The counting
   *  method, stated once: a drop counts in tonnage moved and nowhere else.
   *  It is never a working set, never a PR, never progression evidence, and
   *  never a turn in a group. Its parent is the nearest working set before
   *  it in the strip. */
  drop?: boolean;
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

// EQUIPMENT lives in its own file now (gym/equipment.ts, 2026-09-14), because
// what began as one menu turned out to be two questions -- what you lift, and
// what the number means -- with a stepper increment, a row label, a direction
// of progress, a tonnage factor and a comparability rule hanging off the
// answer. Re-exported here so every existing import keeps working.
export type { Equipment, Counted, LoadStyle } from "./equipment";
export { EQUIPMENT_LABEL, EQUIPMENT_KINDS, COUNTED_LABEL, loadStyleOf } from "./equipment";
import { loadStyleOf, type Counted, type Equipment } from "./equipment";

/** The equipment an exercise (or a logged one) says. Kept as the old name so
 *  callers that only want the thing, not the whole convention, still read the
 *  same way; it now runs through loadStyleOf, so the retired "unilateral" and
 *  "timed" values and the pre-menu `load: "each"` all still land correctly.
 *  Undefined means the athlete never said. */
export function equipmentOf(ex: { equipment?: string; load?: "each" | "total" }): Equipment | undefined {
  return loadStyleOf(ex).equipment;
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
  /** REST AFTER THE ROUND (Part 3 wave 2, 2026-09-13). For a grouped
   *  exercise: the rest that starts once every member has taken its turn,
   *  instead of after every set. Read off any member (the largest wins). With
   *  none set on the group, the session rests after every set the way it
   *  always has. */
  roundRestSec?: number;
  /** Health Push E (H-26): how a weight_reps load is written. "each" means
   *  the number on every chip is one dumbbell's; absent or "total" means the
   *  whole load. A label for the person's own numbers, never a conversion:
   *  nothing doubles or halves a weight on the strength of this flag.
   *  Part 3 wave 5 (2026-09-13): superseded by `equipment` below; still
   *  read, so a lift marked Each before this keeps its meaning. */
  load?: "each" | "total";
  /** EQUIPMENT (Part 3 wave 5, Dave's 6 and O7a: all the conventions, one
   *  chooser, as simple as it can be). How the number on a chip is to be
   *  read: a barbell's total, one dumbbell's, one side's, a stack pin, and
   *  so on. Recorded on every set logged from then on (WorkoutExercise
   *  carries it), so history keeps each lift's own convention. A label,
   *  never a conversion, and unilateral logs one number per side the way a
   *  dumbbell does, never two fields. Absent means the whole load.
   *
   *  2026-09-14: narrowed to real equipment. The two members that were never
   *  equipment moved to `counted` below; gym/equipment.ts reads the old
   *  values, so nothing already written changes meaning. */
  equipment?: Equipment;
  /** WHAT THE NUMBER MEANS (2026-09-14), split out of `equipment` above: the
   *  whole load, each side, each hand, added to bodyweight, or assistance
   *  taken off. Absent means the equipment's own default reading. Drives the
   *  Weight row's label, the stepper's increment, tonnage, and -- for
   *  assistance -- which direction counts as stronger. */
  counted?: Counted;
  /** WORKED ONE SIDE AT A TIME (2026-09-16, Dave: "if it's a bilateral
   *  exercise versus unilateral, that should change things. So if it's
   *  unilateral, it should be amount of reps on each side").
   *
   *  `counted` above says what the WEIGHT means and has since it shipped.
   *  This is the other half, and it is about the REPS: on a Bulgarian split
   *  squat, 8 is 8 per leg and the set is 16. The two axes are genuinely
   *  independent -- a dumbbell bench press is each_hand weight with both arms
   *  pressing together, and a single-arm cable row is a whole-stack number
   *  done one side at a time -- which is why this is not a third value of
   *  `counted`.
   *
   *  A LABEL, never a conversion, exactly like every other convention in
   *  equipment.ts: nothing doubles the reps the athlete typed. What it
   *  changes is what the field is CALLED, what the chip reads, and what
   *  tonnage counts.
   *
   *  Absent means both sides at once, which is what every lift logged before
   *  this meant. */
  sided?: boolean;
  /** The id of another exercise in the SAME day this one alternates with --
   *  A1/A2 notation (catalog §4.2). Pairing is symmetric: both sides carry
   *  the other's id. */
  pairWith?: string;
  /** UP-ATH-17 (2026-09-06): the group this exercise belongs to, when it is
   *  in one. Every coach's sheet has a tri-set or a circuit on it and
   *  `pairWith` above is exactly two by design, so A3 had no way to exist.
   *  A group is however many exercises share one id, order comes from the
   *  day's own list, and a PAIR IS A GROUP OF TWO: gym/groups.ts reads a
   *  symmetric pairWith as one, so nothing written before this migrates and
   *  every existing program keeps its labels and its flow untouched. */
  groupId?: string;
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
  /** Part 3 wave 5: the convention the numbers were logged under, kept
   *  with the record so a later change on the program never rewrites what
   *  an old set meant. */
  equipment?: Equipment;
  /** The reading those numbers were logged under (2026-09-14). Stored
   *  beside the equipment for the same reason: switching a lift from a
   *  stack to a plate machine must not retroactively redefine what last
   *  month's chips meant, and comparability is checked against this. */
  counted?: Counted;
  /** Whether the reps on these sets were per side (2026-09-16). Kept with the
   *  record for the same reason equipment and counted are: a later change on
   *  the program must not redefine what an old chip's 8 meant. */
  sided?: boolean;
  /** Mid-session Swap or Add (catalog §3.9-3.10): this entry does not read
   *  its identity from the program day at this index -- name/kind/unit above
   *  are the real thing to show, and `plan` (not the day's own strip) is
   *  what unfilled ghost chips come from, if anything does. The program
   *  itself is never touched by either action. */
  custom?: boolean;
  plan?: SetEntry[];
  /** GYM-F-21 (2026-09-05): the program-side shape of an exercise ADDED
   *  mid-session (catalog §3.10). It has no program exercise to read from, so
   *  without this its clock, rest target, ramp, note and muscle were thrown
   *  away the moment it was created: an AMRAP added in session came back with
   *  a "Log Round" button and a set strip instead of "Start the Clock", and a
   *  2:00 rest on an added lift never showed a timer. Only ever set on a
   *  custom entry; a planned exercise reads all of this off the day itself. */
  program?: AddedExerciseFields;
}

/** What an added exercise has to carry with it: everything the session screen
 *  reads off a program exercise that is not identity or the strip. */
export type AddedExerciseFields = Pick<Exercise, "cond" | "restSec" | "ramp" | "muscleGroup" | "note">;
/** A correction to a saved session's recorded times (the approved Health
 *  design, 2026-09-14, item 9). The value it replaced is kept, so the
 *  original survives every correction. */
export interface WorkoutRevision { at: number; field: "endedAt" | "startedAt"; from: number; to: number }

export interface WorkoutData {
  programId: string;
  dayId: string;
  dayName: string;
  date: string; // local ISO day
  startedAt: number;
  endedAt: number;
  exercises: WorkoutExercise[];
  /** H-30 (Health Push B, 2026-09-12): the athlete's own line on the finish
   *  receipt. Reference, never coaching, like an exercise note. */
  note?: string;
  /** H-52: time the session sat parked, so elapsed and the receipt's minutes
   *  count only the time actually in the gym. Absent means none. */
  pausedMs?: number;
  /** H-51 (Health Push F): stamped when the session is queued, so a replayed
   *  save lands as the same row. See shared/clientId.ts. */
  clientId?: string;
  /** LOG IT LATER (catalog §3.8): a session entered for a day other than
   *  today. `date` above already carries the real day; this just marks that
   *  the live-session recovery sweep (which treats a stale `date` as an
   *  abandoned session from a prior day) must leave it alone while it is
   *  still open. */
  backdated?: boolean;
  /** UP-ATH-31 (2026-09-06): where this session came from, when it did not
   *  come from the person in front of the phone. Absent on every hand-logged
   *  workout, which is what makes the provenance line honest: it appears
   *  only on records JARVIS created for someone. Inside the entity's JSONB
   *  data, so no migration (the same precedent shared/provenance.ts names). */
  source?: Source;
  /** 2026-09-14: every correction made to startedAt or endedAt, oldest
   *  first. Absent means the stamps are as the session recorded them. */
  revisions?: WorkoutRevision[];
}
export interface Workout { id: string; data: WorkoutData }

// GYM-F-28 (2026-09-05): newId had no caller. Every gym id is minted where
// it is created (GymFlow, library.newExerciseKey), never from a seed here.
