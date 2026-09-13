import type { DoctorReport, ReportKind } from "../doctorReport";
import { shortDate } from "../../shared/dateFormat";

// TAKE THIS TO THE DOCTOR (Part 4; Health Push F, H-47). A plain, dated
// summary of a window the person chooses, family-owned, no interpretation.
// Labeled clearly as the family's own log, never a medical record. Two
// choosers above the preview: the range (six weeks, three months, or two
// dates) and which kinds of row to include. Nothing is ever sent by itself;
// Export hands a text file to the share sheet and Copy puts it on the
// clipboard, both on a tap.
export type ReportRange = "6w" | "3m" | "custom";

export const KIND_LABEL: Record<ReportKind, string> = {
  dose: "Doses",
  lights_out: "Bedtime",
  food: "Ate Before",
  session: "Effort",
  meal: "Meals",
};

export default function DoctorReportScreen({ report, range, onRange, custom, onCustom, kinds, onToggleKind, hasMeals = false, onExport, onCopy, onBack }: {
  report: DoctorReport;
  range: ReportRange;
  onRange: (r: ReportRange) => void;
  /** The two dates for Pick Dates, local ISO days. */
  custom: { from: string; to: string };
  onCustom: (c: { from: string; to: string }) => void;
  kinds: ReportKind[];
  onToggleKind: (k: ReportKind) => void;
  /** Meals is offered only once there is a meal to include. */
  hasMeals?: boolean;
  onExport: () => void;
  // UP-ATH-11 (2026-09-06): the web's way out. A browser with no share sheet
  // cannot hand a file to Messages or Mail, and a report you can see and
  // cannot get out of the page is not an export.
  onCopy?: () => void;
  onBack: () => void;
}) {
  const offered: ReportKind[] = ["dose", "lights_out", "food", "session", ...(hasMeals ? ["meal" as const] : [])];
  return (
    <div className="screen ruled health-ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">Take This to the Doctor</div>
      </div>

      <div className="pad-x"><div className="card pad">
        <div className="p3-q">The Family's Own Log</div>
        <div className="bp-sub">{report.fromDate} through {report.toDate}. Not a medical record, and nothing here is a reading of it.</div>
      </div></div>

      <div className="sh2 sh2-quiet"><span className="t">Range</span></div>
      <div className="pad-x">
        <div className="segmented">
          <button type="button" className={"seg" + (range === "6w" ? " active" : "")} onClick={() => onRange("6w")}>6 Weeks</button>
          <button type="button" className={"seg" + (range === "3m" ? " active" : "")} onClick={() => onRange("3m")}>3 Months</button>
          <button type="button" className={"seg" + (range === "custom" ? " active" : "")} onClick={() => onRange("custom")}>Pick Dates</button>
        </div>
      </div>
      {range === "custom" && (
        <div className="pad-x"><div className="card list-card-ruled">
          <div className="row set-row">
            <div className="conn-name">From</div>
            <input className="set-field" type="date" aria-label="From" value={custom.from} onChange={(e) => onCustom({ ...custom, from: e.target.value })} />
          </div>
          <div className="row set-row">
            <div className="conn-name">To</div>
            <input className="set-field" type="date" aria-label="To" value={custom.to} onChange={(e) => onCustom({ ...custom, to: e.target.value })} />
          </div>
        </div></div>
      )}

      <div className="sh2 sh2-quiet"><span className="t">Include</span></div>
      <div className="pad-x"><div className="chip-row chip-wrap-row" role="group" aria-label="Include">
        {offered.map((k) => {
          const on = kinds.includes(k);
          return (
            <div key={k} className={"chip" + (on ? " active" : "")} role="button" tabIndex={0} aria-pressed={on} onClick={() => onToggleKind(k)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggleKind(k); } }}>{KIND_LABEL[k]}</div>
          );
        })}
      </div></div>

      {report.rows.length === 0 ? (
        <div className="empty-state">
          <div className="empty-title">Nothing in This Window Yet</div>
          <div className="empty-sub">Log a dose, a meal mark, lights out, or a session and it lands here</div>
        </div>
      ) : (
        <div className="pad-x"><div className="card list-card-ruled">
          {report.rows.map((r, i) => (
            <div className="row" key={i}>
              <div className="row-grow">
                <div className="conn-name">{r.label}</div>
                <div className="bp-sub">{shortDate(r.date)}</div>
              </div>
              <div className="row-value">{new Date(r.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>
            </div>
          ))}
        </div></div>
      )}

      {/* EVERY LIST HAS A FLOOR. The rows are all of the window, which is the
          whole claim this page makes to a prescriber. */}
      {report.rows.length > 0 && (
        <div className="pad-x"><div className="bp-sub">That's everything logged between those dates.</div></div>
      )}

      <div className="pad-x"><button className="btn btn-primary btn-block" onClick={onExport}>Export This Log</button></div>
      {onCopy && (
        <div className="pad-x"><button className="btn btn-secondary btn-block" onClick={onCopy}>Copy This Log</button></div>
      )}
      <div className="screen-foot" />
    </div>
  );
}
