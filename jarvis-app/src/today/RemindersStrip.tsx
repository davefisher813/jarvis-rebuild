import { Check, Plus, CalendarPlus } from "../shared/icons";
import { Burst } from "../shared/Burst";
import React, { useRef, useState } from "react";
import { useSwipe } from "../shared/useSwipe";
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
// UP-CORE-15 (2026-09-05): SWIPE RIGHT TAKES IT. One row, one gesture, the
// same one a task and a bill answer to: the whole row is the target, which
// is what a thumb on a moving bus actually hits. Extracted from the map so
// the row can own a hook; a reminder already ticked has nothing to take.
function ReminderRow({ r, bursting, onTickRow, children }: {
  r: ReminderView;
  bursting: boolean;
  onTickRow: () => void;
  children: React.ReactNode;
}) {
  const completable = !r.done;
  // No left reveal on this strip: a reminder's other actions are its own
  // pill and its sheet, and revealW 0 keeps the gesture one-directional.
  const swipe = useSwipe({ revealW: 0, rightW: completable ? 88 : 0, ...(completable ? { onRightCommit: onTickRow } : {}) });
  return (
    <div className="task-swipe">
      {completable && (
        <div className="task-done-rail" aria-hidden="true">
          <Check className="ic" />
          <span className="swipe-label">Done</span>
        </div>
      )}
      <div
        className={"rem-row" + (r.done ? " done" : "") + (r.missed && !r.letGo ? " missed" : "") + (r.letGo ? " let-go" : "") + (swipe.dragging ? " swiping" : "")}
        style={swipe.dx ? { transform: `translateX(${swipe.dx}px)` } : undefined}
        {...swipe.handlers}
      >
        {children}
      </div>
    </div>
  );
}

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
        {onAdd && items.length > 0 && <button className="see-all pill-action" onClick={onAdd}>Add</button>}
      </div>
      <div className="pad-x"><div className="card">
        {items.map((r) => (
          <ReminderRow key={r.id} r={r} bursting={burstId === r.id}
            onTickRow={() => { if (!r.done) celebrate(r.id); onTick?.(r.id, !r.done); }}>
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
            {/* BROWSER-F-07 (2026-09-05): the name is what you tap to open a
                reminder and it measured 226x22. The row around it is already
                44 (min-height on .rem-row) and nothing else lives above or
                below the name, so .tap44 takes the free space the row was
                keeping for nobody. */}
            <div className="row-grow tap44" role="button" tabIndex={0} onClick={() => onOpen?.(r.id)}>
              <div className="rem-name">{r.text}</div>
            </div>
            {/* Snooze only exists while it still matters: once it is done,
                pushing it later is nonsense. */}
            {/* TODAY-F-04 (2026-09-05): one label, and it says the size of
                the push. "Snooze" then "+10 again" described a stack of ten
                minute pushes onto the reminder's original time; a snooze is
                ten minutes from now, whether it is the first or the third. */}
            {!r.done && onSnooze && (
              <button className="pill-act" onClick={() => onSnooze(r.id)}>Snooze 10m</button>
            )}
          </ReminderRow>
        ))}
        {items.length === 0 && onAdd && (
          <button className="row row-act" onClick={onAdd}>
            <Plus className="ic" />Add a Reminder
          </button>
        )}
      </div></div>
      {/* OUTSIDE THE CARD, LIKE CLEAR ALL (Dave 2026-09-11: "the add all to
          calendar button should render exactly the same as the clear all
          button above it. Not inside the container").
          It was a trailing in-list row, which put a full-width control inside
          a card of reminders -- so it read as a third reminder rather than as
          the thing you do WITH the reminders. Clear All two sections up is the
          same shape of action and it hangs under its card; this one hangs the
          same way, same row, same pill. */}
      {items.length > 0 && onAddAllToCalendar && (
        <div className="notice-clear-row">
          <button className="row-act" onClick={onAddAllToCalendar}>
            <CalendarPlus className="ic" />Add All to Calendar
          </button>
        </div>
      )}
    </>
  );
}
