import type { DoctorReport } from "../doctorReport";
import { shortDate } from "../../shared/dateFormat";

// TAKE THIS TO THE DOCTOR (Part 4). A plain, dated summary of the last N
// weeks, family-owned, no interpretation. Labeled clearly as the family's
// own log, never a medical record.
export default function DoctorReportScreen({ report, onExport, onBack }: {
  report: DoctorReport;
  onExport: () => void;
  onBack: () => void;
}) {
  return (
    <div className="screen ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">Take This to the Doctor</div>
      </div>

      <div className="pad-x"><div className="card pad">
        <div className="p3-q">The Family's Own Log</div>
        <div className="bp-sub">{report.fromDate} through {report.toDate}. Not a medical record, and nothing here is a reading of it.</div>
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

      <div className="pad-x"><button className="btn btn-primary btn-block" onClick={onExport}>Export This Log</button></div>
      <div className="screen-foot" />
    </div>
  );
}
