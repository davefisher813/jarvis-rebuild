import { createPortal } from "react-dom";
import { useState } from "react";
import type { GoalData } from "./types";

const TRASH = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>;

// A goal is just a name plus the projects pointing at it. Session 6 removed
// BOTH self-reported controls that used to live here:
//   - Area: Life Areas were retired (state nobody maintained).
//   - Status: progress is now DERIVED from the goal's projects and their tasks,
//     so asking the user to also declare "on track" was a decision that changed
//     nothing they would ever see.
// Stored values for both are preserved on save rather than destroyed.
export default function GoalSheet({ mode, initial, onSave, onDelete, onCancel }: {
  mode: "new" | "edit"; initial?: GoalData;
  onSave: (d: GoalData) => void; onDelete?: () => void; onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  // Money v1: an optional dollar target turns this into a savings goal.
  // Progress stays DERIVED (from logged entries), so this is a target, not a
  // self-reported status; it earns its field.
  const [target, setTarget] = useState(initial?.moneyTarget ? String(initial.moneyTarget) : "");
  const [touched, setTouched] = useState(false);
  const targetOk = target.trim() === "" || (Number.isFinite(Number(target)) && Number(target) > 0);
  const valid = title.trim().length > 0 && targetOk;
  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{mode === "new" ? "New Goal" : "Edit Goal"}</div></div>
        <div className="pad-x sheet-form">
          <div className="field">
            <div className="input-label">Goal</div>
            <input className={"input" + (touched && !title.trim() ? " input-error" : "")} placeholder="e.g. Run a half marathon" value={title} onChange={(e) => setTitle(e.target.value)} />
            {touched && !title.trim() && <div className="input-error">Add a goal.</div>}
          </div>
          <div className="field">
            <div className="input-label">Dollar Target</div>
            <input className={"input" + (touched && !targetOk ? " input-error" : "")} inputMode="numeric" placeholder="Optional, e.g. 2000" value={target} onChange={(e) => setTarget(e.target.value)} />
            {touched && !targetOk && <div className="input-error">A number, or empty</div>}
          </div>
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-block" onClick={() => { if (!valid) { setTouched(true); return; } onSave({ title: title.trim(), state: initial?.state ?? "on_track", ...(initial?.areaId ? { areaId: initial.areaId } : {}), ...(initial?.saved ? { saved: initial.saved } : {}), moneyTarget: target.trim() ? Number(target) : undefined }); }}>Save</button>
          {mode === "edit" && onDelete && <button className="btn btn-danger btn-block" onClick={onDelete}>{TRASH}Delete Goal</button>}
          <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
    ,
    document.body,
  );
}
