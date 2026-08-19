import { Check, Plus, CalendarPlus } from "lucide-react";
import { Burst } from "../shared/Burst";
import { useRef, useState } from "react";
import type { ReminderView } from "../tasks/reminders";

// THE REMINDERS STRIP (Dave 2026-08-19: "taking meds should just be a set
// reminder"). One line each, the time, the thing, a circle. Tap the circle,
// done, gone until tomorrow.
//
// Deliberately NOT a task list: no due dates, no category kickers, no counts,
// no overdue styling. A missed reminder greys its time rather than reddening
// it, because "you didn't take your meds yet" is information and "YOU ARE
// LATE" is a reason to stop opening the app.
export default function RemindersStrip({
  items,
  onTick,
  onSnooze,
  onAdd,
  onOpen,
  onAddAllToCalendar,
}: {
  items: ReminderView[];
  onTick?: (id: string, done: boolean) => void;
  onSnooze?: (id: string) => void;
  onAdd?: () => void;
  onOpen?: (id: string) => void;
  onAddAllToCalendar?: () => void;
}) {
  const [burstId, setBurstId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const celebrate = (id: string) => {
    setBurstId(null);
    if (timer.current) clearTimeout(timer.current);
    requestAnimationFrame(() => {
      setBurstId(id);
      timer.current = setTimeout(() => setBurstId(null), 500);
    });
  };

  if (items.length === 0 && !onAdd) return null;

  return (
    <>
      <div className="sh2">
        <span className="t">Reminders</span>
        {onAdd && <button className="see-all" onClick={onAdd}>Add</button>}
      </div>
      <div className="pad-x"><div className="card">
        {items.map((r) => (
          <div className={"rem-row" + (r.done ? " done" : "") + (r.missed ? " missed" : "")} key={r.id}>
            <div
              className={"cb" + (r.done ? " on" : "") + (burstId === r.id ? " just-checked" : "")}
              role="button"
              tabIndex={0}
              aria-label={r.done ? "Undo " + r.text : "Mark " + r.text + " done"}
              onClick={() => { if (!r.done) celebrate(r.id); onTick?.(r.id, !r.done); }}
            >
              {r.done && <Check className="ic" />}
              <Burst show={burstId === r.id} />
            </div>
            {/* A missed reminder marks its TIME, not the whole row: it needs
                to be findable, not accusatory. Never red, never a count. */}
            <span className="rem-time">{r.time}</span>
            <div className="row-grow" role="button" tabIndex={0} onClick={() => onOpen?.(r.id)}>
              <div className="rem-name">{r.text}</div>
            </div>
            {/* Snooze only exists while it still matters: once it is done,
                pushing it later is nonsense. */}
            {!r.done && onSnooze && (
              <button className="pill-act" onClick={() => onSnooze(r.id)}>
                {r.snoozed ? "+10 again" : "Snooze"}
              </button>
            )}
          </div>
        ))}
        {items.length === 0 && onAdd && (
          <button className="row row-act" onClick={onAdd}>
            <Plus className="ic" />Add a Reminder
          </button>
        )}
        {/* Trailing in-list action (button law O4). One tap hands every
            reminder to iOS Calendar, which is the only thing on the phone
            that can actually make them go off. */}
        {items.length > 0 && onAddAllToCalendar && (
          <button className="row row-act" onClick={onAddAllToCalendar}>
            <CalendarPlus className="ic" />Add All to Calendar
          </button>
        )}
      </div></div>
    </>
  );
}
