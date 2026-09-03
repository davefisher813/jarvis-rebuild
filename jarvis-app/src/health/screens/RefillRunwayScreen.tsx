import { useState } from "react";
import type { RefillState } from "../refillRunway";
import { needsRefillCall, refillOffer } from "../refillRunway";

// REFILL RUNWAY (Part 4, top 3). Counts down remaining doses from real Took
// It taps, and lands the pharmacy call as an offer on the PARENT's list,
// never a badge on the athlete's. Pure logistics: no medication is ever
// named on this screen.
export default function RefillRunwayScreen({
  state, onLogFill, onLandParentTask, onBack,
}: {
  state: RefillState;
  onLogFill: (dosesInFill: number) => void;
  onLandParentTask: () => void;
  onBack: () => void;
}) {
  const [count, setCount] = useState("30");
  const offer = refillOffer(state);

  return (
    <div className="screen ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">Refill Runway</div>
      </div>

      <div className="pad-x"><div className="card pad">
        <div className="p3-q">{state.hasFill ? state.remaining + " Doses Left In This Fill" : "No Fill Logged Yet"}</div>
        <div className="bp-sub">
          {state.hasFill
            ? "Counted from real taps on Took It, never a guess."
            : "Log what the pharmacy filled and this counts down on its own."}
        </div>
      </div></div>

      {needsRefillCall(state) && offer && (
        <div className="pad-x"><div className="card pad">
          <div className="conn-name">Worth A Call Soon</div>
          <div className="bp-sub">Lands on the parent's list, not here.</div>
          <button className="btn btn-primary btn-block" onClick={onLandParentTask}>Land It On The Parent's List</button>
        </div></div>
      )}

      <div className="sh2 sh2-quiet"><span className="t">Log A New Fill</span></div>
      <div className="pad-x"><div className="card pad">
        <div className="field">
          <div className="input-label">Doses In This Fill</div>
          <input className="input" type="number" inputMode="numeric" min={1} value={count} onChange={(e) => setCount(e.target.value)} />
        </div>
        <button
          className="btn btn-secondary btn-block"
          disabled={!Number(count) || Number(count) <= 0}
          onClick={() => onLogFill(Number(count))}
        >
          Log The Fill
        </button>
      </div></div>

      <div className="screen-foot" />
    </div>
  );
}
