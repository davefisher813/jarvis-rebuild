import { useState } from "react";
import type { LightsOutEntry } from "../types";
import { clockOf } from "../meds";
import { weekdayShortDateFromMs, shortDate } from "../../shared/dateFormat";
import Stepper from "../../shared/Stepper";
import { pressable } from "../../shared/pressable";
import { hoursLabel } from "../../shared/duration";
import BackPill from "../../shared/BackPill";

// LIGHTS OUT (Part 1; Health Push D, H-41). One tap, one timestamp, marks
// the night's end. Nothing is scored: no duration shown, no streak, no ring.
// The screen's entire job is the tap; the offer this screen ends on IS the
// button. The last time can be corrected (Edit Time writes the clock, on the
// same night) because a tap made at 11:40 for a bedtime of 11:15 is the
// commonest wrong row; there is still no duration field.
export default function LightsOutScreen({ last, onLog, onEditTime, onLogSleep, recentSleep = [], onBack, backLabel = "Health" }: {
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
  /** The screen the back returns to: the Health area the flow was opened from. */
  backLabel?: string;
}) {
  const [justTapped, setJustTapped] = useState(false);
  const [editing, setEditing] = useState(false);
  // THE EDIT IS A DRAFT (2026-10-17). The clock input used to write on its first
  // change, and a time wheel fires change while it is still being scrolled, so
  // a thumb on the wheel was a write. The draft is held here and written by
  // Save; Cancel, or leaving the row, writes nothing.
  const [draftTime, setDraftTime] = useState("");
  // REPEAT-LAST IS ONE TAP (the Logging Standard, rule 7, 2026-10-17): the form
  // opens on last night's hours when there are any, so a night like the last is
  // one Save; the 7h 30m seed stands only before the first entry. Tapping the
  // stepper's number selects it (rule 2), so typing replaces the prefill.
  const latest = recentSleep.reduce<{ date: string; hours: number } | null>((best, r) => (!best || r.date > best.date ? r : best), null);
  const seedHours = latest ? Math.floor(latest.hours) : 7;
  const seedMinutes = latest ? [0, 15, 30, 45].reduce((a, b) => (Math.abs(b - (latest.hours - seedHours) * 60) < Math.abs(a - (latest.hours - seedHours) * 60) ? b : a), 0) : 30;
  const [hours, setHours] = useState(seedHours);
  const [minutes, setMinutes] = useState(seedMinutes);
  const [night, setNight] = useState(localDay());
  const [sleepSaved, setSleepSaved] = useState(false);
  const sleepValid = hours + minutes / 60 > 0 && /^\d{4}-\d{2}-\d{2}$/.test(night);

  const tap = () => {
    onLog();
    setJustTapped(true);
  };

  const canEdit = !!onEditTime && !!last && !last.pending;
  const timeValue = last ? hhmm(last.data.at) : "";
  const beginEdit = () => { setDraftTime(timeValue); setEditing(true); };
  const commitTime = (v: string) => {
    if (!last || !onEditTime) return;
    const m = /^(\d{2}):(\d{2})$/.exec(v);
    if (!m) { setEditing(false); return; }
    const d = new Date(last.data.at);
    d.setHours(Number(m[1]), Number(m[2]), 0, 0);
    onEditTime(last.id, d.getTime());
    setEditing(false);
  };

  return (
    <div className="screen ruled health-ruled">
      <div className="nav-bar">
        <BackPill label={backLabel} onClick={onBack} />
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
            <div className="row" {...(canEdit && !editing ? pressable(beginEdit) : {})}>
              <div className="row-grow">
                <div className="conn-name">{weekdayShortDateFromMs(last.data.at)}</div>
                {/* A bedtime is a neutral time, small caps (§AM F5). Violet
                    was sleep's area hue on words; in Health it means a
                    budget or a pairing. */}
                <div className="facts"><span className="fact date">{clockOf(last.data.at)}</span></div>
              </div>
              {/* CLEAN ROW (Dave 2026-10-05): the Edit Time capsule is gone; the row's own tap edits the time, as it always did. */}
              {canEdit && !editing && <div className="chev" />}
              {canEdit && editing && (
                <>
                  <input className="input set-field" type="time" aria-label="Bedtime time" value={draftTime} autoFocus
                    onChange={(e) => setDraftTime(e.target.value)} />
                  <button type="button" className="btn-sm" onClick={() => commitTime(draftTime)}>Save</button>
                  <button type="button" className="btn-sm" onClick={() => setEditing(false)}>Cancel</button>
                </>
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
              ? <div className="facts"><span className="fact"><b>{hoursLabel(hours + minutes / 60)}</b></span><span className="fact">Saved</span></div>
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
                      <div className="facts"><span className="fact"><b>{hoursLabel(r.hours)}</b></span></div>
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

function localDay(atMs: number = Date.now()): string {
  const d = new Date(atMs);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function hhmm(at: number): string {
  const d = new Date(at);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}
