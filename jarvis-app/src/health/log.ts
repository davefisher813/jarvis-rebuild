import type { LightsOutEntry, TookItEntry, CallItEntry, PointAtItEntry, MedDefEntry, MealEntry, CheckInEntry } from "./types";
import { checkInLine } from "./checkin";
import type { Workout } from "../gym/types";
import type { MetricDef, MetricLog } from "../gym/metrics";
import { hueForMetric, type HueKind } from "./hue";
import { workoutMinutes } from "../gym/summary";
import { capAfterNumber } from "../shared/casing";

// TODAY'S LOG, IN ORDER (Health Push C, H-48, Dave's picks 2026-09-12). One
// list of what he actually wrote down today, across the loggers, the gym and
// his own metrics, oldest first, each row carrying the hue of what it is and
// the way back to the screen that made it. Pure, and read from the same
// records the tiles read, so a tile and the log can never disagree.

export type LogOpen =
  | { kind: "lightsOut" | "tookIt" | "callIt" | "pointAtIt" | "meal" | "checkin" }
  | { kind: "workout"; id: string }
  | { kind: "metric"; defId: string };

export interface LogRow {
  id: string;
  /** What the row measures, which decides its hue (health/hue.ts). */
  kind: HueKind;
  /** The tile's own hue for a metric row, the kind's for everything else. */
  hue?: string;
  title: string;
  at: number;
  /** One fact beside the time, or null. */
  detail: string | null;
  open: LogOpen;
}

export interface LogInputs {
  day: string;
  lightsOut: LightsOutEntry[];
  tookIt: TookItEntry[];
  callIt: CallItEntry[];
  pointAtIt: PointAtItEntry[];
  workouts: Workout[];
  metricDefs: MetricDef[];
  metricLogs: MetricLog[];
  /** Health Push D: the meds by name, so a dose row can say which. */
  medDefs?: MedDefEntry[];
  meals?: MealEntry[];
  /** 2026-09-14: the check-ins, two words and a note. */
  checkins?: CheckInEntry[];
}

/** The local day's [start, end) in epoch ms. */
export function dayBounds(day: string): { start: number; end: number } {
  const start = new Date(day + "T00:00:00").getTime();
  const d = new Date(day + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return { start, end: d.getTime() };
}

const trim = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(1))));

export function chronologicalLog(inp: LogInputs): LogRow[] {
  const { start, end } = dayBounds(inp.day);
  const inDay = (at: number) => at >= start && at < end;
  const rows: LogRow[] = [];
  for (const e of inp.lightsOut) if (inDay(e.data.at)) rows.push({ id: "lo-" + e.id, kind: "sleep", title: "Bedtime", at: e.data.at, detail: null, open: { kind: "lightsOut" } });
  const medById = new Map((inp.medDefs ?? []).map((d) => [d.id, d] as const));
  for (const e of inp.tookIt) {
    if (!inDay(e.data.at)) continue;
    const def = e.data.medId ? medById.get(e.data.medId) : undefined;
    rows.push({ id: "ti-" + e.id, kind: "medication", title: def?.data.name ?? "Dose", at: e.data.at, detail: e.data.amount ?? def?.data.amount ?? null, open: { kind: "tookIt" } });
  }
  for (const e of inp.meals ?? []) if (inDay(e.data.at)) rows.push({ id: "me-" + e.id, kind: "meal", title: "Meal", at: e.data.at, detail: e.data.text, open: { kind: "meal" } });
  for (const e of inp.checkins ?? []) if (inDay(e.data.at)) rows.push({ id: "ck-" + e.id, kind: "reading", title: "Check In", at: e.data.at, detail: checkInLine(e.data), open: { kind: "checkin" } });
  for (const e of inp.callIt) if (inDay(e.data.at)) rows.push({ id: "ci-" + e.id, kind: "reading", title: "Session Effort", at: e.data.at, detail: `${e.data.rpe}/10`, open: { kind: "callIt" } });
  for (const e of inp.pointAtIt) if (inDay(e.data.at)) rows.push({ id: "pa-" + e.id, kind: "discomfort", title: "Discomfort", at: e.data.at, detail: null, open: { kind: "pointAtIt" } });
  for (const w of inp.workouts) {
    if (w.data.date !== inp.day) continue;
    rows.push({ id: "w-" + w.id, kind: "sets", title: w.data.dayName, at: w.data.endedAt, detail: capAfterNumber(`${workoutMinutes(w.data)} min`), open: { kind: "workout", id: w.id } });
  }
  const defById = new Map(inp.metricDefs.map((d) => [d.id, d] as const));
  for (const l of inp.metricLogs) {
    if (l.data.date !== inp.day) continue;
    const def = defById.get(l.data.metricId);
    if (!def || def.data.hidden) continue;
    const d = def.data;
    const detail = d.type === "yesno"
      ? (l.data.yes == null ? null : l.data.yes ? "Yes" : "No")
      : l.data.value == null ? null
      : d.type === "scale5" ? `${trim(l.data.value)}/5`
      : d.type === "minutes" ? capAfterNumber(`${trim(l.data.value)} min`)
      : `${trim(l.data.value)}${d.unit ? " " + d.unit : ""}`;
    rows.push({ id: "m-" + l.id, kind: "reading", hue: hueForMetric(def), title: d.name, at: l.data.at, detail, open: { kind: "metric", defId: def.id } });
  }
  return rows.sort((a, b) => a.at - b.at);
}
