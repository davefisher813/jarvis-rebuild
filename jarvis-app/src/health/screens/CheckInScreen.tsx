import { useState } from "react";
import type { CheckInEntry, CheckInEnergy, CheckInMood } from "../types";
import { clockOf } from "../meds";
import { ENERGY_WORDS, MOOD_WORDS, checkInLine } from "../checkin";
import { pressable } from "../../shared/pressable";

// CHECK IN (2026-09-14, the reference's Energy and Mood check-in; Dave: "Do
// all of this"). Two words and a note, nothing scored. Energy and mood are
// words a person picks, never a number, so nothing here can feed a
// correlation surface or a composite (D11's rule on mood stands: this is a
// log, and it is read back only as itself). Skip is a real answer.
export default function CheckInScreen({ today, onLog, onUndo, onBack }: {
  today: (CheckInEntry & { pending?: boolean })[];
  onLog: (d: { energy?: CheckInEnergy; mood?: CheckInMood; note?: string }) => void;
  onUndo?: (entry: CheckInEntry) => void;
  onBack: () => void;
}) {
  const [energy, setEnergy] = useState<CheckInEnergy | undefined>(undefined);
  const [mood, setMood] = useState<CheckInMood | undefined>(undefined);
  const [note, setNote] = useState("");
  const valid = !!energy || !!mood || note.trim().length > 0;
  const submit = () => {
    if (!valid) return;
    onLog({ ...(energy ? { energy } : {}), ...(mood ? { mood } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
    setEnergy(undefined);
    setMood(undefined);
    setNote("");
  };
  const rows = [...today].sort((a, b) => b.data.at - a.data.at);
  const chips = <T extends string>(name: string, words: { value: T; label: string }[], value: T | undefined, pick: (v: T | undefined) => void) => (
    <div className="field">
      <div className="input-label">{name}</div>
      <div className="chip-row chip-wrap-row" role="group" aria-label={name}>
        {words.map((w) => (
          <div key={w.value} {...pressable(() => pick(value === w.value ? undefined : w.value))} className={"chip" + (value === w.value ? " active" : "")} aria-pressed={value === w.value}>{w.label}</div>
        ))}
      </div>
    </div>
  );
  return (
    <div className="screen ruled health-ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">Check In</div>
      </div>
      <div className="pad-x"><div className="card pad">
        <div className="p3-q">How Are You Feeling?</div>
        {chips("Energy", ENERGY_WORDS, energy, setEnergy)}
        {chips("Mood", MOOD_WORDS, mood, setMood)}
        <div className="field">
          <div className="input-label">Note</div>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" aria-label="Note"
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
        </div>
        <button className="btn btn-primary btn-block" disabled={!valid} onClick={submit}>Save Check In</button>
        <button className="btn btn-tertiary btn-block" onClick={onBack}>Skip Today</button>
      </div></div>
      {rows.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Today</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {rows.map((c) => (
              // row-tap: logged check ins are receipts shown whole with nothing to open, and the only verb is Undo, which a row tap must never do
              <div className="row" key={c.id}>
                <div className="row-grow">
                  <div className="conn-name">{checkInLine(c.data) ?? "Check In"}</div>
                  <div className="facts"><span className="fact cyan">{clockOf(c.data.at)}</span>{c.data.note && (c.data.energy || c.data.mood) && <span className="fact">{c.data.note}</span>}</div>
                </div>
                {onUndo && !c.pending && (
                  <button type="button" className="pill-act pill-quiet" onClick={() => onUndo(c)} aria-label="Undo this check in">Undo</button>
                )}
              </div>
            ))}
          </div></div>
        </>
      )}
      <div className="screen-foot" />
    </div>
  );
}
