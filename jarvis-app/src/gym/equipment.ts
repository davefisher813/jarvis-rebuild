// EQUIPMENT, AND WHAT THE NUMBER ON THE CHIP MEANS
// (Dave, 2026-09-14: "If someone is using a barbell it's different than
// dumbells. The weight should adjust accordingly... someone loading 100 lbs
// on a free weight machine is different than barbells. It can't all be the
// same. Also, equipment might not be the best term.")
//
// ONE ROW WAS DOING TWO JOBS. The old Equipment menu mixed what a thing IS
// (barbell, dumbbell, plate-loaded) with how its number is COUNTED ("One
// Side at a Time"), and with one option that is not equipment at all
// ("Timed or Distance"). Those are two different questions, so they are two
// rows now: EQUIPMENT says what you are lifting, COUNTED AS says what the
// number on the chip means. Counted As only appears when the equipment
// leaves it genuinely open -- a weight stack has exactly one reading, so it
// asks nothing and takes no tap.
//
// So "equipment" turns out to be the right word after all, once the things
// that were never equipment are taken out of it.
//
// THE STANDING RULE IS UNCHANGED: a convention is a LABEL, never a
// conversion. Nothing in this file ever rewrites the number the athlete
// typed, on the chip or anywhere else. What it does change is everything
// downstream that was quietly treating every weight as the same kind of
// number:
//
//   - the Weight stepper's INCREMENT, because a stack moves in 10s, a
//     barbell in 5s, and a dip belt in 2.5s, and one hardcoded step of 5
//     was wrong for two of those three;
//   - the Weight row's LABEL, so a chip reads "Per Hand", "Per Side",
//     "Added" or "Assistance" instead of a bare ambiguous "Weight";
//   - the DIRECTION of progress, because on an assisted pull-up LESS weight
//     is stronger, and every PR, chart and plateau check in the app had
//     that exactly backwards;
//   - TONNAGE, because two 50 lb dumbbells for 10 is 1,000 lb of work and
//     not 500, and a plate machine loaded 100 a side is 2,000 and not
//     1,000;
//   - and what is COMPARABLE at all, because a lift's numbers stop meaning
//     the same thing the day its equipment changes.

/** WHAT YOU ARE LIFTING. Real equipment only.
 *
 *  2026-09-14, second pass: `smith` and `kettlebell` join the list. A Smith
 *  machine was landing on Barbell, which is the one substitution that flatters
 *  a lifter (the carriage carries part of the load and takes the balance out
 *  entirely), and a kettlebell was landing on Dumbbells, whose rack steps in
 *  5s where a bell steps in 4kg / 8 lb jumps. Both were wrong in the stepper
 *  AND in the comparison, which is exactly the class of error this file
 *  exists to end.
 *
 *  `assisted` stays, though the handoff's own list of ten does not name it:
 *  records already carry it, dropping it would strand them, and it is the
 *  only equipment whose PR direction inverts. It is the machine, and
 *  "Assistance" is what its number means. */
export type Equipment =
  | "barbell"
  | "dumbbell"
  | "kettlebell"
  | "machine"
  | "stack"
  | "smith"
  | "cable"
  | "bodyweight"
  | "assisted"
  | "band"
  | "other";

/** WHAT THE NUMBER MEANS. The second axis, split out of the old single menu. */
export type Counted = "total" | "each_side" | "each_hand" | "added" | "assist";

export const EQUIPMENT_KINDS: Equipment[] = [
  "barbell", "dumbbell", "kettlebell", "cable", "stack", "machine", "smith",
  "bodyweight", "assisted", "band", "other",
];

// The two machine words are now said in full. "Weight Stack" and
// "Plate-Loaded Machine" described the same object from two different angles
// and left a lifter to work out which one their gym's leg press was; the
// trade name for the pin-and-stack kind is selectorized, and saying both in
// the same grammar is what makes the pair legible as a pair.
export const EQUIPMENT_LABEL: Record<Equipment, string> = {
  barbell: "Barbell",
  dumbbell: "Dumbbells",
  kettlebell: "Kettlebell",
  machine: "Plate-Loaded Machine",
  stack: "Selectorized Machine",
  smith: "Smith Machine",
  cable: "Cable",
  bodyweight: "Bodyweight",
  assisted: "Assisted",
  band: "Band",
  other: "Other",
};

export const COUNTED_LABEL: Record<Counted, string> = {
  total: "The Whole Load",
  each_side: "Each Side",
  each_hand: "Each Hand",
  added: "Added to Bodyweight",
  assist: "Assistance Taken Off",
};

/** The Weight ROW's own name once the convention is known. This is the
 *  single biggest readability win: a chip that says 100 stops being a
 *  riddle. */
export const WEIGHT_LABEL: Record<Counted, string> = {
  total: "Weight",
  each_side: "Weight Per Side",
  each_hand: "Weight Per Hand",
  added: "Added Weight",
  assist: "Assistance",
};

interface EquipmentSpec {
  /** What this equipment may be counted as; the first is the default. An
   *  equipment with one entry never shows the Counted As row at all. */
  counts: Counted[];
  /** The Weight stepper's increment, per unit. A rack's real granularity,
   *  not one number for everything. */
  step: { lb: number; kg: number };
  /** True when plates actually go on it, so the plate calculator offers
   *  itself here and stays quiet everywhere else. */
  plates: boolean;
  /** Subtract the bar before doing plate math. Only a barbell has a bar. */
  hasBar: boolean;
  /** A quiet line under the Equipment row, in plain words. */
  note: string;
}

// THE INCREMENTS ARE THE GYM'S, NOT A GUESS.
//   barbell   5 lb  = the smallest pair of plates most racks own (2.5 a side)
//   dumbbell  5 lb  = the standard rack spacing under 50 lb
//   machine   5 lb  = 2.5 a side, same plate pair as the barbell
//   stack    10 lb  = a selectorized stack's own plate; half-steps need a pin
//   cable     5 lb  = most cable stacks are 5s, or 10s with a 5 lb adder
//   bodyweight 2.5  = what a dip belt can actually hold in small change
//   assisted  5 lb  = assist stacks move in 5s or 10s; 5 is the safe floor
//   band      0     = a band has no number to step (see weightless below)
// kg columns are the metric rack's own equivalents, never a converted lb.
const SPEC: Record<Equipment, EquipmentSpec> = {
  barbell: {
    counts: ["total", "each_side"],
    step: { lb: 5, kg: 2.5 },
    plates: true,
    hasBar: true,
    note: "The bar plus the plates on it",
  },
  dumbbell: {
    counts: ["each_hand", "total"],
    step: { lb: 5, kg: 2 },
    plates: false,
    hasBar: false,
    note: "One dumbbell's number, not the pair's",
  },
  // A competition bell is cast in 4 kg steps, and the pound rack that copies
  // it lands on 9, 13, 18, 26, 35 -- so neither 5 nor 2 is its real
  // granularity. 8 lb / 4 kg is the jump the rack actually offers.
  kettlebell: {
    counts: ["each_hand", "total"],
    step: { lb: 8, kg: 4 },
    plates: false,
    hasBar: false,
    note: "One bell's number, not the pair's",
  },
  // The carriage holds the bar up and takes the balance out, so a Smith
  // number is not a barbell number and the two never belong on one line.
  // Its own bar is lighter than a 45 and varies by maker, so plate math is
  // offered without a bar to subtract rather than subtracting a wrong one.
  smith: {
    counts: ["total", "each_side"],
    step: { lb: 5, kg: 2.5 },
    plates: true,
    hasBar: false,
    note: "The plates on the carriage, bar weight varies by machine",
  },
  machine: {
    counts: ["total", "each_side"],
    step: { lb: 5, kg: 2.5 },
    plates: true,
    hasBar: false,
    note: "The plates you load, no bar to subtract",
  },
  stack: {
    counts: ["total"],
    step: { lb: 10, kg: 5 },
    plates: false,
    hasBar: false,
    note: "The number beside the pin",
  },
  cable: {
    counts: ["total", "each_side"],
    step: { lb: 5, kg: 2.5 },
    plates: false,
    hasBar: false,
    note: "The stack's number, whatever the pulley does to it",
  },
  bodyweight: {
    counts: ["added"],
    step: { lb: 2.5, kg: 1 },
    plates: false,
    hasBar: false,
    note: "Zero is a real answer here",
  },
  assisted: {
    counts: ["assist"],
    step: { lb: 5, kg: 2.5 },
    plates: false,
    hasBar: false,
    note: "Less assistance is stronger",
  },
  band: {
    counts: ["total"],
    step: { lb: 5, kg: 2.5 },
    plates: false,
    hasBar: false,
    note: "No weight to record, just reps",
  },
  other: {
    counts: ["total", "each_side", "each_hand"],
    step: { lb: 5, kg: 2.5 },
    plates: false,
    hasBar: false,
    note: "",
  },
};

export const EQUIPMENT_NOTE = (e: Equipment): string => SPEC[e].note;

/** The convention as stored on an exercise or a logged entry. Both halves
 *  optional: absent equipment means the athlete never said, and everything
 *  falls back to the old universal behaviour. */
export interface LoadStyle {
  equipment?: Equipment;
  counted?: Counted;
  /** ONE SIDE AT A TIME (2026-09-16). The reps axis, independent of the two
   *  above: see Exercise.sided in types.ts for why it is not a third value of
   *  `counted`. Absent means both sides at once. */
  sided?: boolean;
}

/** THE MIGRATION, in one place. Everything logged before 2026-09-14 carried
 *  either `load: "each"` (Health Push E) or the first Equipment union, whose
 *  last two members were never equipment. Nothing is rewritten on disk: this
 *  reads the old value and says what it meant.
 *
 *    "dumbbell"   was labelled "Dumbbell, Each Hand" -> dumbbell + each_hand
 *    "unilateral" was "One Side at a Time", a COUNT and not a thing you
 *                 lift  -> equipment unknown + each_side
 *    "timed"      was "Timed or Distance", not a load at all -> other
 *    load:"each"  predates the menu entirely -> dumbbell + each_hand
 */
export function loadStyleOf(ex: {
  equipment?: string;
  counted?: Counted;
  sided?: boolean;
  load?: "each" | "total";
}): LoadStyle {
  const raw = ex.equipment;
  // The reps axis rides along untouched by any of the equipment migrations
  // below: it was never part of the old menu, so there is nothing to read
  // back. Spread last in every branch.
  const side = ex.sided ? { sided: true as const } : {};
  // "One Side at a Time" said how to COUNT and never said what the hardware
  // was, so it lands on Other rather than inventing a machine -- and Other
  // is the one equipment that offers all three readings, which keeps the row
  // visible and the old meaning editable instead of stranded.
  if (raw === "unilateral") return { equipment: "other", counted: ex.counted ?? "each_side", ...side };
  if (raw === "timed") return { equipment: "other", counted: ex.counted ?? "total", ...side };
  if (raw === "dumbbell") return { equipment: "dumbbell", counted: ex.counted ?? "each_hand", ...side };
  if (raw && (EQUIPMENT_KINDS as string[]).includes(raw)) {
    const e = raw as Equipment;
    return { equipment: e, counted: ex.counted ?? defaultCount(e), ...side };
  }
  if (ex.load === "each") return { equipment: "dumbbell", counted: ex.counted ?? "each_hand", ...side };
  return { ...(ex.counted ? { counted: ex.counted } : {}), ...side };
}

/** The reading an equipment takes when nobody has said otherwise. */
export function defaultCount(e: Equipment): Counted {
  return SPEC[e].counts[0]!;
}

/** What this equipment may be counted as. One entry means don't ask. */
export function countsFor(e: Equipment | undefined): Counted[] {
  return e ? SPEC[e].counts : ["total", "each_side", "each_hand"];
}

/** Whether the Counted As row is worth a row at all. Nothing to ask when the
 *  equipment has not been named -- a follow-up question about a thing you
 *  have not picked is the kind of row this whole change exists to remove. */
export function asksCount(e: Equipment | undefined): boolean {
  return e != null && countsFor(e).length > 1;
}

/** THE STEPPER'S INCREMENT. The concrete answer to "the weight should adjust
 *  accordingly": a stack steps 10, a dip belt steps 2.5, and neither is 5. */
export function weightStep(style: LoadStyle, unit?: string): number {
  const metric = unit === "kg";
  const spec = style.equipment ? SPEC[style.equipment] : null;
  if (!spec) return metric ? 2.5 : 5;
  return metric ? spec.step.kg : spec.step.lb;
}

/** The Weight row's label under this convention. */
export function weightLabel(style: LoadStyle): string {
  return WEIGHT_LABEL[style.counted ?? "total"];
}

/** THE REPS ROW'S NAME. "Reps" means both sides at once; on a lift worked one
 *  side at a time, 8 is 8 per leg and the set is 16, and the field has to say
 *  which of those it is asking for. */
export function repLabel(style: LoadStyle): string {
  return style.sided ? "Reps Per Side" : "Reps";
}

/** What a chip adds after its numbers to stay honest about the reps: "185 lb
 *  x 8 per side". Empty on everything else, which is every set logged before
 *  the axis existed. */
export function sideSuffix(style: LoadStyle): string {
  return style.sided ? " per side" : "";
}

/** A band has reps and no number; the Weight field simply does not apply. */
export function weightless(style: LoadStyle): boolean {
  return style.equipment === "band";
}

/** Does the plate calculator belong on this exercise, and does it subtract a
 *  bar first? */
export function plateMath(style: LoadStyle): { offer: boolean; hasBar: boolean } {
  const spec = style.equipment ? SPEC[style.equipment] : null;
  return { offer: !!spec?.plates, hasBar: !!spec?.hasBar };
}

/**
 * THE LOAD CALCULATOR'S DOOR, AND ITS WORDS (2026-09-16, Dave: "the plate
 * calculator has to factor in all of the weight loading options not just
 * dumbbells").
 *
 * There is something to work out whenever the number the athlete records is
 * not the thing they physically set: plates to hang and halve, a pair to
 * total, a pin to land on. The label says which of those it is, because
 * "Plate Calculator" over a cable stack was the whole complaint.
 *
 * Null where the number IS the setting and a calculator would be a lie: a
 * band has no number, and bodyweight and assisted record the number itself.
 */
export function loadCalcFor(style: LoadStyle): string | null {
  const e = style.equipment;
  if (!e) return null;
  if (SPEC[e].plates) return "Plate Calculator";
  if (e === "dumbbell" || e === "kettlebell") return "What the Pair Moves";
  if (e === "stack" || e === "cable") return "Find the Pin";
  return null;
}

/** HOW MANY OF THE NUMBER ARE ACTUALLY MOVING, for tonnage only.
 *
 *  Two 50s is 100 lb in the air. A plate machine loaded 100 a side is 200.
 *  Tonnage has always multiplied the raw chip by reps, so every per-side and
 *  per-hand lift in the app has been undercounted by exactly half since the
 *  conventions were introduced.
 *
 *  Assistance returns 0 on purpose, and this is the honest answer rather
 *  than the flattering one: the work on an assisted pull-up is bodyweight
 *  MINUS the assist, and the app does not reliably know a bodyweight on the
 *  day of the set. Counting the assist itself as tonnage would say a lifter
 *  moved more the more help they took. Zero, plus a line in the receipt
 *  saying so, beats a number that is wrong in the wrong direction.
 *
 *  Added weight returns 1: the belt's plates are counted, the body is not,
 *  for the same reason -- and the receipt says that too. */
export function volumeFactor(style: LoadStyle): number {
  return sideFactor(style) * countFactor(style);
}

/** The reps half of the tonnage question (2026-09-16): a set of 8 per leg is
 *  16 reps of work. Separate from the weight half so the two multiply rather
 *  than one overwriting the other -- a dumbbell split squat is both. */
function sideFactor(style: LoadStyle): number {
  // Assistance is zero whatever the reps do, and zero times two is still the
  // honest answer; countFactor below is what returns it.
  return style.sided ? 2 : 1;
}

function countFactor(style: LoadStyle): number {
  switch (style.counted) {
    case "each_side":
    case "each_hand":
      return 2;
    case "assist":
      return 0;
    case "added":
    case "total":
    default:
      return 1;
  }
}

/** TRUE WHEN LESS IS BETTER. The correctness fix: an assisted pull-up going
 *  from 100 lb of help to 60 is the single clearest strength gain in the
 *  gym, and until now every PR check, every chart and the plateau detector
 *  read it as a 40 lb regression. */
export function lowerIsStronger(style: LoadStyle): boolean {
  return style.counted === "assist";
}

/** CAN THESE TWO SETS BE COMPARED AT ALL?
 *
 *  A lift switched from a weight stack to a plate-loaded machine keeps its
 *  name, its key and its history, and none of its old numbers mean what the
 *  new ones mean. Comparing them produces a PR pill for a change of machine.
 *  Two sets are comparable when they were counted the same way; the
 *  equipment may differ (a barbell bench and a plate machine bench are both
 *  a whole load) but the READING may not. An unstated convention compares
 *  with anything, so nothing logged before this file existed goes quiet. */
export function comparable(a: LoadStyle, b: LoadStyle): boolean {
  if (a.counted == null || b.counted == null) return true;
  return a.counted === b.counted;
}

/** The one-line summary for a row that shows the convention without opening
 *  a menu: "Dumbbells · Each Hand", "Weight Stack", "Assisted". */
export function styleSummary(style: LoadStyle): string {
  if (!style.equipment) return style.counted ? COUNTED_LABEL[style.counted] : "Not Set";
  const label = EQUIPMENT_LABEL[style.equipment];
  const counted = style.counted;
  if (!counted || !asksCount(style.equipment) || counted === defaultCount(style.equipment)) return label;
  return `${label} · ${COUNTED_LABEL[counted]}`;
}
