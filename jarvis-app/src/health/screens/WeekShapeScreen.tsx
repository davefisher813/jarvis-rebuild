import type { WeekShape } from "../weekShape";
import { weekdayShortDate } from "../../shared/dateFormat";
import BackPill from "../../shared/BackPill";

// WEEK SHAPE (Part 2). The week's sport commitments, flat and honest:
// sessions, hours, which days had none. No ratio, no target, no decline
// framing -- this screen shows days, never a delta from last week.
export default function WeekShapeScreen({ shape, onOpenTwoDaysOff, onBack, backLabel = "Health" }: {
  shape: WeekShape;
  onOpenTwoDaysOff: () => void;
  onBack: () => void;
  /** The screen the back returns to: the Health area the flow was opened from. */
  backLabel?: string;
}) {
  return (
    <div className="screen ruled health-ruled">
      <div className="nav-bar">
        <BackPill label={backLabel} onClick={onBack} />
        <div className="nav-title">Week Shape</div>
      </div>

      <div className="pad-x"><div className="card pad">
        <div className="p3-q">{shape.totalSessions} {shape.totalSessions === 1 ? "Session" : "Sessions"}, {shape.totalHours} {shape.totalHours === 1 ? "Hour" : "Hours"}</div>
        <div className="bp-sub">The week as it actually ran, day by day.</div>
      </div></div>

      <div className="pad-x"><div className="card list-card-ruled">
        {shape.days.map((d) => (
          <div className="row" key={d.date}>
            <div className="row-grow"><div className="conn-name">{weekdayShortDate(d.date)}</div></div>
            {/* Two counts with no state, so each is a white number (§AM) in
                its own fact, and the stylesheet draws the dot between them
                (R6). A day with none says so: that is the screen's point. */}
            <div className="row-value">
              {d.sessions === 0 ? "No Sessions" : (
                <>
                  <span className="fact"><b>{`${d.sessions} ${d.sessions === 1 ? "Session" : "Sessions"}`}</b></span>
                  <span className="fact"><b>{`${d.hours} ${d.hours === 1 ? "Hour" : "Hours"}`}</b></span>
                </>
              )}
            </div>
          </div>
        ))}
      </div></div>

      <div className="pad-x"><button className="btn btn-secondary btn-block" onClick={onOpenTwoDaysOff}>Check Rest Days</button></div>
      <div className="screen-foot" />
    </div>
  );
}
