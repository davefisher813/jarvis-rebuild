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

import type { AteBeforeEntry, CallItEntry, LightsOutEntry, TookItEntry } from "./types";

export interface DoctorReportRow {
  date: string; // local ISO day
  at: number;
  kind: "dose" | "food" | "lights_out" | "session";
  label: string;
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
  input: { tookIt: TookItEntry[]; ateBefore: AteBeforeEntry[]; lightsOut: LightsOutEntry[]; callIt: CallItEntry[] },
  weeks = 6,
  now: number = Date.now(),
): DoctorReport {
  const from = now - weeks * WEEK_MS;
  const rows: DoctorReportRow[] = [];
  for (const t of input.tookIt) {
    if (t.data.at < from || t.data.at > now) continue;
    rows.push({ date: localDay(t.data.at), at: t.data.at, kind: "dose", label: "Dose Logged" });
  }
  for (const a of input.ateBefore) {
    if (a.data.at < from || a.data.at > now) continue;
    rows.push({ date: a.data.date, at: a.data.at, kind: "food", label: a.data.ate ? "Ate Before" : "Did Not Eat Before" });
  }
  for (const l of input.lightsOut) {
    if (l.data.at < from || l.data.at > now) continue;
    rows.push({ date: localDay(l.data.at), at: l.data.at, kind: "lights_out", label: "Lights Out" });
  }
  for (const c of input.callIt) {
    if (c.data.at < from || c.data.at > now) continue;
    rows.push({ date: localDay(c.data.at), at: c.data.at, kind: "session", label: "Session, Effort " + c.data.rpe + " Of 10" });
  }
  rows.sort((a, b) => a.at - b.at);
  return { fromDate: localDay(from), toDate: localDay(now), generatedAt: now, rows };
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
