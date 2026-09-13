import { useState } from "react";
import type { LightsOutEntry } from "../types";
import { clockOf } from "../meds";
import { weekdayShortDateFromMs } from "../../shared/dateFormat";

// LIGHTS OUT (Part 1; Health Push D, H-41). One tap, one timestamp, marks
// the night's end. Nothing is scored: no duration shown, no streak, no ring.
// The screen's entire job is the tap; the offer this screen ends on IS the
// button. The last time can be corrected (Edit Time writes the clock, on the
// same night) because a tap made at 11:40 for a bedtime of 11:15 is the
// commonest wrong row; there is still no duration field.
export default function LightsOutScreen({ last, onLog, onEditTime, onBack }: {
  last: (LightsOutEntry & { pending?: boolean }) | null;
  onLog: () => void;
  /** Absent, or while the last row is still pending, there is no Edit Time. */
  onEditTime?: (id: string, at: number) => void;
  onBack: () => void;
}) {
  const [justTapped, setJustTapped] = useState(false);
  const [editing, setEditing] = useState(false);

  const tap = () => {
    onLog();
    setJustTapped(true);
  };

  const canEdit = !!onEditTime && !!last && !last.pending;
  const timeValue = last ? hhmm(last.data.at) : "";
  const commitTime = (v: string) => {
    if (!last || !onEditTime) return;
    const m = /^(\d{2}):(\d{2})$/.exec(v);
    if (!m) return;
    const d = new Date(last.data.at);
    d.setHours(Number(m[1]), Number(m[2]), 0, 0);
    onEditTime(last.id, d.getTime());
    setEditing(false);
  };

  return (
    <div className="screen ruled health-ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">Bedtime</div>
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
            <div className="row">
              <div className="row-grow">
                <div className="conn-name">{weekdayShortDateFromMs(last.data.at)}</div>
                <div className="facts"><span className="fact violet">{clockOf(last.data.at)}</span></div>
              </div>
              {canEdit && !editing && (
                <button type="button" className="pill-act pill-quiet" onClick={() => setEditing(true)}>Edit Time</button>
              )}
              {canEdit && editing && (
                <input className="input set-field" type="time" aria-label="Bedtime time" defaultValue={timeValue} autoFocus
                  onChange={(e) => commitTime(e.target.value)} onBlur={() => setEditing(false)} />
              )}
            </div>
          </div></div>
        </>
      )}
      <div className="screen-foot" />
    </div>
  );
}

function hhmm(at: number): string {
  const d = new Date(at);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}
