import { useState } from "react";
import type { LightsOutEntry } from "../types";

// LIGHTS OUT (Part 1). One tap, one timestamp, marks the night's end.
// Nothing is scored: no duration shown, no streak, no ring. The screen's
// entire job is the tap; the offer this screen ends on IS the button.
export default function LightsOutScreen({ last, onLog, onBack }: {
  last: LightsOutEntry | null;
  onLog: () => void;
  onBack: () => void;
}) {
  const [justTapped, setJustTapped] = useState(false);

  const tap = () => {
    onLog();
    setJustTapped(true);
  };

  return (
    <div className="screen ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">Lights Out</div>
      </div>

      <div className="pad-x"><div className="card pad">
        <div className="p3-q">One Tap, One Time</div>
        <div className="bp-sub">Marks the night's end. Nothing is scored, and nothing is compared to last night.</div>
      </div></div>

      <div className="pad-x">
        {justTapped ? (
          <div className="card pad">
            <div className="conn-name">Logged</div>
            <div className="bp-sub">Good night.</div>
            <button className="btn btn-secondary btn-block" onClick={onBack}>Done</button>
          </div>
        ) : (
          <button className="btn btn-primary btn-block btn-lg" onClick={tap}>Lights Out</button>
        )}
      </div>

      {last && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Last Time</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            <div className="row"><div className="row-grow"><div className="conn-name">{new Date(last.data.at).toLocaleString()}</div></div></div>
          </div></div>
        </>
      )}
      <div className="screen-foot" />
    </div>
  );
}
