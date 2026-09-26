import { useState } from "react";
import type { LightsOutEntry } from "../types";
import { clockOf } from "../meds";
import { weekdayShortDateFromMs, shortDate } from "../../shared/dateFormat";
import Stepper from "../../shared/Stepper";
import { pressable } from "../../shared/pressable";

// LIGHTS OUT (Part 1; Health Push D, H-41). One tap, one timestamp, marks
// the night's end. Nothing is scored: no duration shown, no streak, no ring.
// The screen's entire job is the tap; the offer this screen ends on IS the
// button. The last time can be corrected (Edit Time writes the clock, on the
// same night) because a tap made at 11:40 for a bedtime of 11:15 is the
// commonest wrong row; there is still no duration field.
export default function LightsOutScreen({ last, onLog, onEditTime, onLogSleep, recentSleep = [], onBack }: {
  last: (LightsOutEntry & { pending?: boolean }) | null;
  onLog: () => void;
  /** Absent, or while the last row is still pending, there is no Edit Time. */
  onEditTime?: (id: string, at: number) => void;
  /** 2026-09-14 (the reference's Sleep page): last night's hours, a separate
   *  entry from the bedtime mark, written to his Sleep metric for the night
   *  that ended on `night` (a local ISO day). Absent, the form is absent. */
  onLogSleep?: (hours: number, night: string) => void;
  recentSleep?: { date: string; hours: number }[];
  onBack: () => void;
}) {
  const [justTapped, setJustTapped] = useState(false);
  const [editing, setEditing] = useState(false);
  const [hours, setHours] = useState(7);
  const [minutes, setMinutes] = useState(30);
  const [night, setNight] = useState(localDay());
  const [sleepSaved, setSleepSaved] = useState(false);
  const sleepValid = hours + minutes / 60 > 0 && /^\d{4}-\d{2}-\d{2}$/.test(night);

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
        <div className="nav-title">Sleep</div>
      </div>

      <div className="pad-x"><div className="card pad">
        <div className="p3-q">One Tap, One Time</div>
        <div className="bp-sub">Heading to bed? Marks the night's end. Nothing is scored, and nothing is compared to last night.</div>
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
            {/* Row tap (Dave 2026-09-15): the last night's row opens Edit Time. */}
            <div className="row" {...(canEdit && !editing ? pressable(() => setEditing(true)) : {})}>
              <div className="row-grow">
                <div className="conn-name">{weekdayShortDateFromMs(last.data.at)}</div>
                {/* A bedtime is a neutral time, small caps (§AM F5). Violet
                    was sleep's area hue on words; in Health it means a
                    budget or a pairing. */}
                <div className="facts"><span className="fact date">{clockOf(last.data.at)}</span></div>
              </div>
              {canEdit && !editing && (
                <button type="button" className="pill-act pill-quiet" onClick={(ev) => { ev.stopPropagation(); setEditing(true); }}>Edit Time</button>
              )}
              {canEdit && editing && (
                <input className="input set-field" type="time" aria-label="Bedtime time" defaultValue={timeValue} autoFocus
                  onChange={(e) => commitTime(e.target.value)} onBlur={() => setEditing(false)} />
              )}
            </div>
          </div></div>
        </>
      )}
      {/* LAST NIGHT'S HOURS (2026-09-14). A duration is a separate entry
          from the bedtime mark, and it goes to his own Sleep metric, which
          is where the tile and the export already read it from. */}
      {onLogSleep && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Last Night's Sleep</span></div>
          <div className="pad-x"><div className="card pad">
            <div className="row">
              <div className="row-grow"><div className="conn-name">Hours</div></div>
              <Stepper value={hours} step={1} min={0} max={24} label="Hours" onChange={setHours} />
            </div>
            <div className="field">
              <div className="input-label">Minutes</div>
              <div className="chip-row chip-wrap-row" role="group" aria-label="Minutes">
                {[0, 15, 30, 45].map((m) => (
                  <div key={m} {...pressable(() => setMinutes(m))} className={"chip" + (minutes === m ? " active" : "")} aria-pressed={minutes === m}>{String(m)}</div>
                ))}
              </div>
            </div>
            <div className="field">
              <div className="input-label">Night Ending</div>
              <input className="input" type="date" value={night} onChange={(e) => { setNight(e.target.value); setSleepSaved(false); }} aria-label="Night ending" />
            </div>
            {sleepSaved
              // Entered hours are a length with no state, so they are white (§AM).
              ? <div className="facts"><span className="fact"><b>{`${trimHours(hours + minutes / 60)} hrs`}</b></span><span className="fact">Saved</span></div>
              : <button className="btn btn-secondary btn-block" disabled={!sleepValid} onClick={() => { onLogSleep(Number((hours + minutes / 60).toFixed(2)), night); setSleepSaved(true); }}>Save Sleep</button>}
          </div></div>
          {recentSleep.length > 0 && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Recent Sleep</span></div>
              <div className="pad-x"><div className="card list-card-ruled">
                {recentSleep.map((r) => (
                  <div className="row" key={r.date}>
                    <div className="row-grow">
                      <div className="conn-name">{shortDate(r.date)}</div>
                      <div className="facts"><span className="fact"><b>{`${trimHours(r.hours)} hrs`}</b></span></div>
                    </div>
                  </div>
                ))}
              </div></div>
            </>
          )}
        </>
      )}
      <div className="screen-foot" />
    </div>
  );
}

function trimHours(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

function localDay(atMs: number = Date.now()): string {
  const d = new Date(atMs);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function hhmm(at: number): string {
  const d = new Date(at);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}
