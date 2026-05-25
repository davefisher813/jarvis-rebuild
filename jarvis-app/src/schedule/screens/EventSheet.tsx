import { useState } from "react";
import type { ColorSlot } from "../../categories/types";
import type { SheetCategory } from "../../tasks/screens/TaskSheet";

export type { SheetCategory };
export interface EventDraft { title: string; date: string; start: string; category: string; location: string }

// Bottom sheet to create or edit an event. Saves call existing ScheduleService
// methods; presentational + local form state only.
export default function EventSheet({
  mode,
  initial,
  categories,
  onSave,
  onDelete,
  onCancel,
}: {
  mode: "new" | "edit";
  initial?: Partial<EventDraft>;
  categories: SheetCategory[];
  onSave: (draft: EventDraft) => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [date, setDate] = useState(initial?.date ?? "");
  const [start, setStart] = useState(initial?.start ?? "09:00");
  const [category, setCategory] = useState(initial?.category ?? categories[0]?.id ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [err, setErr] = useState(false);

  const save = () => {
    if (!title.trim() || !date || !start) {
      setErr(true);
      return;
    }
    onSave({ title: title.trim(), date, start, category, location: location.trim() });
  };

  const slot = (c: SheetCategory): ColorSlot => c.color;

  return (
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{mode === "new" ? "New Event" : "Edit Event"}</div></div>
        <div className="pad-x sheet-form">
          <div className="field">
            <label className="input-label">Title <span className="input-req">*</span></label>
            <input
              className="input"
              placeholder="What\u2019s happening?"
              value={title}
              onChange={(e) => { setTitle(e.target.value); if (err) setErr(false); }}
              autoFocus
            />
          </div>

          <div className="field-row">
            <div className="field">
              <label className="input-label">Date <span className="input-req">*</span></label>
              <input type="date" className="input" value={date} onChange={(e) => { setDate(e.target.value); if (err) setErr(false); }} />
            </div>
            <div className="field">
              <label className="input-label">Start <span className="input-req">*</span></label>
              <input type="time" className="input" value={start} onChange={(e) => { setStart(e.target.value); if (err) setErr(false); }} />
            </div>
          </div>

          <div className="field">
            <div className="input-label">Category</div>
            <div className="chip-row cat-pick">
              {categories.map((c) =>
                c.id === category ? (
                  <div key={c.id} className={"chip cat-bg-" + slot(c)} role="button" tabIndex={0} onClick={() => setCategory(c.id)}>
                    {c.name}
                  </div>
                ) : (
                  <div key={c.id} className="chip" role="button" tabIndex={0} onClick={() => setCategory(c.id)}>
                    <span className={"cat-dot cat-bg-" + slot(c)} />
                    {c.name}
                  </div>
                ),
              )}
            </div>
          </div>

          <div className="field">
            <label className="input-label">Location</label>
            <input className="input" placeholder="Place or address (optional)" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>

          {err && <div className="input-error">Add a title, date, and start time.</div>}
        </div>

        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-block" onClick={save}>Save</button>
          {mode === "edit" && onDelete && (
            <button className="btn btn-danger btn-block" onClick={onDelete}>Delete Event</button>
          )}
          <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
