import type { Area, Goal } from "./types";
import { AREA_META, GOAL_META } from "./types";

const CHEV = <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>;
const PLUS = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
const TARGET = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /></svg>;

export default function LifeMapPage({ areas, goals, onAddArea, onAddGoal, onOpenArea, onOpenGoal }: {
  areas: Area[]; goals: Goal[];
  onAddArea: () => void; onAddGoal: () => void;
  onOpenArea: (id: string) => void; onOpenGoal: (id: string) => void;
}) {
  if (areas.length === 0 && goals.length === 0) {
    return (
      <div className="screen">
        <div className="nav-bar"><div className="nav-large">Life Map</div></div>
        <div className="empty-state"><div className="empty-icon">{TARGET}</div><div className="empty-title">Map the areas of your life</div>
          <button className="btn btn-primary" onClick={onAddArea}>Add an Area</button></div>
      </div>
    );
  }
  return (
    <div className="screen">
      <div className="nav-bar"><div className="nav-large">Life Map</div></div>
      <div className="page-explainer">A read on each area of your life, at a glance.</div>

      <div className="pad-x"><div className="card">
        {areas.map((a) => {
          const m = AREA_META[a.data.state];
          return (
            <div className="lm-row" role="button" tabIndex={0} key={a.id} onClick={() => onOpenArea(a.id)}>
              <div className="lm-main">
                <div className="lm-top"><div className="lm-name">{a.data.name}</div><div className={"lm-qual lm-" + m.cls}>{m.label}</div></div>
                <div className="lm-bar"><div className={"lm-bar-fill lm-" + m.cls + "-bg"} style={{ width: m.pct + "%" }} /></div>
              </div>
              {CHEV}
            </div>
          );
        })}
        <div className="lm-row ob-addrow" role="button" tabIndex={0} onClick={onAddArea}>
          <div className="sec-ico ico-accent">{PLUS}</div>
          <div className="row-grow"><div className="conn-name">Add Area</div></div>
        </div>
      </div></div>

      <div className="sec-head"><div className="sec-left"><div className="sec-title">Active Goals</div></div></div>
      <div className="pad-x"><div className="card">
        {goals.map((g) => {
          const m = GOAL_META[g.data.state];
          return (
            <div className="row" role="button" tabIndex={0} key={g.id} onClick={() => onOpenGoal(g.id)}>
              <div className="row-grow"><div className="conn-name">{g.data.title}</div></div>
              <span className={"lm-qual lm-" + m.cls}>{m.label}</span>{CHEV}
            </div>
          );
        })}
        <div className="row ob-addrow" role="button" tabIndex={0} onClick={onAddGoal}>
          <div className="sec-ico ico-accent">{PLUS}</div>
          <div className="row-grow"><div className="conn-name">Add Goal</div></div>
        </div>
      </div></div>
      <div className="screen-foot" />
    </div>
  );
}
