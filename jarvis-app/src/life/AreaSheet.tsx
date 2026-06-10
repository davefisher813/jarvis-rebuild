import { createPortal } from "react-dom";
import { useState } from "react";
import { AREA_META, AREA_STATES, type AreaData, type AreaState } from "./types";

const TRASH = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>;

export default function AreaSheet({ mode, initial, onSave, onDelete, onCancel }: {
  mode: "new" | "edit"; initial?: AreaData;
  onSave: (d: AreaData) => void; onDelete?: () => void; onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [state, setState] = useState<AreaState>(initial?.state ?? "steady");
  const [touched, setTouched] = useState(false);
  const valid = name.trim().length > 0;
  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{mode === "new" ? "New Area" : "Edit Area"}</div></div>
        <div className="pad-x sheet-form">
          <div className="field">
            <div className="input-label">Name</div>
            <input className={"input" + (touched && !valid ? " input-error" : "")} placeholder="e.g. Health" value={name} onChange={(e) => setName(e.target.value)} />
            {touched && !valid && <div className="input-error">Add a name.</div>}
          </div>
          <div className="field">
            <div className="input-label">How is it going?</div>
            <div className="segmented">
              {AREA_STATES.map((s) => (
                <button key={s} className={"seg" + (state === s ? " active" : "")} onClick={() => setState(s)}>{AREA_META[s].label}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-block" onClick={() => { if (!valid) { setTouched(true); return; } onSave({ name: name.trim(), state }); }}>Save</button>
          {mode === "edit" && onDelete && <button className="btn btn-danger btn-block" onClick={onDelete}>{TRASH}Delete Area</button>}
          <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
    ,
    document.body,
  );
}
