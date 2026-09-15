import { useState } from "react";
import type { MealEntry } from "../types";
import { clockOf } from "../meds";
import { pressable } from "../../shared/pressable";

// MEAL (Health Push D, H-42). One text field, what you ate, in your own
// words. No calories, no macros, no amount, no grade: the privacy law's
// vocabulary ban guards this folder, and this screen gives it nothing to
// catch. Today's meals sit under the field with Undo on each.
export default function MealScreen({ today, recent = [], onLog, onUndo, onBack }: {
  today: (MealEntry & { pending?: boolean })[];
  /** 2026-09-14 (the reference's "Use a recent meal"): the last few distinct
   *  meals as chips that fill the field. */
  recent?: string[];
  /** `at` rides along only when the time was changed from now. */
  onLog: (text: string, at?: number) => void;
  onUndo?: (entry: MealEntry) => void;
  onBack: () => void;
}) {
  const [text, setText] = useState("");
  const [logged, setLogged] = useState(false);
  const [when, setWhen] = useState("");
  const valid = text.trim().length > 0;
  const submit = () => {
    if (!valid) return;
    const at = when ? atToday(when) : undefined;
    if (at) onLog(text.trim(), at); else onLog(text.trim());
    setText("");
    setWhen("");
    setLogged(true);
  };
  const chips = recent.filter((r) => r.trim().toLowerCase() !== text.trim().toLowerCase()).slice(0, 4);
  const rows = [...today].sort((a, b) => b.data.at - a.data.at);
  return (
    <div className="screen ruled health-ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">Meal</div>
      </div>
      <div className="pad-x"><div className="card pad">
        <div className="p3-q">What You Ate</div>
        <div className="field">
          <input className="input" value={text} onChange={(e) => { setText(e.target.value); setLogged(false); }} placeholder="e.g. Eggs and toast" aria-label="What you ate" autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
        </div>
        {chips.length > 0 && (
          <div className="chip-row chip-wrap-row" role="group" aria-label="Recent meals">
            {chips.map((r) => (
              <div key={r} {...pressable(() => { setText(r); setLogged(false); })} className="chip">{r}</div>
            ))}
          </div>
        )}
        <div className="field">
          <div className="input-label">When</div>
          <input className="input set-field" type="time" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="When" placeholder="Now" />
        </div>
        {logged && !valid ? (
          <button className="btn btn-secondary btn-block" onClick={onBack}>Done</button>
        ) : (
          <button className="btn btn-primary btn-block" disabled={!valid} onClick={submit}>Log It</button>
        )}
      </div></div>
      {rows.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Today</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {rows.map((m) => (
              // Row tap (Dave 2026-09-15): a logged meal fills the field above, the
              // same as a recent meal chip. Undo stays on its own pill.
              <div className="row" key={m.id} {...pressable(() => { setText(m.data.text); setLogged(false); })}>
                <div className="row-grow">
                  <div className="conn-name">{m.data.text}</div>
                  <div className="facts"><span className="fact amber">{clockOf(m.data.at)}</span></div>
                </div>
                {onUndo && !m.pending && (
                  <button type="button" className="pill-act pill-quiet" onClick={(ev) => { ev.stopPropagation(); onUndo(m); }} aria-label={"Undo " + m.data.text}>Undo</button>
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

/** Today at HH:MM, local, as epoch ms; undefined for anything else. */
function atToday(v: string): number | undefined {
  const m = /^(\d{2}):(\d{2})$/.exec(v);
  if (!m) return undefined;
  const d = new Date();
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d.getTime();
}
