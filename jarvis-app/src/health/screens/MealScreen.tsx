import { useState } from "react";
import type { MealEntry } from "../types";
import { clockOf } from "../meds";
import { titleCase } from "../../shared/casing";
import { pressable } from "../../shared/pressable";
import RowShell from "../../brain/RowShell";
import RowSheet from "../../brain/RowSheet";

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
  const [open, setOpen] = useState<(MealEntry & { pending?: boolean }) | null>(null);
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
          <div className="pad-x"><div className="card list-card-ruled shell-rows">
            {rows.map((m) => (
              // CLEAN ROWS (Dave 2026-10-05, locked): Undo is the swipe-left, not a capsule on the row. A tap opens the meal's
              // sheet: Log Again (it fills the field above, as it always did) and Undo.
              <RowShell key={m.id} verb={onUndo && !m.pending ? { label: "Undo", run: () => onUndo(m) } : undefined}>
                <div className="row" {...pressable(() => setOpen(m))}>
                  <div className="row-grow">
                    <div className="conn-name">{titleCase(m.data.text)}</div>
                    {/* The meal's time is a neutral time, small caps (§AM F5); amber
                        in Health means next up or over, not the meal's hue. */}
                    <div className="facts"><span className="fact date">{clockOf(m.data.at)}</span></div>
                  </div>
                  <div className="chev" />
                </div>
              </RowShell>
            ))}
          </div></div>
        </>
      )}
      {open && (
        <RowSheet eyebrow="Meal" text={titleCase(open.data.text)} facts={<span className="fact date">{clockOf(open.data.at)}</span>}
          answers={[
            { label: "Log Again", onPick: () => { setText(open.data.text); setLogged(false); } },
            ...(onUndo && !open.pending ? [{ label: "Undo", destructive: true, onPick: () => onUndo(open) }] : []),
          ]}
          onClose={() => setOpen(null)} />
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
