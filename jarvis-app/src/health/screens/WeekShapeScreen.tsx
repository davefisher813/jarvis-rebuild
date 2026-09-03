import type { WeekShape } from "../weekShape";

// WEEK SHAPE (Part 2). The week's sport commitments, flat and honest:
// sessions, hours, which days had none. No ratio, no target, no decline
// framing -- this screen shows days, never a delta from last week.
export default function WeekShapeScreen({ shape, onOpenTwoDaysOff, onBack }: {
  shape: WeekShape;
  onOpenTwoDaysOff: () => void;
  onBack: () => void;
}) {
  return (
    <div className="screen ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">Week Shape</div>
      </div>

      <div className="pad-x"><div className="card pad">
        <div className="p3-q">{shape.totalSessions} Sessions, {shape.totalHours} Hours</div>
        <div className="bp-sub">The week as it actually ran, day by day.</div>
      </div></div>

      <div className="pad-x"><div className="card list-card-ruled">
        {shape.days.map((d) => (
          <div className="row" key={d.date}>
            <div className="row-grow"><div className="conn-name">{d.date}</div></div>
            <div className="row-value">{d.sessions === 0 ? "No Sessions" : d.sessions + " · " + d.hours + " Hours"}</div>
          </div>
        ))}
      </div></div>

      <div className="pad-x"><button className="btn btn-secondary btn-block" onClick={onOpenTwoDaysOff}>Check Rest Days</button></div>
      <div className="screen-foot" />
    </div>
  );
}
