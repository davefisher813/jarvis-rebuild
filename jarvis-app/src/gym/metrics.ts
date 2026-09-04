// HEALTH DATA, EVERYONE'S CALL -- D10-B (Training Catalog V2, approved
// 2026-08-31), OVERRIDING the earlier body-metrics ban.
//
// gym/types.ts's own doctrine comment says "performance data is fair game,
// body data is not" -- true of the EXERCISE measure system (the weight on
// the bar is a fact about the bar), and left exactly as it was written. This
// is a different, later, and explicitly overriding decision for a SEPARATE
// surface: Dave, verbatim, approving D10-B/D11-C, "Take out that ban.
// Everyone should be able to insert their data if they want. There are
// plenty of high school students who can track their physical data in a
// healthy way." (claude/HEALTH_DOCTRINE_OVERRIDE_2026_08_31.md). A user may
// log bodyweight, sleep, or anything they define themselves, in every
// template.
//
// What still stands, unmoved by the override:
//   - opt-in, off by default -- METRIC_PRESETS is a MENU, never pre-enabled.
//   - hide, never delete (a hidden metric's history stays; it just leaves
//     the daily strip).
//   - no targets, no rings, no streaks, no "you missed", no decline framing.
//   - no composite score of a person, ever, from this or anything reading it.
//   - no calorie-counting FEATURE: a user may name a "Calories" custom
//     metric like any other number, but no food database, macro targets, or
//     barcode scanner is built around it.

export const ENTITY_METRIC_DEF = "metric_def";
export const ENTITY_METRIC_LOG = "metric_log";

export type MetricType = "number" | "scale5" | "yesno" | "minutes";

export const METRIC_TYPE_LABEL: Record<MetricType, string> = {
  number: "Number + Unit", scale5: "1-5 Scale", yesno: "Yes / No", minutes: "Minutes",
};

// id+data split, the same shape every gym and life entity already uses
// (Program/ProgramData, Workout/WorkoutData, Goal/GoalData): the store
// assigns the id, this file never invents one.
export interface MetricDefData {
  name: string; // the user's own words for a custom metric, or a preset's name
  type: MetricType;
  unit?: string; // number type only
  /** Which curated preset this came from, if any -- purely informational
   *  (lets Settings show "from the library" vs "custom"); a copied preset is
   *  the user's own record from the moment it is enabled, editable and
   *  deletable exactly like a hand-built one. */
  presetKey?: string;
  order?: number;
  /** HIDE, NEVER DELETE (D10-B). Off the daily strip; its logged history is
   *  untouched and still readable by insights and the panels. */
  hidden?: boolean;
  /** Local ISO day this metric was turned on. Informational only today (no
   *  measure reads "since" a metric started); kept for the same reason
   *  goals stamp one, in case a future surface needs the age of the data. */
  createdOn: string;
}
export interface MetricDef { id: string; data: MetricDefData }

export interface MetricLogData {
  metricId: string;
  date: string; // local ISO day -- one log per metric per day (BACKFILL replaces it, never doubles it)
  /** number, minutes, and scale5 all read this one field; yesno reads `yes`
   *  instead. Same "one shape, field means something different per kind"
   *  convention gym/types.ts's own SetLog already uses. */
  value?: number;
  yes?: boolean;
  /** Wall-clock ms when this entry was actually typed in -- BACKFILL is
   *  explicitly allowed (D10-B), so `at` records when the log was made, not
   *  a claim about when the sleep happened; `date` alone carries that. */
  at: number;
}
export interface MetricLog { id: string; data: MetricLogData }

export interface MetricPreset {
  key: string;
  name: string;
  type: MetricType;
  unit?: string;
}

/**
 * The curated library. Every one of these is OFF until the user turns it on
 * -- this array is a menu, not a set of defaults. Deliberately excludes
 * calorie/macro tracking (no preset here becomes a food-logging feature) and
 * mood (D11's own rule keeps mood out of the correlation surfaces its data
 * would otherwise feed, so it is not offered as a preset at all rather than
 * offered and then silently excluded downstream).
 */
export const METRIC_PRESETS: MetricPreset[] = [
  { key: "sleep", name: "Sleep", type: "number", unit: "hrs" },
  { key: "bodyweight", name: "Bodyweight", type: "number", unit: "lb" },
  { key: "restingHR", name: "Resting Heart Rate", type: "number", unit: "bpm" },
  { key: "soreness", name: "Soreness", type: "scale5" },
  { key: "energy", name: "Energy", type: "scale5" },
  { key: "stress", name: "Stress", type: "scale5" },
  { key: "caffeine", name: "Caffeine", type: "number", unit: "mg" },
  { key: "protein", name: "Protein", type: "number", unit: "g" },
  { key: "hydration", name: "Hydration", type: "number", unit: "oz" },
  { key: "screenTime", name: "Screen Time", type: "minutes" },
  { key: "sick", name: "Feeling Sick", type: "yesno" },
];

// THE DAILY PULSE (Brain build handoff item 11, decision c2; Dave took
// option A on 2026-09-04: "seed the five as preset metrics in the existing
// Health strip and let the Brain read them. No new surface, no third asker").
//
// Two honest corrections to the item's own list of five, both made rather
// than silently papered over:
//
//   FATIGUE is already here, called Energy. They are one axis with opposite
//   polarity, so shipping both would give a user two 1-5 scales that mean the
//   same thing inverted, and would let a correlation surface count one signal
//   twice. Energy is the one that stays.
//
//   MOOD is deliberately absent from METRIC_PRESETS, and the reason is
//   written above it: D11's rule keeps mood out of the correlation surfaces
//   its data would otherwise feed, so it is not offered at all rather than
//   offered and then quietly dropped downstream. That is a standing ruling
//   with a stated reason, and item 11 does not overturn it. Today already
//   asks about mood in the evening check-in, which is the surface that was
//   built for it.
//
// So the pulse is FOUR of the library's existing presets, grouped so they
// come on together in one tap instead of four trips through the menu. It adds
// no metric that was not already offered, and every one of them keeps hide,
// never delete, and no targets or streaks.
export const PULSE_KEYS = ["sleep", "energy", "soreness", "stress"] as const;

/** The library entries the pulse turns on, in the order it turns them on. */
export function pulsePresets(): MetricPreset[] {
  return PULSE_KEYS.map((k) => METRIC_PRESETS.find((p) => p.key === k)).filter((p): p is MetricPreset => !!p);
}

/**
 * Where the pulse stands: every one of them on, some of them, or none.
 *
 * "partial" is a real state and is treated as off-but-started, so the one-tap
 * row turns on only what is missing. It never turns anything OFF: a user who
 * deliberately hid Stress does not get it switched back on by tapping a group
 * that happens to contain it.
 */
export function pulseState(defs: MetricDef[]): "on" | "partial" | "off" {
  const on = PULSE_KEYS.filter((k) => defs.some((d) => d.data.presetKey === k && !d.data.hidden)).length;
  if (on === 0) return "off";
  return on === PULSE_KEYS.length ? "on" : "partial";
}

/**
 * Exactly what one tap has to do, split by which write it needs.
 *
 * The split is load-bearing. "Not on" covers two different states: never
 * enabled, and enabled then hidden. Creating a def for the second would leave
 * TWO defs carrying the same presetKey, one with the user's logged history
 * stranded behind it, which is the opposite of HIDE, NEVER DELETE. So a key
 * with an existing def is un-hidden and keeps its history; only a key with no
 * def at all is created.
 */
export function pulsePlan(defs: MetricDef[]): { create: MetricPreset[]; unhide: MetricDef[] } {
  const create: MetricPreset[] = [];
  const unhide: MetricDef[] = [];
  for (const p of pulsePresets()) {
    const d = defs.find((x) => x.data.presetKey === p.key);
    if (!d) create.push(p);
    else if (d.data.hidden) unhide.push(d);
  }
  return { create, unhide };
}

/** Defs actually shown on the daily strip: on, and not hidden, in order. */
export function activeMetrics(defs: MetricDef[]): MetricDef[] {
  return defs.filter((d) => !d.data.hidden)
    .sort((a, b) => (a.data.order ?? 0) - (b.data.order ?? 0) || a.data.name.localeCompare(b.data.name));
}

/** This metric's log for one day, or undefined if nothing was said. Absence
 *  is the legal state (EMPTY IS LEGAL) -- never backfilled with a zero. */
export function logOn(logs: MetricLog[], metricId: string, date: string): MetricLog | undefined {
  return logs.find((l) => l.data.metricId === metricId && l.data.date === date);
}

/** One number per metric, however its type stores one -- yesno reads as 1/0
 *  so a correlation join (insights.ts) can treat every type the same way
 *  once it has a def to read the type from. Undefined when nothing logged. */
export function numericValue(def: Pick<MetricDefData, "type">, log: MetricLog | undefined): number | undefined {
  if (!log) return undefined;
  if (def.type === "yesno") return log.data.yes == null ? undefined : (log.data.yes ? 1 : 0);
  return log.data.value;
}

/** The daily-strip line: "7.5 hrs", "3/5", "Yes", "Not logged yet". Never a
 *  fabricated zero -- EMPTY IS LEGAL holds here exactly as it does for a set
 *  chip (Dave, 2026-08-31: "Wasn't all this supposed to be changed?"). */
export function formatMetric(def: Pick<MetricDefData, "type" | "unit">, log: MetricLog | undefined): string {
  if (def.type === "yesno") return log?.data.yes == null ? "Not logged yet" : (log.data.yes ? "Yes" : "No");
  if (log?.data.value == null) return "Not logged yet";
  if (def.type === "scale5") return `${trim(log.data.value)}/5`;
  if (def.type === "minutes") return `${trim(log.data.value)} min`;
  return def.unit ? `${trim(log.data.value)} ${def.unit}` : trim(log.data.value);
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

/** A fresh def's data, ready for GymService-style create(). Enabling a
 *  preset or building a custom metric are the SAME call: a preset just
 *  pre-fills name/type/unit/presetKey from the library. */
export function newMetricDefData(name: string, type: MetricType, unit: string | undefined, presetKey: string | undefined, today: string, order: number): MetricDefData {
  return { name: name.trim(), type, ...(unit ? { unit } : {}), ...(presetKey ? { presetKey } : {}), order, createdOn: today };
}
