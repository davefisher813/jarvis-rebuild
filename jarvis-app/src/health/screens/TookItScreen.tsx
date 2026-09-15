import { useRef, useState } from "react";
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
  /** 2026-09-14 (the reference's Time Taken): `at` rides along only when
   *  the time was changed from now. */
  onLog: (med?: MedDefEntry, at?: number) => void;
  onUndo?: (row: DoseRow) => void;
  onBack: () => void;
}) {
  const [justTapped, setJustTapped] = useState(false);
  const [when, setWhen] = useState("");
  const whenRef = useRef<HTMLInputElement>(null);
  const at = () => { const m = /^(\d{2}):(\d{2})$/.exec(when); if (!m) return undefined; const d = new Date(now); d.setHours(Number(m[1]), Number(m[2]), 0, 0); return d.getTime(); };
  const log = (med?: MedDefEntry) => { const a = at(); if (a) onLog(med, a); else onLog(med); };
  const tap = () => { log(); setJustTapped(true); };
  const whenRow = (
    <div className="pad-x"><div className="card list-card-ruled">
      {/* Row tap (Dave 2026-09-15, "I want all rows clickable"): the form row focuses its time field. */}
      <div className="row" onClick={(e) => { if (e.target !== whenRef.current) whenRef.current?.focus(); }}>
        <div className="row-grow"><div className="conn-name">Time Taken</div><div className="conn-meta">{when ? "Logs at this time today" : "Now"}</div></div>
        <input ref={whenRef} className="input set-field" type="time" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Time taken" />
      </div>
    </div></div>
  );

  return (
    <div className="screen ruled health-ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">Medication</div>
      </div>

      {meds.length > 0 ? (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Today</span></div>
          <div className="pad-x"><MedRows meds={meds} doses={doses} now={now} onTook={(m) => log(m)} /></div>
          {whenRow}
        </>
      ) : (
        <>
          <div className="pad-x"><div className="card pad">
            <div className="p3-q">One Tap</div>
            <div className="bp-sub">Marks the moment. Only a timeline of what happened, never a tally of anything left undone.</div>
          </div></div>
          {!justTapped && whenRow}
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
