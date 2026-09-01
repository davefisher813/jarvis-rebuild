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
