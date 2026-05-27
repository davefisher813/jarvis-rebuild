import { AREA_META, GOAL_META, type Area, type Goal } from "./types";

const CHEV = <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>;
const PLUS = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;

export default function AreaDetailPage({ area, goals, onBack, onEdit, onOpenGoal, onAddGoal }: {
  area: Area; goals: Goal[]; onBack: () => void; onEdit: () => void; onOpenGoal: (id: string) => void; onAddGoal: () => void;
}) {
  const m = AREA_META[area.data.state];
  const mine = goals.filter((g) => g.data.areaId === area.id);
  return (
    <div className="screen">
      <div className="nav-bar"><button className="nav-back" aria-label="Back" onClick={onBack}></button><div className="nav-title">{area.data.name}</div><button className="nav-action-text" onClick={onEdit}>Edit</button></div>
      <div className="pad-x"><div className="card lm-row">
        <div className="lm-main">
          <div className="lm-top"><div className="lm-name">{area.data.name}</div><div className={"lm-qual lm-" + m.cls}>{m.label}</div></div>
          <div className="lm-bar"><div className={"lm-bar-fill lm-" + m.cls + "-bg"} style={{ width: m.pct + "%" }} /></div>
        </div>
      </div></div>
      <div className="sec-head"><div className="sec-left"><div className="sec-title">Goals in this area</div></div></div>
      <div className="pad-x"><div className="card">
        {mine.map((g) => {
          const gm = GOAL_META[g.data.state];
          return (
            <div className="row" role="button" tabIndex={0} key={g.id} onClick={() => onOpenGoal(g.id)}>
              <div className="row-grow"><div className="conn-name">{g.data.title}</div></div>
              <span className={"lm-qual lm-" + gm.cls}>{gm.label}</span>{CHEV}
            </div>
          );
        })}
        <div className="row ob-addrow" role="button" tabIndex={0} onClick={onAddGoal}>
          <div className="sec-ico ico-accent">{PLUS}</div><div className="row-grow"><div className="conn-name">Add Goal</div></div>
        </div>
      </div></div>
      <div className="screen-foot" />
    </div>
  );
}
