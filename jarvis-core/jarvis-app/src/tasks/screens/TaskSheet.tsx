import { useState } from "react";
import type { ColorSlot } from "../../categories/types";

export interface SheetCategory { id: string; name: string; color: ColorSlot }
export interface TaskDraft { text: string; category: string; due: string }

const DAY = 86400000;
const isoOf = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const todayISO = () => isoOf(new Date());
const addDaysISO = (base: string, n: number) => isoOf(new Date(new Date(base + "T00:00:00").getTime() + n * DAY));

// Bottom sheet to create or edit a task. All saves call existing TaskService
// methods; this is presentational + local form state only.
export default function TaskSheet({
  mode,
  initial,
  categories,
  onSave,
  onDelete,
  onCancel,
}: {
  mode: "new" | "edit";
  initial?: Partial<TaskDraft>;
  categories: SheetCategory[];
  onSave: (draft: TaskDraft) => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const today = todayISO();
  const tomorrow = addDaysISO(today, 1);
  const [text, setText] = useState(initial?.text ?? "");
  const [category, setCategory] = useState(initial?.category ?? categories[0]?.id ?? "");
  const [due, setDue] = useState(initial?.due ?? "");
  const [err, setErr] = useState(false);

  const dueMode = due === "" ? "none" : due === today ? "today" : due === tomorrow ? "tomorrow" : "pick";

  const save = () => {
    if (!text.trim()) {
      setErr(true);
      return;
    }
    onSave({ text: text.trim(), category, due });
  };

  return (
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{mode === "new" ? "New Task" : "Edit Task"}</div></div>
        <div className="pad-x sheet-form">
          <div className="field">
            <label className="input-label">Task <span className="input-req">*</span></label>
            <input
              className="input"
              placeholder="What needs doing?"
              value={text}
              onChange={(e) => { setText(e.target.value); if (err) setErr(false); }}
              autoFocus
            />
            {err && <div className="input-error">Add a task name.</div>}
          </div>

          <div className="field">
            <div className="input-label">Category</div>
            <div className="chip-row cat-pick">
              {categories.map((c) =>
                c.id === category ? (
                  <div key={c.id} className={"chip cat-bg-" + c.color} role="button" tabIndex={0} onClick={() => setCategory(c.id)}>
                    {c.name}
                  </div>
                ) : (
                  <div key={c.id} className="chip" role="button" tabIndex={0} onClick={() => setCategory(c.id)}>
                    <span className={"cat-dot cat-bg-" + c.color} />
                    {c.name}
                  </div>
                ),
              )}
            </div>
          </div>

          <div className="field">
            <div className="input-label">Due</div>
            <div className="segmented">
              <div className={"seg" + (dueMode === "none" ? " active" : "")} role="button" tabIndex={0} onClick={() => setDue("")}>None</div>
              <div className={"seg" + (dueMode === "today" ? " active" : "")} role="button" tabIndex={0} onClick={() => setDue(today)}>Today</div>
              <div className={"seg" + (dueMode === "tomorrow" ? " active" : "")} role="button" tabIndex={0} onClick={() => setDue(tomorrow)}>Tomorrow</div>
              <div className={"seg" + (dueMode === "pick" ? " active" : "")} role="button" tabIndex={0} onClick={() => setDue(dueMode === "pick" && due ? due : addDaysISO(today, 2))}>Pick</div>
            </div>
            {dueMode === "pick" && (
              <input type="date" className="input field-gap" value={due} onChange={(e) => setDue(e.target.value)} />
            )}
          </div>
        </div>

        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-block" onClick={save}>Save</button>
          {mode === "edit" && onDelete && (
            <button className="btn btn-danger btn-block" onClick={onDelete}>Delete Task</button>
          )}
          <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
