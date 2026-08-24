import { createPortal } from "react-dom";
import { useState } from "react";
import type { GoalData } from "./types";
import type { Category } from "../categories/types";

const TRASH = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>;

// A goal is just a name plus the projects pointing at it. Session 6 removed
// BOTH self-reported controls that used to live here:
//   - Area: Life Areas were retired (state nobody maintained).
//   - Status: progress is now DERIVED from the goal's projects and their tasks,
//     so asking the user to also declare "on track" was a decision that changed
//     nothing they would ever see.
// Stored values for both are preserved on save rather than destroyed.
//
// ARCHITECTURE C (2026-08-22): plus the areas it covers. This is the one field
// that lets a goal see work nobody filed, which in Dave's data is nearly all of
// it. It is a WATCH LIST, not a move: nothing is refiled, nothing is copied,
// and unpicking an area changes only what the goal can see.
export default function GoalSheet({ mode, initial, categories = [], onSave, onDelete, onCancel }: {
  mode: "new" | "edit"; initial?: GoalData; categories?: Category[];
  onSave: (d: GoalData) => void; onDelete?: () => void; onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  // Money v1: an optional dollar target turns this into a savings goal.
  // Progress stays DERIVED (from logged entries), so this is a target, not a
  // self-reported status; it earns its field.
  const [target, setTarget] = useState(initial?.moneyTarget ? String(initial.moneyTarget) : "");
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [touched, setTouched] = useState(false);
  const targetOk = target.trim() === "" || (Number.isFinite(Number(target)) && Number(target) > 0);
  const valid = title.trim().length > 0 && targetOk;
  const toggleTag = (id: string) => setTags((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
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
          {categories.length > 0 && (
            <div className="field">
              <div className="input-label">Areas It Covers</div>
              <div className="chip-row">
                {categories.map((c) => (
                  <button key={c.id} className={"chip" + (tags.includes(c.id) ? " active" : "")} onClick={() => toggleTag(c.id)}>{c.data.name}</button>
                ))}
              </div>
              <div className="input-hint">Tasks in these areas count toward this goal without being filed under a project.</div>
            </div>
          )}
          <div className="field">
            <div className="input-label">Dollar Target</div>
            <input className={"input" + (touched && !targetOk ? " input-error" : "")} inputMode="numeric" placeholder="Optional, e.g. 2000" value={target} onChange={(e) => setTarget(e.target.value)} />
            {touched && !targetOk && <div className="input-error">A number, or empty</div>}
          </div>
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-block" onClick={() => { if (!valid) { setTouched(true); return; } onSave({ title: title.trim(), state: initial?.state ?? "on_track", ...(initial?.areaId ? { areaId: initial.areaId } : {}), ...(initial?.saved ? { saved: initial.saved } : {}), ...(tags.length ? { tags } : {}), moneyTarget: target.trim() ? Number(target) : undefined }); }}>Save</button>
          {mode === "edit" && onDelete && <button className="btn btn-secondary btn-block btn-danger-text" onClick={onDelete}>{TRASH}Delete Goal</button>}
          <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
    ,
    document.body,
  );
}
