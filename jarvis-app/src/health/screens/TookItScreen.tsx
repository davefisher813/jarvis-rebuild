import { useState } from "react";
import type { MedDefEntry } from "../types";
import type { DoseRow } from "../meds";
import MedRows from "./MedRows";
import DoseTimeline from "./DoseTimeline";

// TOOK IT (Part 4; Health Push D, H-38, H-37). One tap, three seconds,
// offline. Timestamped by the tap itself, never by a schedule: there is no
// "expected dose" concept anywhere near this screen, so there is nothing for
// it to render as a miss count. With meds configured the one button becomes
// one Took It per med (MedRows); the timeline below shows only what
// happened, in order, with Undo on today's.
export default function TookItScreen({ doses, meds = [], now = Date.now(), onLog, onUndo, onBack }: {
  doses: DoseRow[];
  meds?: MedDefEntry[];
  now?: number;
  onLog: (med?: MedDefEntry) => void;
  onUndo?: (row: DoseRow) => void;
  onBack: () => void;
}) {
  const [justTapped, setJustTapped] = useState(false);
  const tap = () => { onLog(); setJustTapped(true); };

  return (
    <div className="screen ruled health-ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">Medication</div>
      </div>

      {meds.length > 0 ? (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Today</span></div>
          <div className="pad-x"><MedRows meds={meds} doses={doses} now={now} onTook={(m) => onLog(m)} /></div>
        </>
      ) : (
        <>
          <div className="pad-x"><div className="card pad">
            <div className="p3-q">One Tap</div>
            <div className="bp-sub">Marks the moment. Only a timeline of what happened, never a tally of anything left undone.</div>
          </div></div>
          <div className="pad-x">
            {justTapped ? (
              <div className="card pad">
                <div className="conn-name">Logged</div>
                <button className="btn btn-secondary btn-block" onClick={onBack}>Done</button>
              </div>
            ) : (
              <button className="btn btn-primary btn-block btn-lg" onClick={tap}>Took It</button>
            )}
          </div>
        </>
      )}

      <DoseTimeline doses={doses} now={now} onUndo={onUndo} />
      <div className="screen-foot" />
    </div>
  );
}
