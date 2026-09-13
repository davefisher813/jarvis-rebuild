// TAKE THIS TO THE DOCTOR (catalog Part 4). A plain, dated summary of the
// last N weeks: doses taken and when, food marks, lights-out times, and
// sessions. Family-owned, no interpretation -- this file only selects and
// sorts what was actually logged inside the window; it computes no average,
// no adherence rate, no verdict about any of it. The screen labels the
// output as the family's own log, never a medical record.
//
// Deliberately does not compute "sleep hours": Lights Out logs a bedtime
// tap, never a wake time (catalog Part 1, "Hours You Got" is a separate,
// unbuilt item), so this reports the bedtime marks it actually has rather
// than inventing a duration nothing here measured.

import type { AteBeforeEntry, CallItEntry, LightsOutEntry, TookItEntry, MealEntry, MedDefEntry } from "./types";

export type ReportKind = "dose" | "food" | "lights_out" | "session" | "meal";
export const ALL_REPORT_KINDS: ReportKind[] = ["dose", "food", "lights_out", "session", "meal"];

export interface DoctorReportRow {
  date: string; // local ISO day
  at: number;
  kind: ReportKind;
  label: string;
}

/** Health Push F (H-47): the window and the kinds the person chose. Epoch
 *  ms, inclusive on both ends; kinds absent means every kind. */
export interface ReportOptions {
  from: number;
  to: number;
  kinds?: ReportKind[];
}

export interface DoctorReport {
  fromDate: string;
  toDate: string;
  generatedAt: number;
  rows: DoctorReportRow[]; // every logged row inside the window, sorted by time
}

function localDay(atMs: number): string {
  const d = new Date(atMs);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

const WEEK_MS = 7 * 86400000;

export function buildDoctorReport(
  input: { tookIt: TookItEntry[]; ateBefore: AteBeforeEntry[]; lightsOut: LightsOutEntry[]; callIt: CallItEntry[]; meals?: MealEntry[]; medDefs?: MedDefEntry[] },
  // The pre-H-47 shape (a count of weeks back from now) still works; the
  // choosers hand in a ReportOptions instead.
  weeksOrOpts: number | ReportOptions = 6,
  now: number = Date.now(),
): DoctorReport {
  const opts: ReportOptions = typeof weeksOrOpts === "number" ? { from: now - weeksOrOpts * WEEK_MS, to: now } : weeksOrOpts;
  const { from, to } = opts;
  const want = new Set<ReportKind>(opts.kinds ?? ALL_REPORT_KINDS);
  const inWindow = (at: number) => at >= from && at <= to;
  const medById = new Map((input.medDefs ?? []).map((d) => [d.id, d] as const));
  const rows: DoctorReportRow[] = [];
  if (want.has("dose")) for (const t of input.tookIt) {
    if (!inWindow(t.data.at)) continue;
    // H-47: the med's name and amount when the tap named one.
    const def = t.data.medId ? medById.get(t.data.medId) : undefined;
    const amount = t.data.amount ?? def?.data.amount;
    const label = def ? def.data.name + (amount ? " · " + amount : "") : "Dose Logged";
    rows.push({ date: localDay(t.data.at), at: t.data.at, kind: "dose", label });
  }
  if (want.has("food")) for (const a of input.ateBefore) {
    if (!inWindow(a.data.at)) continue;
    rows.push({ date: a.data.date, at: a.data.at, kind: "food", label: a.data.ate ? "Ate Before" : "Did Not Eat Before" });
  }
  if (want.has("lights_out")) for (const l of input.lightsOut) {
    if (!inWindow(l.data.at)) continue;
    rows.push({ date: localDay(l.data.at), at: l.data.at, kind: "lights_out", label: "Lights Out" });
  }
  if (want.has("session")) for (const c of input.callIt) {
    if (!inWindow(c.data.at)) continue;
    rows.push({ date: localDay(c.data.at), at: c.data.at, kind: "session", label: "Session, Effort " + c.data.rpe + " Of 10" });
  }
  if (want.has("meal")) for (const m of input.meals ?? []) {
    if (!inWindow(m.data.at)) continue;
    rows.push({ date: localDay(m.data.at), at: m.data.at, kind: "meal", label: "Meal · " + m.data.text });
  }
  rows.sort((a, b) => a.at - b.at);
  return { fromDate: localDay(from), toDate: localDay(to), generatedAt: now, rows };
}

/** The two dates a range chooser means, local, inclusive. */
export function reportWindow(range: "6w" | "3m" | "custom", custom: { from: string; to: string }, now: number = Date.now()): { from: number; to: number } {
  if (range === "custom") {
    const from = new Date(custom.from + "T00:00:00").getTime();
    const to = new Date(custom.to + "T23:59:59.999").getTime();
    if (Number.isFinite(from) && Number.isFinite(to) && from <= to) return { from, to };
  }
  return { from: now - (range === "3m" ? 13 * WEEK_MS : 6 * WEEK_MS), to: now };
}

/** Plain text export -- one line per row, dated, nothing interpreted. What
 *  a family hands a prescriber at the med check. */
export function doctorReportText(report: DoctorReport): string {
  const lines = [
    "The Family's Own Log",
    report.fromDate + " through " + report.toDate,
    "Not a medical record · a plain record of what was logged, no reading attached",
    "",
  ];
  for (const r of report.rows) {
    lines.push(r.date + "  " + new Date(r.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + "  " + r.label);
  }
  return lines.join("\n");
}
