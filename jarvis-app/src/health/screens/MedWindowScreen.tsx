import type { MedWindowDay, MedWindowMarkKind } from "../medWindow";
import { weekdayShortDate } from "../../shared/dateFormat";

const MARK_LABEL: Record<MedWindowMarkKind, string> = {
  dose: "Dose",
  food: "Food",
  session: "Session Start",
  lights_out: "Lights Out",
};

// THE MED WINDOW (Part 4). One horizontal timeline per day, four marks. No
// analysis, no correlation claim, no arrow drawn between any two marks: this
// screen renders exactly the facts medWindow.ts hands it, in the order they
// happened, and nothing that reads a relationship between them.
export default function MedWindowScreen({ days, hasFood = true, onOpenDoctorReport, onBack }: {
  days: MedWindowDay[];
  /** Whether any food mark exists to draw (2026-10-04). Food comes only from
   *  Ate Before, which the app does not record while it stays dormant, so the
   *  header named a fact that could never appear. False says three. */
  hasFood?: boolean;
  onOpenDoctorReport: () => void;
  onBack: () => void;
}) {
  return (
    <div className="screen ruled health-ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">The Med Window</div>
      </div>

      <div className="pad-x"><div className="card pad">
        <div className="p3-q">{hasFood ? "Four Facts a Day" : "Three Facts a Day"}</div>
        <div className="bp-sub">{hasFood ? "Dose, food, session start, lights out" : "Dose, session start, lights out"} · nothing compared, nothing explained</div>
      </div></div>

      {days.length === 0 ? (
        <div className="empty-state">
          <div className="empty-title">Nothing Logged Yet</div>
          <div className="empty-sub">A day with any of the {hasFood ? "four" : "three"} facts shows up here</div>
        </div>
      ) : (
        days.map((day) => (
          <div key={day.date}>
            <div className="sh2 sh2-quiet"><span className="t">{weekdayShortDate(day.date)}</span></div>
            <div className="pad-x"><div className="card list-card-ruled">
              {day.marks.map((m, i) => (
                <div className="row" key={i}>
                  <div className="row-grow">
                    <div className="conn-name">{MARK_LABEL[m.kind]}</div>
                    {/* The time is a neutral time, small caps (§AM F5), and
                        comes first so a long label is the fact that gives
                        way. The dot between them is CSS's (F3). */}
                    <div className="facts">
                      <span className="fact date">{new Date(m.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                      {m.label !== MARK_LABEL[m.kind] && <span className="fact">{m.label}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div></div>
          </div>
        ))
      )}
      <div className="pad-x"><button className="btn btn-secondary btn-block" onClick={onOpenDoctorReport}>Take This to the Doctor</button></div>
      <div className="screen-foot" />
    </div>
  );
}
