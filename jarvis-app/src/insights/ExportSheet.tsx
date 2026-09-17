import { useState } from "react";
import { createPortal } from "react-dom";
import { CATEGORIES, CATEGORY_LABEL, filterRecords, type DataCategory, type DataRecord } from "./records";
import { periodFor, periodOverview, type RangeKey, type Period } from "./analytics";
import { buildCsv, buildSummary, exportFilename } from "./exportData";
import { saveTextFile } from "../shared/saveTextFile";
import { showToast } from "../shared/toast";
import { pressable } from "../shared/pressable";
import type { Workout } from "../gym/types";
import type { MetricDef, MetricLog } from "../gym/metrics";

// EXPORT DATA (2026-09-14, item 11). The current category and period come
// in as the defaults; both can be changed here. CSV is the records; Summary
// is the period in readable text with its notes. A real file every time,
// through the share sheet where there is one and a download where there
// is not. A dismissed share sheet is a cancel and says nothing; success is
// said only when the file left.
export default function ExportSheet({ records, workouts, sleepDef, logs, today, period: initialPeriod, category, onClose }: {
  records: DataRecord[];
  workouts: Workout[];
  sleepDef: MetricDef | null;
  logs: MetricLog[];
  today: string;
  period: Period;
  /** The category on screen when Export was tapped, or all. */
  category: DataCategory | "all";
  onClose: () => void;
}) {
  const [range, setRange] = useState<RangeKey>(initialPeriod.key);
  const [custom, setCustom] = useState({ from: initialPeriod.from, to: initialPeriod.to });
  const [cats, setCats] = useState<DataCategory[]>(category === "all" ? [...CATEGORIES] : [category]);
  const [format, setFormat] = useState<"csv" | "summary">("csv");
  const [busy, setBusy] = useState(false);
  const period = periodFor(range, today, custom);
  const rows = filterRecords(records, { category: "all", period, date: null, query: "" });
  const count = rows.filter((r) => cats.includes(r.category)).length;
  const toggle = (c: DataCategory) => setCats((xs) => (xs.includes(c) ? xs.filter((x) => x !== c) : [...xs, c]));
  const run = async () => {
    if (busy || cats.length === 0) return;
    setBusy(true);
    try {
      const text = format === "csv" ? buildCsv(rows, cats) : buildSummary(periodOverview(workouts, sleepDef, logs, period), rows, cats);
      const name = exportFilename(format, period, cats);
      const sent = await saveTextFile(text, name, { title: "JARVIS health data", mime: format === "csv" ? "text/csv;charset=utf-8" : "text/plain;charset=utf-8" });
      if (sent) { showToast({ message: `${name} exported` }); onClose(); }
    } catch {
      showToast({ message: "The export did not leave the app · Try the other format" });
    } finally {
      setBusy(false);
    }
  };
  const chip = (on: boolean, label: string, onPick: () => void, key: string) => (
    <div key={key} {...pressable(onPick)} className={"chip" + (on ? " active" : "")} aria-pressed={on}>{label}</div>
  );
  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Export Data</div></div>
        <div className="pad-x sheet-form">
          <div className="field">
            <div className="input-label">Period</div>
            <div className="chip-row chip-wrap-row" role="group" aria-label="Period">
              {chip(range === "7d", "7 Days", () => setRange("7d"), "7d")}
              {chip(range === "30d", "30 Days", () => setRange("30d"), "30d")}
              {chip(range === "90d", "90 Days", () => setRange("90d"), "90d")}
              {chip(range === "custom", "Custom", () => setRange("custom"), "custom")}
            </div>
            {range === "custom" && (
              <div className="ins-dates">
                <input className="input" type="date" aria-label="From" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
                <input className="input" type="date" aria-label="Through" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
              </div>
            )}
          </div>
          <div className="field">
            <div className="input-label">Include</div>
            <div className="chip-row chip-wrap-row" role="group" aria-label="What to include">
              {CATEGORIES.map((c) => chip(cats.includes(c), CATEGORY_LABEL[c], () => toggle(c), c))}
            </div>
          </div>
          <div className="field">
            <div className="input-label">Format</div>
            <div className="segmented">
              <button type="button" className={"seg" + (format === "csv" ? " active" : "")} onClick={() => setFormat("csv")}>CSV</button>
              <button type="button" className={"seg" + (format === "summary" ? " active" : "")} onClick={() => setFormat("summary")}>Summary</button>
            </div>
            <div className="facts">
              <span className="fact cyan">{`${count} ${count === 1 ? "record" : "records"}`}</span>
              <span className="fact">{format === "csv" ? "Every record with its date, value, unit and source" : "The period in plain text, with how each number was made"}</span>
            </div>
            <div className="facts"><span className="fact">PDF is not offered: the web app ships no PDF library, and a renamed file is not one</span></div>
          </div>
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-launch btn-block" disabled={busy || cats.length === 0} onClick={() => void run()}>{busy ? "Preparing" : "Export File"}</button>
          <button className="btn btn-tertiary btn-block" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
