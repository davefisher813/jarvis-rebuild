import { Check, Plus, CalendarPlus } from "../shared/icons";
import { Burst } from "../shared/Burst";
import { useRef, useState } from "react";
import type { ReminderView } from "../tasks/reminders";
import { fmtTime } from "../schedule/calendar";

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
      {/* I3 (2026-08-24): quiet, like every other head on Today. Now is the
          only section on that page allowed the accent. This strip renders its
          own head rather than taking TodayPage's, which is exactly how it
          survived the first sweep. */}
      <div className="sh2 sh2-quiet">
        <span className="t">Reminders</span>
        {/* One Add, never two. An empty strip shows the LABELLED in-list create
            (which is discoverable); a populated one shows the head action
            (which is out of the way). Both at once is two controls for one
            job, six pixels apart. */}
        {onAdd && items.length > 0 && <button className="see-all" onClick={onAdd}>Add</button>}
      </div>
      <div className="pad-x"><div className="card">
        {items.map((r) => (
          <div className={"rem-row" + (r.done ? " done" : "") + (r.missed && !r.letGo ? " missed" : "") + (r.letGo ? " let-go" : "")} key={r.id}>
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
            {/* 12-HOUR, LIKE EVERY OTHER TIME IN THE APP (Dave 2026-08-22:
                "reminders are rendering in military time"). r.time is the
                stored HH:MM; every other surface runs it through fmtTime and
                this one printed it raw, so 9 PM meds read "21:00". */}
            <span className="rem-time">{fmtTime(r.time).time}<span className="ampm">{fmtTime(r.time).ap}</span></span>
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
