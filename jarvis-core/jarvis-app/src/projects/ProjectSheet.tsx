import { useState } from "react";
import { PROJECT_META, PROJECT_STATES, type ProjectData, type ProjectStatus } from "./types";
import type { Category } from "../categories/types";

const TRASH = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>;

export default function ProjectSheet({ mode, categories, initial, onSave, onDelete, onCancel }: {
  mode: "new" | "edit"; categories: Category[]; initial?: ProjectData;
  onSave: (d: ProjectData) => void; onDelete?: () => void; onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [status, setStatus] = useState<ProjectStatus>(initial?.status ?? "active");
  const [category, setCategory] = useState<string>(initial?.category ?? "");
  const [touched, setTouched] = useState(false);
  const valid = title.trim().length > 0;
  return (
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{mode === "new" ? "New Project" : "Edit Project"}</div></div>
        <div className="pad-x sheet-form">
          <div className="field">
            <div className="input-label">Project</div>
            <input className={"input" + (touched && !valid ? " input-error" : "")} placeholder="e.g. Q3 launch plan" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            {touched && !valid && <div className="input-error">Add a title.</div>}
          </div>
          <div className="field">
            <div className="input-label">Status</div>
            <div className="segmented">
              {PROJECT_STATES.map((s) => (
                <button key={s} className={"seg" + (status === s ? " active" : "")} onClick={() => setStatus(s)}>{PROJECT_META[s].label}</button>
              ))}
            </div>
          </div>
          {categories.length > 0 && (
            <div className="field">
              <div className="input-label">Area (optional)</div>
              <div className="chip-row">
                <button className={"chip" + (category === "" ? " active" : "")} onClick={() => setCategory("")}>None</button>
                {categories.map((c) => (
                  <button key={c.id} className={"chip" + (category === c.id ? " active" : "")} onClick={() => setCategory(c.id)}>{c.data.name}</button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-block" onClick={() => { if (!valid) { setTouched(true); return; } onSave({ title: title.trim(), status, category: category || undefined }); }}>Save</button>
          {mode === "edit" && onDelete && <button className="btn btn-danger btn-block" onClick={onDelete}>{TRASH}Delete Project</button>}
          <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
