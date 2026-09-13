import { useState } from "react";
import type { MealEntry } from "../types";
import { clockOf } from "../meds";

// MEAL (Health Push D, H-42). One text field, what you ate, in your own
// words. No calories, no macros, no amount, no grade: the privacy law's
// vocabulary ban guards this folder, and this screen gives it nothing to
// catch. Today's meals sit under the field with Undo on each.
export default function MealScreen({ today, onLog, onUndo, onBack }: {
  today: (MealEntry & { pending?: boolean })[];
  onLog: (text: string) => void;
  onUndo?: (entry: MealEntry) => void;
  onBack: () => void;
}) {
  const [text, setText] = useState("");
  const [logged, setLogged] = useState(false);
  const valid = text.trim().length > 0;
  const submit = () => {
    if (!valid) return;
    onLog(text.trim());
    setText("");
    setLogged(true);
  };
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
              <div className="row" key={m.id}>
                <div className="row-grow">
                  <div className="conn-name">{m.data.text}</div>
                  <div className="facts"><span className="fact amber">{clockOf(m.data.at)}</span></div>
                </div>
                {onUndo && !m.pending && (
                  <button type="button" className="pill-act pill-quiet" onClick={() => onUndo(m)} aria-label={"Undo " + m.data.text}>Undo</button>
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
