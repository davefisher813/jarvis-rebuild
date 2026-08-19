import { useState } from "react";
import { createPortal } from "react-dom";
import { DAY_PRESETS } from "../reminders";
import type { ReminderInfo } from "../../notes/types";

// TWO TAPS (Dave 2026-08-19). A reminder needs a name, a time, and how often.
// That is the entire form. No category, no duration, no end date, no project,
// no notes: every field this sheet does NOT have is a field the task sheet has
// and a reason "just remind me to take my meds" used to feel like paperwork.
export default function ReminderSheet({
  initial,
  mode = "new",
  onSave,
  onDelete,
  onAddToCalendar,
  onCancel,
}: {
  initial?: { text: string; reminder: ReminderInfo };
  mode?: "new" | "edit";
  onSave: (text: string, r: ReminderInfo) => void;
  onDelete?: () => void;
  onAddToCalendar?: () => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial?.text ?? "");
  const [time, setTime] = useState(initial?.reminder.time ?? "08:00");
  const [days, setDays] = useState<number[] | undefined>(initial?.reminder.days);
  const [err, setErr] = useState(false);

  const sameDays = (a?: number[], b?: number[]) => {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return [...a].sort().join() === [...b].sort().join();
  };

  const save = () => {
    if (!text.trim()) { setErr(true); return; }
    onSave(text.trim(), { ...initial?.reminder, time, days });
  };

  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{mode === "edit" ? "Reminder" : "New Reminder"}</div></div>
        <div className="pad-x sheet-form">
          <input
            className={"input" + (err && !text.trim() ? " input-error" : "")}
            aria-label="Reminder"
            placeholder="Meds"
            value={text}
            onChange={(e) => { setText(e.target.value); setErr(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") save(); }}
          />
          <div className="field">
            <div className="input-label">Time</div>
            <input className="input" type="time" aria-label="Time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <div className="field">
            <div className="input-label">Repeat</div>
            <div className="segmented">
              {DAY_PRESETS.map((p) => (
                <div
                  key={p.label}
                  className={"seg" + (sameDays(days, p.days) ? " active" : "")}
                  role="button"
                  tabIndex={0}
                  onClick={() => setDays(p.days)}
                >{p.label}</div>
              ))}
            </div>
          </div>
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-block" onClick={save}>Save</button>
          {/* THE HONEST LINE (2026-08-19). A web app cannot fire its own
              alarm on iOS, so rather than let a reminder look like it will
              ping and quietly not, JARVIS says so and hands the job to the
              scheduler already on the phone. */}
          {mode === "edit" && onAddToCalendar && (
            <>
              <button className="btn btn-secondary btn-block" onClick={onAddToCalendar}>Add to iPhone Calendar</button>
              <div className="input-help">JARVIS can't send alerts on the web yet. Your Calendar can, and it works offline.</div>
            </>
          )}
          {mode === "edit" && onDelete && (
            <button className="btn btn-danger btn-block" onClick={onDelete}>Delete Reminder</button>
          )}
          <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
