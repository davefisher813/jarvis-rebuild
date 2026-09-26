import type { Workout } from "../gym/types";
import type { MetricDef, MetricLog } from "../gym/metrics";
import type { LightsOutEntry, TookItEntry, CallItEntry, PointAtItEntry, MealEntry, CheckInEntry, MedDefEntry } from "../health/types";
import { formatSet } from "../gym/measures";
import { checkInLine } from "../health/checkin";
import { durationOf, workingSetsIn, inPeriod, type Period } from "./analytics";

// ALL DATA (the approved Health design, 2026-09-14, item 8): one list of
// every record the app keeps about the person, in categories, with its
// date, unit and source, and the way to open, edit or delete it. Pure:
// the page filters and groups; the caller owns the writes.

export type DataCategory = "workouts" | "sets" | "sleep" | "body" | "effort" | "nutrition" | "medication" | "checkins" | "other";

export const CATEGORY_LABEL: Record<DataCategory, string> = {
  workouts: "Workouts",
  sets: "Exercises and Sets",
  sleep: "Sleep",
  body: "Body",
  effort: "Effort and Discomfort",
  nutrition: "Nutrition",
  medication: "Medication",
  checkins: "Check Ins",
  other: "Other Metrics",
};
export const CATEGORIES: DataCategory[] = ["workouts", "sets", "sleep", "body", "effort", "nutrition", "medication", "checkins", "other"];

export type RecordOpen =
  | { kind: "workout"; id: string }
  | { kind: "metric"; def: MetricDef; log: MetricLog }
  | { kind: "lightsOut"; at: number; id: string; pending?: boolean }
  | { kind: "tookIt"; at: number; pending?: boolean }
  | { kind: "callIt"; at: number }
  | { kind: "pointAtIt"; at: number }
  | { kind: "meal"; at: number; pending?: boolean }
  | { kind: "checkin"; at: number; pending?: boolean };

export interface DataRecord {
  id: string;
  category: DataCategory;
  /** Local ISO day the record belongs to. */
  date: string;
  /** The moment, for ordering inside a day. */
  at: number;
  title: string;
  /** The reading, with its unit. Null when the record is a fact with none. */
  value: string | null;
  /** One more fact beside the reading. */
  detail: string | null;
  /** WHAT NEEDS A LOOK, KEPT OUT OF THE DETAIL (§AM, 2026-09-26). A workout
   *  whose duration crossed the review threshold said so inside `detail`,
   *  after a baked middot, as a second grey clause on a line that had already
   *  spent its one. The row now says it in the key's amber on the minutes
   *  themselves; the words live here, for search, the export and the row's
   *  accessible name. Absent on every record with nothing to review. */
  review?: string;
  source: "Logged by hand" | "Imported" | "Waiting to sync";
  hue: "lime" | "amber" | "violet" | "cyan" | "hblue" | "pink";
  open: RecordOpen;
  /** THE SETS, AS A TABLE RATHER THAN A SENTENCE (2026-09-16, the polish
   *  handoff: "All Data: expandable set tables"). A lift's record used to put
   *  every set on the row, joined by commas, so five sets of a pyramid wrapped
   *  three grey lines in a list whose whole job is scanning. The row says how
   *  many; the lines are behind the row's own disclosure, one per set, each
   *  named. Absent on every record that is not a lift's sets. */
  sets?: { label: string; text: string; warm?: true }[];
}

export interface RecordInputs {
  workouts: Workout[];
  metricDefs: MetricDef[];
  metricLogs: MetricLog[];
  lightsOut: (LightsOutEntry & { pending?: boolean })[];
  tookIt: (TookItEntry & { pending?: boolean })[];
  medDefs: MedDefEntry[];
  callIt: CallItEntry[];
  pointAtIt: PointAtItEntry[];
  meals: (MealEntry & { pending?: boolean })[];
  checkins: (CheckInEntry & { pending?: boolean })[];
}

function localDay(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const NUTRITION_PRESETS = new Set(["water", "hydration", "protein", "caffeine"]);
const BODY_PRESETS = new Set(["bodyweight", "restingHR", "steps"]);

/** Which category a metric belongs to, by what it measures. */
export function metricCategory(def: MetricDef): DataCategory {
  const k = def.data.presetKey ?? "";
  if (k === "sleep") return "sleep";
  if (BODY_PRESETS.has(k)) return "body";
  if (NUTRITION_PRESETS.has(k)) return "nutrition";
  return "other";
}

const trim = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(1))));

export function allRecords(inp: RecordInputs): DataRecord[] {
  const out: DataRecord[] = [];
  for (const w of inp.workouts) {
    const d = durationOf(w.data);
    const sets = w.data.exercises.reduce((n, ex) => n + workingSetsIn(ex), 0);
    out.push({
      id: "w-" + w.id, category: "workouts", date: w.data.date, at: w.data.endedAt,
      title: w.data.dayName, value: `${d.activeMin} min`, detail: `${sets} ${sets === 1 ? "working set" : "working sets"}`,
      ...(d.flagged ? { review: "Duration needs review" } : {}),
      source: w.data.source ? "Imported" : "Logged by hand", hue: d.flagged ? "amber" : "lime", open: { kind: "workout", id: w.id },
    });
    for (const ex of w.data.exercises) {
      if (ex.skipped) continue;
      const working = ex.sets.filter((s) => !s.skipped && !s.warmup && !s.drop);
      if (working.length === 0) continue;
      // THE WARM-UP IS IN THE TABLE, AND SAYS SO (2026-09-16, the polish
      // handoff: "Preserve warm-up vs working-set distinction when present").
      // The COUNT stays the working sets, because a ramp counts toward
      // nothing (D3-A) and this record's headline number has always been the
      // work. But the table is a record of what happened, and a session where
      // the athlete ramped four times before the first work set is not the
      // same session as one where they did not. It is there, named, after the
      // work -- never mixed into the numbering, which would make Set 1 a
      // warm-up.
      const ramp = ex.sets.filter((s) => !s.skipped && s.warmup);
      const drops = ex.sets.filter((s) => !s.skipped && s.drop && !s.warmup);
      out.push({
        id: "s-" + w.id + "-" + ex.exerciseId, category: "sets", date: w.data.date, at: w.data.endedAt,
        title: ex.name, value: `${working.length} ${working.length === 1 ? "set" : "sets"}`,
        // `detail` stays the full listing: it is what the search reads, and a
        // lift found by typing "205" has to be findable whether or not its
        // table is open. The PAGE draws the table instead of this string.
        detail: working.map((s) => formatSet(ex, s)).join(", "),
        sets: [
          ...working.map((s, i) => ({ label: `Set ${i + 1}`, text: formatSet(ex, s) })),
          ...drops.map((s) => ({ label: "Drop", text: formatSet(ex, s), warm: true as const })),
          ...ramp.map((s) => ({ label: "Warm-Up", text: formatSet(ex, s), warm: true as const })),
        ],
        source: w.data.source ? "Imported" : "Logged by hand", hue: "lime", open: { kind: "workout", id: w.id },
      });
    }
  }
  const defById = new Map(inp.metricDefs.map((d) => [d.id, d] as const));
  for (const l of inp.metricLogs) {
    const def = defById.get(l.data.metricId);
    if (!def) continue;
    const cat = metricCategory(def);
    const value = def.data.type === "yesno" ? (l.data.yes == null ? null : l.data.yes ? "Yes" : "No")
      : l.data.value == null ? null
      : def.data.type === "scale5" ? `${trim(l.data.value)}/5`
      : def.data.type === "minutes" ? `${trim(l.data.value)} min`
      : `${trim(l.data.value)}${def.data.unit ? " " + def.data.unit : ""}`;
    out.push({
      id: "m-" + l.id, category: cat, date: l.data.date, at: l.data.at,
      title: def.data.name, value, detail: null, source: "Logged by hand",
      hue: cat === "sleep" ? "violet" : "cyan", open: { kind: "metric", def, log: l },
    });
  }
  for (const e of inp.lightsOut) out.push({ id: "lo-" + e.id, category: "sleep", date: localDay(e.data.at), at: e.data.at, title: "Bedtime", value: null, detail: null, source: e.pending ? "Waiting to sync" : "Logged by hand", hue: "violet", open: { kind: "lightsOut", at: e.data.at, id: e.id, pending: e.pending } });
  const medById = new Map(inp.medDefs.map((d) => [d.id, d] as const));
  for (const e of inp.tookIt) {
    const def = e.data.medId ? medById.get(e.data.medId) : undefined;
    out.push({ id: "ti-" + e.id, category: "medication", date: localDay(e.data.at), at: e.data.at, title: def?.data.name ?? "Dose", value: e.data.amount ?? def?.data.amount ?? null, detail: null, source: e.pending ? "Waiting to sync" : "Logged by hand", hue: "hblue", open: { kind: "tookIt", at: e.data.at, pending: e.pending } });
  }
  for (const e of inp.callIt) out.push({ id: "ci-" + e.id, category: "effort", date: localDay(e.data.at), at: e.data.at, title: "Session Effort", value: `${e.data.rpe}/10`, detail: e.data.durationMin ? `${e.data.durationMin} min` : null, source: "Logged by hand", hue: "cyan", open: { kind: "callIt", at: e.data.at } });
  for (const e of inp.pointAtIt) {
    const words = [e.data.feel === "soreness" ? "Soreness" : e.data.feel === "pain" ? "Pain" : e.data.feel === "stiffness" ? "Stiffness" : null, e.data.level === "mild" ? "Mild" : e.data.level === "moderate" ? "Moderate" : e.data.level === "severe" ? "Severe" : null].filter(Boolean);
    out.push({ id: "pa-" + e.id, category: "effort", date: localDay(e.data.at), at: e.data.at, title: e.data.region ? `Discomfort · ${e.data.region}` : "Discomfort", value: words.length ? words.join(", ") : null, detail: e.data.note ?? null, source: "Logged by hand", hue: "pink", open: { kind: "pointAtIt", at: e.data.at } });
  }
  for (const e of inp.meals) out.push({ id: "me-" + e.id, category: "nutrition", date: localDay(e.data.at), at: e.data.at, title: "Meal", value: null, detail: e.data.text, source: e.pending ? "Waiting to sync" : "Logged by hand", hue: "amber", open: { kind: "meal", at: e.data.at, pending: e.pending } });
  for (const e of inp.checkins) out.push({ id: "ck-" + e.id, category: "checkins", date: localDay(e.data.at), at: e.data.at, title: "Check In", value: checkInLine(e.data), detail: null, source: e.pending ? "Waiting to sync" : "Logged by hand", hue: "cyan", open: { kind: "checkin", at: e.data.at, pending: e.pending } });
  return out.sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at);
}

export interface RecordFilter { category: DataCategory | "all"; period: Period | null; date: string | null; query: string }

export function filterRecords(rows: DataRecord[], f: RecordFilter): DataRecord[] {
  const q = f.query.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.category !== "all" && r.category !== f.category) return false;
    if (f.date && r.date !== f.date) return false;
    if (f.period && !inPeriod(r.date, f.period)) return false;
    if (q && !(`${r.title} ${r.value ?? ""} ${r.detail ?? ""} ${r.review ?? ""}`.toLowerCase().includes(q))) return false;
    return true;
  });
}

export interface DayGroup { date: string; rows: DataRecord[] }
export function groupByDay(rows: DataRecord[]): DayGroup[] {
  const out: DayGroup[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.date === r.date) last.rows.push(r); else out.push({ date: r.date, rows: [r] });
  }
  return out;
}
