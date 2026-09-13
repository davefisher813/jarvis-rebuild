import { useState } from "react";
import type { RefillState } from "../refillRunway";
import { needsRefillCall, refillOffer } from "../refillRunway";
import { shortDateFromMs } from "../../shared/dateFormat";

// REFILL RUNWAY (Part 4, top 3; Health Push D). Counts down remaining doses
// from real Took It taps, and lands the pharmacy call as an offer on the
// PARENT's list, never a badge on the athlete's. Pure logistics: no
// medication is ever named on this screen. The fill is three facts in
// medication blue (filled when, how many came, how many taken since) and two
// tiles (doses left, runway); the form takes the day it was received, so a
// fill logged on Tuesday for a bottle picked up Sunday counts from Sunday.
export default function RefillRunwayScreen({
  state, onLogFill, onLandParentTask, onBack,
}: {
  state: RefillState;
  onLogFill: (dosesInFill: number, filledAt: number) => void;
  onLandParentTask: () => void;
  onBack: () => void;
}) {
  const [count, setCount] = useState("30");
  const [received, setReceived] = useState(localDay());
  const offer = refillOffer(state);
  const valid = Number(count) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(received);

  return (
    <div className="screen ruled health-ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">Refill Runway</div>
      </div>

      <div className="pad-x"><div className="card pad">
        {state.hasFill ? (
          <>
            <div className="facts">
              {state.filledAt !== undefined && <span className="fact hblue">Filled {shortDateFromMs(state.filledAt)}</span>}
              <span className="fact">{state.dosesInFill} received</span>
              <span className="fact">{state.taken} taken since</span>
            </div>
            <div className="stat-row stat-row-gap stat-hblue">
              <div className="stat-tile"><div className="stat-num">{state.remaining}</div><div className="stat-label">Doses Left</div></div>
              <div className="stat-tile"><div className="stat-num">{state.runwayDays !== undefined ? state.runwayDays : "Not Yet"}</div><div className="stat-label">{state.runwayDays !== undefined ? "Days of Runway" : "Runway"}</div></div>
            </div>
            <div className="bp-sub">Counted from real taps on Took It, never a guess.</div>
          </>
        ) : (
          <>
            <div className="p3-q">No Fill Logged Yet</div>
            <div className="bp-sub">Log what the pharmacy filled and this counts down on its own.</div>
          </>
        )}
      </div></div>

      {needsRefillCall(state) && offer && (
        <div className="pad-x"><div className="card pad">
          <div className="conn-name">Worth a Call Soon</div>
          <div className="bp-sub">Lands on the parent's list, not here.</div>
          <button className="btn btn-primary btn-block" onClick={onLandParentTask}>Land It on the Parent's List</button>
        </div></div>
      )}

      <div className="sh2 sh2-quiet"><span className="t">Log a New Fill</span></div>
      <div className="pad-x"><div className="card pad">
        <div className="field">
          <div className="input-label">Doses in This Fill</div>
          <input className="input" type="number" inputMode="numeric" min={1} value={count} onChange={(e) => setCount(e.target.value)} aria-label="Doses in this fill" />
        </div>
        <div className="field">
          <div className="input-label">Received On</div>
          <input className="input" type="date" value={received} onChange={(e) => setReceived(e.target.value)} aria-label="Received on" />
        </div>
        <button
          className="btn btn-secondary btn-block"
          disabled={!valid}
          onClick={() => onLogFill(Number(count), new Date(received + "T12:00:00").getTime())}
        >
          Log the Fill
        </button>
      </div></div>

      <div className="screen-foot" />
    </div>
  );
}

function localDay(atMs: number = Date.now()): string {
  const d = new Date(atMs);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
