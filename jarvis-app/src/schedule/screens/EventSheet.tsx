import { createPortal } from "react-dom";
import { useState } from "react";
import type { ColorSlot } from "../../categories/types";
import type { SheetCategory } from "../../tasks/screens/TaskSheet";
import type { EventRecurrence } from "../types";
import { addMinutes, fmtTime } from "../calendar";
import type { TitleSuggestion } from "../memory";
import { catColor } from "../../shared/categories";

export type { SheetCategory };
export interface EventDraft {
  title: string;
  date: string;
  start: string;
  end: string;
  category: string;
  location: string;
  recurrence: EventRecurrence;
  taskIds?: string[]; // attached tasks (Session 4 connections)
}

// A task the sheet can attach or show attached: open tasks plus any already
// attached (which may be done). Provided by the caller.
export interface AttachableTask {
  id: string;
  text: string;
  category: string;
  done: boolean;
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
  onMoveToAnytime,
  onCancel,
  suggestTitles,
  suggestLocations,
  attachTasks,
  onToggleTask,
}: {
  mode: "new" | "edit";
  initial?: Partial<EventDraft>;
  categories: SheetCategory[];
  checkConflict?: (date: string, start: string, end: string) => boolean;
  suggestSlot?: (date: string) => string;
  onSave: (draft: EventDraft, scope?: "this" | "series") => void;
  onDelete?: (scope?: "this" | "series") => void;
  onMoveToAnytime?: () => void;
  onCancel: () => void;
  // Memory layer (Session 3): past events offered whole while typing a title,
  // and locations typed before. Derived by the caller; presentational here.
  suggestTitles?: (typed: string) => TitleSuggestion[];
  suggestLocations?: (title: string) => string[];
  // Connections (Session 4): tasks this event can hold. Checking an attached
  // task completes it everywhere; the caller owns persistence.
  attachTasks?: AttachableTask[];
  onToggleTask?: (id: string) => void;
}) {
  const [taskIds, setTaskIds] = useState<string[]>(initial?.taskIds ?? []);
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
    const draft = { title: title.trim(), date, start, end, category, location: location.trim(), recurrence, taskIds: recurrence === "none" ? taskIds : [] };
    recurringEdit ? onSave(draft, scope) : onSave(draft);
  };

  // Attachments: only non-recurring events hold tasks (links live on the event
  // and die with it; a whole series sharing one link list is a footgun).
  const canAttach = recurrence === "none" && !!attachTasks;
  const byId = new Map((attachTasks ?? []).map((t) => [t.id, t] as const));
  const attached = canAttach ? taskIds.map((id) => byId.get(id)).filter((t): t is AttachableTask => !!t) : [];
  const attachable = canAttach ? (attachTasks ?? []).filter((t) => !t.done && !taskIds.includes(t.id)).slice(0, 4) : [];

  const slot = (c: SheetCategory): ColorSlot => c.color;
  const reps: [EventRecurrence, string][] = [["none", "None"], ["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"]];

  // Memory: only offer on a new event, and stop once a suggestion was applied
  // or the title exactly matches (nothing left to fill).
  const [memUsed, setMemUsed] = useState(false);
  const titleSugs = mode === "new" && !memUsed && suggestTitles ? suggestTitles(title) : [];
  const locSugs = !location && suggestLocations ? suggestLocations(title) : [];
  const applySug = (s: TitleSuggestion) => {
    setMemUsed(true);
    setTitle(s.title);
    setStart(s.start);
    setEnd(addMinutes(s.start, s.durationMin));
    if (s.location) setLocation(s.location);
    if (categories.some((c) => c.id === s.category)) setCategory(s.category);
    if (err) setErr(false);
  };
  const sugLabel = (s: TitleSuggestion) => {
    const t = fmtTime(s.start);
    const dur = s.durationMin % 60 === 0 ? `${s.durationMin / 60}h` : `${s.durationMin}m`;
    return `${t.time} ${t.ap} · ${dur}`;
  };

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
            {titleSugs.length > 0 && (
              <div className="chip-row mem-row">
                {titleSugs.map((s) => (
                  <div key={s.title} className="chip" role="button" tabIndex={0} onClick={() => applySug(s)}>
                    <span className={"cat-dot cat-bg-" + catColor(s.category)} />
                    {s.title}&nbsp;<span className="t-meta">{sugLabel(s)}</span>
                  </div>
                ))}
              </div>
            )}
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
              <div className="input-label">Apply To</div>
              <div className="segmented">
                <div className={"seg" + (scope === "this" ? " active" : "")} role="button" tabIndex={0} onClick={() => setScope("this")}>This event</div>
                <div className={"seg" + (scope === "series" ? " active" : "")} role="button" tabIndex={0} onClick={() => setScope("series")}>All events</div>
              </div>
            </div>
          )}

          {canAttach && (attached.length > 0 || attachable.length > 0) && (
            <div className="field">
              <div className="input-label">Attached Tasks</div>
              {attached.length > 0 && (
                <div className="att-list">
                  {attached.map((t) => (
                    <div className={"task-row" + (t.done ? " completed" : "")} key={t.id}>
                      <div
                        className="task-check-tap"
                        role="checkbox"
                        aria-checked={t.done}
                        aria-label={t.done ? "Mark not done" : "Mark done"}
                        onClick={() => onToggleTask?.(t.id)}
                      >
                        <div className={"task-check " + (t.done ? "done" : "cat-bd-" + catColor(t.category))} />
                      </div>
                      <div className="row-stack">
                        <div className="conn-name truncate">{t.text}</div>
                      </div>
                      <button type="button" className="note-fix" onClick={() => setTaskIds((ids) => ids.filter((x) => x !== t.id))}>Detach</button>
                    </div>
                  ))}
                </div>
              )}
              {attachable.length > 0 && (
                <div className="chip-row cat-pick">
                  {attachable.map((t) => (
                    <div key={t.id} className="chip" role="button" tabIndex={0} onClick={() => setTaskIds((ids) => [...ids, t.id])}>
                      <span className={"cat-dot cat-bg-" + catColor(t.category)} />{t.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="field">
            <label className="input-label">Location</label>
            <input className="input" placeholder="Place or address (optional)" value={location} onChange={(e) => setLocation(e.target.value)} />
            {locSugs.length > 0 && (
              <div className="chip-row mem-row">
                {locSugs.map((l) => (
                  <div key={l} className="chip" role="button" tabIndex={0} onClick={() => setLocation(l)}>{l}</div>
                ))}
              </div>
            )}
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
          {mode === "edit" && onMoveToAnytime && recurrence === "none" && (
            <button className="btn btn-secondary btn-block" onClick={onMoveToAnytime}>Move to Anytime</button>
          )}
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
