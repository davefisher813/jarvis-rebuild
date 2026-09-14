import type { DataRecord, DataCategory } from "./records";
import { CATEGORY_LABEL } from "./records";
import type { PeriodOverview } from "./analytics";
import { hoursLabel } from "./analytics";

// EXPORT (the approved Health design, 2026-09-14, item 11). CSV is the
// underlying records with readable column names, timestamps, units and
// sources, only the categories chosen; the summary is a readable text of
// the period with its coverage and calculation notes. Both are genuine
// files handed to saveTextFile. PDF is not produced: the web app ships no
// PDF library, and an HTML file renamed .pdf is not a PDF.

const q = (s: string | number | null | undefined): string => {
  const t = s == null ? "" : String(s);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, "\"\"")}"` : t;
};

function stamp(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function buildCsv(rows: DataRecord[], categories: DataCategory[]): string {
  const want = new Set(categories);
  const lines = ["Date,Time,Category,Record,Value,Detail,Source"];
  for (const r of rows) {
    if (!want.has(r.category)) continue;
    lines.push([r.date, stamp(r.at).slice(11), CATEGORY_LABEL[r.category], r.title, r.value ?? "", r.detail ?? "", r.source].map(q).join(","));
  }
  return lines.join("\n") + "\n";
}

export function buildSummary(overview: PeriodOverview, rows: DataRecord[], categories: DataCategory[]): string {
  const want = new Set(categories);
  const counts = new Map<DataCategory, number>();
  for (const r of rows) if (want.has(r.category)) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  const out: string[] = [];
  out.push(`JARVIS health summary, ${overview.period.from} to ${overview.period.to}`);
  out.push("");
  if (want.has("workouts") || want.has("sets")) {
    out.push(`Workouts: ${overview.workouts}`);
    out.push(`Working sets: ${overview.workingSets}`);
    out.push(`Training time: ${overview.trainingMin} min (active, parked time excluded)`);
    if (overview.flagged.length > 0) out.push(`Sessions whose duration needs review: ${overview.flagged.length}`);
  }
  if (want.has("sleep")) {
    out.push(overview.sleep.nights > 0 && overview.sleep.avgHours != null
      ? `Sleep: ${hoursLabel(overview.sleep.avgHours)} average across ${overview.sleep.nights} logged nights of ${overview.period.days}`
      : `Sleep: no night logged in this period`);
  }
  out.push("");
  out.push("Records in this export:");
  for (const c of categories) out.push(`  ${CATEGORY_LABEL[c]}: ${counts.get(c) ?? 0}`);
  out.push("");
  out.push("Notes on the numbers:");
  out.push("  A working set is a logged set that is not a warm-up, a drop or a skip, and scores or is marked done.");
  out.push("  A workout is a saved session with at least one working set.");
  out.push("  Minutes are active minutes: the wall clock less any time the session sat parked.");
  out.push("  A night of sleep is dated the morning it ended.");
  out.push("  A day with no log is a gap, never a zero.");
  out.push("  Loads compare only in the unit and under the counting convention they were logged with.");
  return out.join("\n") + "\n";
}

/** A safe filename: letters, digits and dashes. */
export function exportFilename(kind: "csv" | "summary", period: { from: string; to: string }, categories: DataCategory[]): string {
  const cat = categories.length === 1 ? categories[0] : "health";
  return `jarvis-${cat}-${period.from}-to-${period.to}.${kind === "csv" ? "csv" : "txt"}`;
}
