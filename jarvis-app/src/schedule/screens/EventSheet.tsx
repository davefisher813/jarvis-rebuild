import { createPortal } from "react-dom";
import { useState } from "react";
import type { ColorSlot } from "../../categories/types";
import type { SheetCategory } from "../../tasks/screens/TaskSheet";
import type { EventRecurrence } from "../types";
import { addMinutes } from "../calendar";

export type { SheetCategory };
export interface EventDraft {
  title: string;
  date: string;
  start: string;
  end: string;
  category: string;
  location: string;
  recurrence: EventRecurrence;
}

// Bottom sheet to create or edit an event. Save calls existing ScheduleService
// methods; presentational + local form state only.
export default function EventSheet({
  mode,
  initial,
  categories,
  checkConflict,
  suggestSlot,
  onSave,
  onDelete,
  onCancel,
}: {
  mode: "new" | "edit";
  initial?: Partial<EventDraft>;
  categories: SheetCategory[];
  checkConflict?: (date: string, start: string, end: string) => boolean;
  suggestSlot?: (date: string) => string;
  onSave: (draft: EventDraft, scope?: "this" | "series") => void;
  onDelete?: (scope?: "this" | "series") => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [date, setDate] = useState(initial?.date ?? "");
  const [start, setStart] = useState(initial?.start ?? "09:00");
  const [end, setEnd] = useState(initial?.end ?? addMinutes(initial?.start ?? "09:00", 60));
  const [category, setCategory] = useState(initial?.category ?? categories[0]?.id ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [recurrence, setRecurrence] = useState<EventRecurrence>(initial?.recurrence ?? "none");
  const [scope, setScope] = useState<"this" | "series">("series");
  const [err, setErr] = useState(false);

  // Keep end sensible: when start moves past end, push end to start + 1h.
  const onStart = (v: string) => {
    setStart(v);
    if (!end || end <= v) setEnd(addMinutes(v, 60));
    if (err) setErr(false);
  };

  const endInvalid = !!end && end <= start;
  const conflict = checkConflict?.(date, start, end) ?? false;

  const recurringEdit = mode === "edit" && recurrence !== "none";

  const save = () => {
    if (!title.trim() || !date || !start || endInvalid) {
      setErr(true);
      return;
    }
    const draft = { title: title.trim(), date, start, end, category, location: location.trim(), recurrence };
    recurringEdit ? onSave(draft, scope) : onSave(draft);
  };

  const slot = (c: SheetCategory): ColorSlot => c.color;
  const reps: [EventRecurrence, string][] = [["none", "None"], ["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"]];

  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{mode === "new" ? "New Event" : "Edit Event"}</div></div>
        <div className="pad-x sheet-form">
          <div className="field">
            <label className="input-label">Title <span className="input-req">*</span></label>
            <input
              className="input"
              placeholder="What's happening?"
              value={title}
              onChange={(e) => { setTitle(e.target.value); if (err) setErr(false); }}
            />
          </div>

          <div className="field-row">
            <div className="field">
              <label className="input-label">Date <span className="input-req">*</span></label>
              <input type="date" className="input" value={date} onChange={(e) => { setDate(e.target.value); if (err) setErr(false); }} />
            </div>
            <div className="field">
              <label className="input-label">Start <span className="input-req">*</span></label>
              <input type="time" className="input" value={start} onChange={(e) => onStart(e.target.value)} />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label className="input-label">End</label>
              <input type="time" className="input" value={end} onChange={(e) => { setEnd(e.target.value); if (err) setErr(false); }} />
            </div>
            <div className="field" />
          </div>

          <div className="field">
            <div className="chip-row dur-pick">
              {([[30, "30m"], [60, "1h"], [120, "2h"]] as const).map(([mins, label]) => {
                const tm = (h: string) => { const p = h.split(":"); return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0); };
                const activeDur = !!end && tm(end) - tm(start) === mins;
                return (
                  <div key={mins} className={"chip" + (activeDur ? " active" : "")} role="button" tabIndex={0} onClick={() => { setEnd(addMinutes(start, mins)); if (err) setErr(false); }}>{label}</div>
                );
              })}
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
            <div className="input-label">Repeat</div>
            <div className="segmented">
              {reps.map(([val, label]) => (
                <div key={val} className={"seg" + (recurrence === val ? " active" : "")} role="button" tabIndex={0} onClick={() => setRecurrence(val)}>{label}</div>
              ))}
            </div>
          </div>

          {recurringEdit && (
            <div className="field">
              <div className="input-label">Apply to</div>
              <div className="segmented">
                <div className={"seg" + (scope === "this" ? " active" : "")} role="button" tabIndex={0} onClick={() => setScope("this")}>This event</div>
                <div className={"seg" + (scope === "series" ? " active" : "")} role="button" tabIndex={0} onClick={() => setScope("series")}>All events</div>
              </div>
            </div>
          )}

          <div className="field">
            <label className="input-label">Location</label>
            <input className="input" placeholder="Place or address (optional)" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>

          {endInvalid && <div className="input-error">End time must be after the start time.</div>}
          {err && !endInvalid && <div className="input-error">Add a title, date, and start time.</div>}
          {conflict && !endInvalid && (
            <div className="input-note">
              <span>Heads up: this overlaps another event on this day.</span>
              {suggestSlot && (
                <button type="button" className="note-fix" onClick={() => {
                  const tm = (h: string) => { const p = h.split(":"); return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0); };
                  const dur = end && tm(end) > tm(start) ? tm(end) - tm(start) : 60;
                  const next = suggestSlot(date);
                  setStart(next); setEnd(addMinutes(next, dur)); if (err) setErr(false);
                }}>Use next free slot</button>
              )}
            </div>
          )}
        </div>

        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-block" onClick={save}>Save</button>
          {mode === "edit" && onDelete && (
            <button className="btn btn-danger btn-block" onClick={() => (recurringEdit ? onDelete?.(scope) : onDelete?.())}>Delete Event</button>
          )}
          <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
