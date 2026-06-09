import { createPortal } from "react-dom";
import { useState } from "react";
import { GOAL_META, GOAL_STATES, type GoalData, type GoalState, type Area } from "./types";

const TRASH = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>;

export default function GoalSheet({ mode, areas, initial, onSave, onDelete, onCancel }: {
  mode: "new" | "edit"; areas: Area[]; initial?: GoalData;
  onSave: (d: GoalData) => void; onDelete?: () => void; onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [state, setState] = useState<GoalState>(initial?.state ?? "on_track");
  const [areaId, setAreaId] = useState<string>(initial?.areaId ?? "");
  const [touched, setTouched] = useState(false);
  const valid = title.trim().length > 0;
  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{mode === "new" ? "New Goal" : "Edit Goal"}</div></div>
        <div className="pad-x sheet-form">
          <div className="field">
            <div className="input-label">Goal</div>
            <input className={"input" + (touched && !valid ? " input-error" : "")} placeholder="e.g. Run a half marathon" value={title} onChange={(e) => setTitle(e.target.value)} />
            {touched && !valid && <div className="input-error">Add a goal.</div>}
          </div>
          <div className="field">
            <div className="input-label">Status</div>
            <div className="segmented">
              {GOAL_STATES.map((s) => (
                <button key={s} className={"seg" + (state === s ? " active" : "")} onClick={() => setState(s)}>{GOAL_META[s].label}</button>
              ))}
            </div>
          </div>
          {areas.length > 0 && (
            <div className="field">
              <div className="input-label">Area (optional)</div>
              <div className="chip-row">
                <button className={"chip" + (areaId === "" ? " active" : "")} onClick={() => setAreaId("")}>None</button>
                {areas.map((a) => (
                  <button key={a.id} className={"chip" + (areaId === a.id ? " active" : "")} onClick={() => setAreaId(a.id)}>{a.data.name}</button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-block" onClick={() => { if (!valid) { setTouched(true); return; } onSave({ title: title.trim(), state, areaId: areaId || undefined }); }}>Save</button>
          {mode === "edit" && onDelete && <button className="btn btn-danger btn-block" onClick={onDelete}>{TRASH}Delete Goal</button>}
          <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
    ,
    document.body,
  );
}
