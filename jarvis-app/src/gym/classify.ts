// WHAT AN EXERCISE IS, SAID ONCE, IN ONE PLACE.
//
// (Dave, 2026-09-14, the Exercise Library handoff: "Make the exercise library
// the central place to organize exercises, edit classifications, resolve
// duplicates, and access history.")
//
// Before this file, what the app knew about an exercise was scattered across
// three incompatible homes and one of them was per-program-day:
//
//   - `Exercise.muscleGroup` -- ONE muscle, living inside a single day of a
//     single program, gone the moment the lift was renamed or logged
//     mid-session;
//   - `GymSettings.muscleByKey` -- a flat list where position carried the
//     meaning (first = primary), which cannot express two primaries and
//     cannot be read without knowing the trick;
//   - `equipment` / `counted` on each sighting, which is right for a RECORD
//     (that set really was logged on that machine) and wrong as the answer to
//     "what is this exercise", because it is re-answered every session.
//
// Here it is one object hanging off the LIBRARY KEY, which is the identity
// that survives a rename and a merge. Every axis the handoff asked for lives
// on it, every axis is optional, and nothing here is ever inferred from the
// exercise's name -- the never-guess doctrine (LAW 18) covers muscle and now
// covers all nine axes: the athlete says, or the app says nothing.
//
// TWO RULES THIS FILE EXISTS TO KEEP:
//
//   1. A CLASSIFICATION IS NOT A REWRITE. "Changing classifications must not
//      silently change historical weights, units, or measurement meaning."
//      Nothing in here touches a logged set. A record keeps the convention it
//      was recorded under; this object is what the exercise is NOW, and what
//      the next sighting of it will carry.
//   2. NOTHING IS REQUIRED. "Do not require every field before logging a
//      workout." Every field is optional, an empty classification is a legal
//      one, and the only thing the app does about a missing muscle is offer
//      to take it -- never block, never nag twice.

import { MUSCLE_GROUPS, MUSCLE_LABEL, type MuscleGroup } from "./muscles";
import {
  EQUIPMENT_KINDS, EQUIPMENT_LABEL, COUNTED_LABEL, countsFor, defaultCount,
  type Counted, type Equipment, type LoadStyle,
} from "./equipment";
import { MEASURE_KINDS, MEASURE_LABEL, type MeasureKind } from "./types";

// --- THE AXES --------------------------------------------------------------

export const MOVEMENTS = [
  "squat", "hinge", "lunge", "push_h", "pull_h", "push_v", "pull_v", "carry", "rotation", "other",
] as const;
export type MovementPattern = (typeof MOVEMENTS)[number];

export const MOVEMENT_LABEL: Record<MovementPattern, string> = {
  squat: "Squat",
  hinge: "Hinge",
  lunge: "Lunge",
  push_h: "Horizontal Push",
  pull_h: "Horizontal Pull",
  push_v: "Vertical Push",
  pull_v: "Vertical Pull",
  carry: "Carry",
  rotation: "Rotation",
  other: "Other",
};

export const EXERCISE_TYPES = ["strength", "cardio", "mobility", "balance", "other"] as const;
export type ExerciseType = (typeof EXERCISE_TYPES)[number];

export const TYPE_LABEL: Record<ExerciseType, string> = {
  strength: "Strength",
  cardio: "Cardio",
  mobility: "Mobility",
  balance: "Balance",
  other: "Other",
};

// THE ANSWERS THE APP ALREADY KNEW (2026-09-16, Dave on the classify sheet:
// "there should be button selections or dropdowns for most of this").
//
// Grip, Stance, Angle and Variation were free-text rows whose PLACEHOLDERS
// listed the common answers -- Neutral, Wide, Hook; Sumo, Staggered. The app
// knew what people type and printed it as a hint instead of offering it, so
// every one of them cost a keyboard, a right-aligned caret and a spelling
// nobody else would match. These are the same words as buttons.
//
// Still free text underneath: the field is a string, anything already typed
// survives, and a value that is not on a list shows as its own chip so it can
// be read and cleared. A closed menu would have thrown away what people
// already wrote, which is the one thing a polish pass may not do.
export const GRIPS = ["Neutral", "Overhand", "Underhand", "Wide", "Close", "Mixed", "Hook"] as const;
export const STANCES = ["Conventional", "Sumo", "Staggered", "Narrow", "Wide", "Split"] as const;
export const ANGLES = ["Flat", "Incline", "Decline", "Low Pulley", "High Pulley", "Seated", "Standing"] as const;
export const VARIATIONS = ["Paused", "Tempo", "Deficit", "Partial", "Cluster", "Drop Set", "Explosive"] as const;

export const EXECUTIONS = ["bilateral", "unilateral", "alternating"] as const;
export type Execution = (typeof EXECUTIONS)[number];

export const EXECUTION_LABEL: Record<Execution, string> = {
  bilateral: "Bilateral",
  unilateral: "Unilateral",
  alternating: "Alternating",
};

/** WHO A MUSCLE ASSIGNMENT SPEAKS FOR (handoff §4: "Show whether an
 *  assignment applies to existing records, future records, or both").
 *
 *  A correction is not always retroactive. Tagging Bench as chest is a
 *  statement about every bench press ever done; switching a lift from Back to
 *  Shoulders because you changed how you do it is a statement about the ones
 *  from here on. The app cannot tell those apart, so it asks, and it shows
 *  the answer afterwards rather than burying it. */
export type MuscleScope = "all" | "future" | "existing";

export const SCOPE_LABEL: Record<MuscleScope, string> = {
  all: "Existing and Future",
  future: "Future Records",
  existing: "Existing Records",
};

// --- THE OBJECT ------------------------------------------------------------

export interface Classification {
  /** PRIMARY MOVERS. A list, not one: a deadlift is not a hamstring exercise
   *  with three footnotes. Each primary counts a whole working set. */
  primary: MuscleGroup[];
  /** WHAT ELSE IT WORKS. Counted at half a set, which is this app's own
   *  convention and is labelled as one everywhere it is shown. */
  secondary: MuscleGroup[];
  equipment?: Equipment;
  /** What the number on the chip means. See equipment.ts -- a LABEL, never a
   *  conversion. */
  counted?: Counted;
  movement?: MovementPattern;
  type?: ExerciseType;
  execution?: Execution;
  /** The free-text half of Execution. Optional by the handoff's own wording
   *  ("Optional grip, stance, angle, and variation") and free text on purpose:
   *  a fixed menu of grips would be wrong for half the world's gyms. */
  grip?: string;
  stance?: string;
  angle?: string;
  variation?: string;
  /** EQUIPMENT IDENTITY. Which room, which machine, which one of the four
   *  identical leg presses. This is what makes two same-named exercises
   *  legitimately different, so the duplicate review reads it before it
   *  proposes anything. */
  gym?: string;
  machineName?: string;
  machineId?: string;
  tags: string[];
  /** Out of the way without being gone. Same doctrine as hidden: an archived
   *  exercise keeps every record it has. */
  archived?: boolean;
  /** THE LIFT'S DECLARED MEASUREMENT. Editable here, and it never rewrites a
   *  thing: history keeps the kind each set was recorded under, and this is
   *  what the NEXT sighting picked out of the library will carry. A field
   *  that quietly re-typed finished sessions would change what recorded
   *  numbers mean, which is the one thing §2 forbids. */
  measure?: MeasureKind;
  /** The muscle assignment's window, from MuscleScope. Absent means every
   *  record, which is the default and the common case. */
  from?: string;
  until?: string;
}

export const EMPTY_CLASS: Classification = { primary: [], secondary: [], tags: [] };

/** The store as it sits in GymSettings: library key -> classification. */
export type ClassStore = Record<string, Classification>;

const isMuscle = (x: unknown): x is MuscleGroup => typeof x === "string" && (MUSCLE_GROUPS as readonly string[]).includes(x);
const oneOf = <T extends string>(list: readonly string[], x: unknown): T | undefined =>
  (typeof x === "string" && list.includes(x) ? (x as T) : undefined);
const text = (x: unknown): string | undefined => {
  const t = typeof x === "string" ? x.trim() : "";
  return t ? t : undefined;
};

/** READ ONE, DEFENSIVELY. Storage is JSON written by an older build, so every
 *  field is validated against its own list and anything unrecognised is
 *  dropped rather than carried forward as a value no menu can show. */
export function readClass(raw: unknown): Classification {
  const r = (typeof raw === "object" && raw ? raw : {}) as Record<string, unknown>;
  const primary = Array.isArray(r.primary) ? r.primary.filter(isMuscle) : [];
  const secondary = (Array.isArray(r.secondary) ? r.secondary.filter(isMuscle) : [])
    // A muscle cannot be both. Primary wins, which keeps the whole-set count
    // honest if a bad write ever put one in each list.
    .filter((m) => !primary.includes(m));
  const tags = Array.isArray(r.tags) ? r.tags.map((t) => text(t)).filter((t): t is string => !!t) : [];
  return {
    primary: [...new Set(primary)],
    secondary: [...new Set(secondary)],
    tags: [...new Set(tags)],
    ...(oneOf<Equipment>(EQUIPMENT_KINDS, r.equipment) ? { equipment: r.equipment as Equipment } : {}),
    ...(oneOf<Counted>(["total", "each_side", "each_hand", "added", "assist"], r.counted) ? { counted: r.counted as Counted } : {}),
    ...(oneOf<MovementPattern>(MOVEMENTS, r.movement) ? { movement: r.movement as MovementPattern } : {}),
    ...(oneOf<ExerciseType>(EXERCISE_TYPES, r.type) ? { type: r.type as ExerciseType } : {}),
    ...(oneOf<Execution>(EXECUTIONS, r.execution) ? { execution: r.execution as Execution } : {}),
    ...(oneOf<MeasureKind>(MEASURE_KINDS, r.measure) ? { measure: r.measure as MeasureKind } : {}),
    ...(text(r.grip) ? { grip: text(r.grip)! } : {}),
    ...(text(r.stance) ? { stance: text(r.stance)! } : {}),
    ...(text(r.angle) ? { angle: text(r.angle)! } : {}),
    ...(text(r.variation) ? { variation: text(r.variation)! } : {}),
    ...(text(r.gym) ? { gym: text(r.gym)! } : {}),
    ...(text(r.machineName) ? { machineName: text(r.machineName)! } : {}),
    ...(text(r.machineId) ? { machineId: text(r.machineId)! } : {}),
    ...(r.archived === true ? { archived: true as const } : {}),
    ...(text(r.from) ? { from: text(r.from)! } : {}),
    ...(text(r.until) ? { until: text(r.until)! } : {}),
  };
}

/** THE WHOLE STORE, VALIDATED, PLUS THE MIGRATION.
 *
 *  `muscleByKey` (2026-09-14, this morning) was a flat ordered list whose
 *  first entry meant "primary". It is read here and lifted into the two named
 *  lists, so nobody loses a tag they set between the two builds, and the old
 *  key is left exactly as it was rather than deleted -- a store this app
 *  wrote is never destroyed by a reader. A key present in classByKey wins,
 *  because it is the newer and more deliberate statement. */
export function readClassStore(
  classByKey: Record<string, unknown> | undefined,
  muscleByKey: Record<string, string[]> | undefined,
): ClassStore {
  const out: ClassStore = {};
  for (const [key, list] of Object.entries(muscleByKey ?? {})) {
    const ms = (Array.isArray(list) ? list : []).filter(isMuscle);
    if (!ms.length) continue;
    out[key] = { ...EMPTY_CLASS, primary: ms.slice(0, 1), secondary: ms.slice(1) };
  }
  for (const [key, raw] of Object.entries(classByKey ?? {})) out[key] = readClass(raw);
  return out;
}

/** The flat list the older muscle store speaks, so writing a classification
 *  keeps `muscleByKey` true for anything still reading it. Primaries first,
 *  which is exactly what its "first is primary" convention meant. */
export function muscleListOf(c: Classification): MuscleGroup[] {
  return [...c.primary, ...c.secondary];
}

/** Nothing worth storing: an empty classification is deleted rather than
 *  written as an empty object, so the store stays the set of exercises that
 *  have actually been said something about. */
export function isBlank(c: Classification): boolean {
  return c.primary.length === 0 && c.secondary.length === 0 && c.tags.length === 0
    && !c.equipment && !c.counted && !c.movement && !c.type && !c.execution && !c.measure
    && !c.grip && !c.stance && !c.angle && !c.variation
    && !c.gym && !c.machineName && !c.machineId && !c.archived;
}

/** THE ONE QUESTION THE LIBRARY ASKS OUT LOUD. Muscles are the only axis
 *  anything downstream depends on (Weekly Volume cannot see an untagged
 *  lift at all), so they are the only absence the row is allowed to nag
 *  about. Everything else is quietly optional forever. */
export function needsMuscles(c: Classification): boolean {
  return c.primary.length === 0;
}

// --- READING ONE EXERCISE'S ANSWER -----------------------------------------

/** What this exercise is, for display, with the two honest fallbacks.
 *
 *  A lift nobody has classified still has an equipment on its sightings (the
 *  ExerciseSheet has asked for one for a while) and a measure kind it has
 *  always been logged under. Showing those rather than an empty row means the
 *  library opens full of what the athlete already told the app, instead of
 *  demanding it all again in a new place. A stored answer always wins. */
export function classOf(
  store: ClassStore,
  row: { key: string; exerciseKey?: string; name?: string; kind?: MeasureKind },
  sighting?: LoadStyle,
): Classification {
  const found = store[row.key]
    ?? (row.exerciseKey ? store[row.exerciseKey] : undefined)
    ?? (row.name ? store[row.name] : undefined);
  const base = found ?? EMPTY_CLASS;
  return {
    ...base,
    ...(base.equipment || !sighting?.equipment ? {} : { equipment: sighting.equipment }),
    ...(base.counted || !sighting?.counted ? {} : { counted: sighting.counted }),
    ...(base.measure || !row.kind ? {} : { measure: row.kind }),
    // ONE SIDE AT A TIME IS UNILATERAL (2026-09-16). The two words are the
    // same fact said at two levels -- Execution is the library's word for it,
    // `sided` is the exercise's -- and having them drift apart is how a lift
    // ends up marked Unilateral in the library and logging bilateral reps in
    // the gym. A sighting that says so fills in an Execution nobody set; an
    // Execution already chosen is the athlete's answer and is never
    // overwritten, which is the rule the two rows above already keep.
    ...(base.execution || !sighting?.sided ? {} : { execution: "unilateral" as const }),
  };
}

/** The load convention as equipment.ts wants it. `alternating` is NOT sided:
 *  alternating means the two sides trade off WITHIN the set, so its rep count
 *  already spans both. Only unilateral does all its reps on one side. */
export function styleOf(c: Classification): LoadStyle {
  return {
    ...(c.equipment ? { equipment: c.equipment } : {}),
    ...(c.counted ? { counted: c.counted } : {}),
    ...(c.execution === "unilateral" ? { sided: true as const } : {}),
  };
}

/** Which readings this equipment allows, and the one it takes by default.
 *  Re-exported through here so the editor has one import for the whole
 *  schema rather than two that have to agree. */
export { countsFor, defaultCount, COUNTED_LABEL, EQUIPMENT_LABEL };

export function scopeOf(c: Classification): MuscleScope {
  if (c.from) return "future";
  if (c.until) return "existing";
  return "all";
}

/** Set the window. Writing a scope always clears the other end, so the two
 *  can never both be set and mean something nobody chose. */
export function withScope(c: Classification, scope: MuscleScope, todayIso: string): Classification {
  const next = { ...c };
  delete next.from;
  delete next.until;
  if (scope === "future") next.from = todayIso;
  if (scope === "existing") next.until = todayIso;
  return next;
}

/** Whether this assignment speaks for a record logged on `date`. */
export function coversDate(c: Classification, date: string): boolean {
  if (c.from && date < c.from) return false;
  if (c.until && date > c.until) return false;
  return true;
}

// --- WHAT THE ROW SHOWS ----------------------------------------------------

export interface Chip {
  /** Which editor group the chip opens. */
  field: "muscles" | "equipment" | "movement" | "type" | "execution" | "measure" | "tag";
  label: string;
  /** Primary movers read as the exercise's headline, so they are marked and
   *  the row can tell them apart without a legend. */
  tone?: "primary" | "secondary" | "plain";
}

/** THE ROW'S CHIPS (handoff §2: "Tappable muscle and equipment chips",
 *  §7: 'Back · Biceps' becomes "tappable muscle chips identifying primary and
 *  secondary roles").
 *
 *  The old row wrote every fact as one grey run-on sentence. These are the
 *  same facts as objects: each one says which role it is, and each one is a
 *  door into the group of the editor that sets it. */
export function rowChips(c: Classification): Chip[] {
  const out: Chip[] = [];
  for (const m of c.primary) out.push({ field: "muscles", label: MUSCLE_LABEL[m], tone: "primary" });
  for (const m of c.secondary) out.push({ field: "muscles", label: MUSCLE_LABEL[m], tone: "secondary" });
  if (c.equipment) out.push({ field: "equipment", label: EQUIPMENT_LABEL[c.equipment], tone: "plain" });
  if (c.movement) out.push({ field: "movement", label: MOVEMENT_LABEL[c.movement], tone: "plain" });
  return out;
}

/** The value of one axis in words, for a review or a detail row. Null where
 *  nothing has been said, so the caller can offer to say it. */
export function valueLine(c: Classification, field: Chip["field"]): string | null {
  switch (field) {
    case "muscles": {
      if (!c.primary.length && !c.secondary.length) return null;
      const p = c.primary.map((m) => MUSCLE_LABEL[m]).join(", ");
      const s = c.secondary.map((m) => MUSCLE_LABEL[m]).join(", ");
      if (!s) return p;
      if (!p) return `Also ${s}`;
      return `${p} · Also ${s}`;
    }
    case "equipment": {
      if (!c.equipment) return null;
      const label = EQUIPMENT_LABEL[c.equipment];
      const counted = c.counted;
      if (!counted || countsFor(c.equipment).length < 2 || counted === defaultCount(c.equipment)) return label;
      return `${label} · ${COUNTED_LABEL[counted]}`;
    }
    case "movement": return c.movement ? MOVEMENT_LABEL[c.movement] : null;
    case "type": return c.type ? TYPE_LABEL[c.type] : null;
    case "measure": return c.measure ? MEASURE_LABEL[c.measure] : null;
    case "execution": {
      const bits = [
        c.execution ? EXECUTION_LABEL[c.execution] : null,
        c.grip ?? null, c.stance ?? null, c.angle ?? null, c.variation ?? null,
      ].filter((x): x is string => !!x);
      return bits.length ? bits.join(" · ") : null;
    }
    case "tag": return c.tags.length ? c.tags.join(", ") : null;
  }
}

/** WHERE IT LIVES, for the duplicate review. Two exercises with the same name
 *  on two different machines are two exercises, and this is the line that
 *  says so. */
export function identityLine(c: Classification): string | null {
  const bits = [c.gym, c.machineName, c.machineId].filter((x): x is string => !!x);
  return bits.length ? bits.join(" · ") : null;
}

// --- BATCH EDITING ---------------------------------------------------------

/** The fields Select mode can write across many exercises at once. Deliberately
 *  short: the free-text axes and the equipment identity are about ONE machine
 *  in ONE room, and writing them across a selection is how a batch edit turns
 *  into a mess nobody can unpick. */
export type BatchField = "primary" | "secondary" | "equipment" | "movement" | "type" | "execution" | "tags";

export const BATCH_LABEL: Record<BatchField, string> = {
  primary: "Primary Muscles",
  secondary: "Secondary Muscles",
  equipment: "Equipment",
  movement: "Movement Pattern",
  type: "Exercise Type",
  execution: "Execution",
  tags: "Tags",
};

/** ADD, REPLACE, CLEAR -- and the difference between them is the whole point
 *  (handoff §3: "Batch changes must distinguish Add, Replace, and Clear").
 *  Add leaves what is there; Replace swaps only this field; Clear empties only
 *  this field. Nothing else on the exercise is touched by any of the three,
 *  which is acceptance criterion 4. */
export type BatchMode = "add" | "replace" | "clear";

export interface BatchChange {
  key: string;
  name: string;
  before: string;
  after: string;
}

export interface BatchPlan {
  next: ClassStore;
  /** Only the exercises this actually changes. An exercise already carrying
   *  the value is not a change, and showing it as one would make the preview
   *  a lie about its own size. */
  changes: BatchChange[];
  /** Selected exercises the batch leaves exactly as they are. */
  unchanged: number;
}

const listField = (f: BatchField): boolean => f === "primary" || f === "secondary" || f === "tags";

function applyOne(c: Classification, field: BatchField, mode: BatchMode, values: string[]): Classification {
  const next: Classification = { ...c, primary: [...c.primary], secondary: [...c.secondary], tags: [...c.tags] };
  if (listField(field)) {
    const incoming = field === "tags"
      ? values.map((v) => v.trim()).filter(Boolean)
      : values.filter(isMuscle);
    const cur = field === "primary" ? next.primary : field === "secondary" ? next.secondary : next.tags;
    const list = mode === "clear" ? [] : mode === "replace" ? [...incoming] : [...cur, ...incoming];
    const uniq = [...new Set(list)];
    if (field === "primary") {
      next.primary = uniq as MuscleGroup[];
      // A muscle promoted to primary stops being secondary; the two lists
      // are roles, and one muscle holds one role at a time.
      next.secondary = next.secondary.filter((m) => !next.primary.includes(m));
    } else if (field === "secondary") {
      next.secondary = (uniq as MuscleGroup[]).filter((m) => !next.primary.includes(m));
    } else {
      next.tags = uniq;
    }
    return next;
  }
  const v = values[0];
  if (mode === "clear" || !v) {
    if (field === "equipment") { delete next.equipment; delete next.counted; }
    if (field === "movement") delete next.movement;
    if (field === "type") delete next.type;
    if (field === "execution") delete next.execution;
    return next;
  }
  if (field === "equipment" && oneOf<Equipment>(EQUIPMENT_KINDS, v)) {
    next.equipment = v as Equipment;
    // The reading has to stay legal for the new hardware: a dumbbell's "Each
    // Hand" means nothing on a weight stack, and carrying it across would
    // make every tonnage on the selection wrong at once.
    if (!next.counted || !countsFor(next.equipment).includes(next.counted)) next.counted = defaultCount(next.equipment);
  }
  if (field === "movement" && oneOf<MovementPattern>(MOVEMENTS, v)) next.movement = v as MovementPattern;
  if (field === "type" && oneOf<ExerciseType>(EXERCISE_TYPES, v)) next.type = v as ExerciseType;
  if (field === "execution" && oneOf<Execution>(EXECUTIONS, v)) next.execution = v as Execution;
  return next;
}

/**
 * PLAN A BATCH, DO NOT RUN IT (handoff §3: "Preview which fields will change
 * before saving").
 *
 * Returns the store it WOULD write and the per-exercise before/after the
 * preview reads from, so the sheet can show the real list and the athlete can
 * see that eleven selected exercises are in fact four changes.
 */
export function planBatch(
  store: ClassStore,
  rows: { key: string; name: string; kind?: MeasureKind }[],
  field: BatchField,
  mode: BatchMode,
  values: string[],
): BatchPlan {
  const next: ClassStore = { ...store };
  const changes: BatchChange[] = [];
  let unchanged = 0;
  for (const row of rows) {
    const before = classOf(store, row);
    const after = applyOne(before, field, mode, values);
    const beforeLine = valueLine(before, batchChip(field)) ?? "Not set";
    const afterLine = valueLine(after, batchChip(field)) ?? "Not set";
    if (beforeLine === afterLine) { unchanged++; continue; }
    changes.push({ key: row.key, name: row.name, before: beforeLine, after: afterLine });
    if (isBlank(after)) delete next[row.key]; else next[row.key] = after;
  }
  return { next, changes, unchanged };
}

/** Which chip a batch field reads back through. Primary and secondary share
 *  the muscle line, because that line is what the row actually shows. */
function batchChip(field: BatchField): Chip["field"] {
  if (field === "primary" || field === "secondary") return "muscles";
  if (field === "tags") return "tag";
  return field;
}

export { batchChip };

// --- MERGING TWO CLASSIFICATIONS -------------------------------------------

export interface ClassConflict {
  field: BatchField | "measure";
  label: string;
  keep: string;
  fold: string;
}

/**
 * WHERE THE TWO DISAGREE (handoff §5 step 4: "Resolve conflicting
 * classifications explicitly").
 *
 * Only fields where BOTH sides have said something and said something
 * different are conflicts. A field only one side has answered is not a
 * disagreement, it is the answer -- the merged exercise takes it, and the
 * review says so rather than asking a question with one possible reply.
 */
export function classConflicts(keep: Classification, fold: Classification): ClassConflict[] {
  const out: ClassConflict[] = [];
  const pairs: { field: ClassConflict["field"]; chip: Chip["field"] }[] = [
    { field: "primary", chip: "muscles" },
    { field: "equipment", chip: "equipment" },
    { field: "movement", chip: "movement" },
    { field: "type", chip: "type" },
    { field: "execution", chip: "execution" },
    { field: "measure", chip: "measure" },
  ];
  for (const p of pairs) {
    const a = valueLine(keep, p.chip);
    const b = valueLine(fold, p.chip);
    if (a && b && a !== b) {
      out.push({
        field: p.field,
        label: p.field === "measure" ? "Measurement" : BATCH_LABEL[p.field],
        keep: a,
        fold: b,
      });
    }
  }
  return out;
}

/**
 * THE MERGED ANSWER. The survivor's own answers stand; the folded exercise
 * fills in only the blanks, EXCEPT where `take` names a field the athlete
 * resolved the other way in the review. Tags union, because a tag is a label
 * the athlete put there and neither copy of it is wrong.
 */
export function mergeClass(
  keep: Classification,
  fold: Classification,
  take: ClassConflict["field"][] = [],
): Classification {
  const takes = new Set(take);
  const pick = <K extends keyof Classification>(k: K, conflictField: ClassConflict["field"]): Classification[K] => {
    if (takes.has(conflictField) && fold[k] != null) return fold[k];
    return keep[k] != null ? keep[k] : fold[k];
  };
  const primary = takes.has("primary") && fold.primary.length ? fold.primary
    : keep.primary.length ? keep.primary : fold.primary;
  const secondary = [...new Set([...(takes.has("primary") && fold.primary.length ? fold.secondary : keep.secondary), ...(keep.secondary.length ? [] : fold.secondary)])]
    .filter((m) => !primary.includes(m));
  const out: Classification = {
    ...keep,
    primary: [...primary],
    secondary,
    tags: [...new Set([...keep.tags, ...fold.tags])],
  };
  const assign = <K extends keyof Classification>(k: K, f: ClassConflict["field"]): void => {
    const v = pick(k, f);
    if (v == null) delete out[k]; else out[k] = v;
  };
  assign("equipment", "equipment");
  assign("counted", "equipment");
  assign("movement", "movement");
  assign("type", "type");
  assign("execution", "execution");
  assign("measure", "measure");
  for (const k of ["grip", "stance", "angle", "variation", "gym", "machineName", "machineId"] as const) {
    if (out[k] == null && fold[k] != null) out[k] = fold[k];
  }
  return out;
}
