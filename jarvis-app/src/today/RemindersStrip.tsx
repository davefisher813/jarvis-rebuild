import { Check, Plus, CalendarPlus, Trash2 } from "../shared/icons";
import { Burst } from "../shared/Burst";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSwipe } from "../shared/useSwipe";
import type { ReminderView } from "../tasks/reminders";
import { fmtTime } from "../schedule/calendar";
import { catColor, catName } from "../shared/categories";
import { titleCase } from "../shared/casing";

/** The area's name, when it has one to give. */
const area = (r: { category: string }) => (r.category ? catName(r.category) : "");

// THE REMINDERS STRIP (Dave 2026-08-19: "taking meds should just be a set
// reminder"). One line each, the time, the thing, a circle. Tap the circle,
// done, gone until tomorrow.
//
// Deliberately NOT a task list: no due dates, no category TEXT kicker, no
// counts. A missed reminder marks its TIME in the Colour Key's red (§AM,
// 2026-09-25: missed is one of the key's red meanings), and only its time:
// never the whole row, never a count of how many were missed. "You didn't
// take your meds yet" is information, findable at a glance; a row or a
// number shouting "YOU ARE LATE" is a reason to stop opening the app.
//
// One dot of colour restored (Dave 2026-09-15: "the reminders on the
// homepage look too dull"): a single small category-colour dot before the
// name, the same dot the Reminders page already uses, no text label riding
// with it. Still not a kicker (a kicker names the category in words), still
// no counts, no due-date phrasing, and no red beyond a missed time's.
// UP-CORE-15 (2026-09-05): SWIPE RIGHT TAKES IT. One row, one gesture, the
// same one a task and a bill answer to: the whole row is the target, which
// is what a thumb on a moving bus actually hits. Extracted from the map so
// the row can own a hook; a reminder already ticked has nothing to take.
function ReminderRow({ r, bursting, onTickRow, onDeleteRow, children }: {
  r: ReminderView;
  bursting: boolean;
  onTickRow: () => void;
  onDeleteRow?: () => void;
  children: React.ReactNode;
}) {
  const completable = !r.done;
  // DELETE IS ON THE SWIPE (Dave 2026-09-20: "should be able to delete
  // always"). The comment here used to read "No left reveal on this strip: a
  // reminder's other actions are its own pill and its sheet", which was true
  // and was the problem: a reminder added by mistake could be ticked from the
  // row and removed from nowhere, on the one screen he actually reads. Left is
  // the delete side on Tasks, Notes, Mail and the gym set; this strip was
  // answering to exactly one gesture out of the two every other list offers.
  const swipe = useSwipe({ revealW: onDeleteRow ? 88 : 0, rightW: completable ? 88 : 0, ...(completable ? { onRightCommit: onTickRow } : {}) });
  return (
    <div className="task-swipe">
      {completable && (
        <div className="task-done-rail" aria-hidden="true">
          <Check className="ic" />
          <span className="swipe-label">Done</span>
        </div>
      )}
      {onDeleteRow && (
        <button className="task-del" onClick={() => swipe.closeThen(onDeleteRow)} aria-label={"Delete " + r.text}>
          <Trash2 className="ic" />
          <span className="swipe-label">Delete</span>
        </button>
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

// THE MISSED LIST (Dave's pass-off, 2026-09-26). One red row on the strip
// says how many were missed; this is what it opens: each missed reminder on
// its own row, and one tap on the row (or its ring) marks it done. The
// caller's tick offers Undo in its toast, so a wrong tap is one tap back.
// The times are not red here: the sheet's own title says missed, once, and
// the key's red on a sheet's grouped grey does not clear AA (§AM, 2026-09-26).
function MissedSheet({ missed, onTick, onClose }: {
  missed: ReminderView[];
  onTick: (id: string) => void;
  onClose: () => void;
}) {
  // The last one ticked closes the sheet: an empty list under "Missed" is a
  // screen with nothing to do on it.
  useEffect(() => { if (missed.length === 0) onClose(); }, [missed.length]);
  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="opt-bar">
          <div className="opt-title">Missed Reminders</div>
          <button type="button" className="opt-done" onClick={onClose}>Done</button>
        </div>
        <div className="sheet-list">
          <div className="pad-x"><div className="card list-card-ruled">
            {missed.map((r) => (
              <div key={r.id} className="rem-row rem-tick-row" role="button" tabIndex={0}
                aria-label={"Mark " + titleCase(r.text) + " done"}
                onClick={() => onTick(r.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onTick(r.id); } }}>
                <div className="cb" aria-hidden="true" />
                <span className="rem-time">{fmtTime(r.time).time}<span className="ampm">{fmtTime(r.time).ap}</span></span>
                <div className="row-grow">
                  <div className="rem-name"><span className="rem-name-t">{titleCase(r.text)}</span></div>
                  {area(r) && (
                    <div className="facts">
                      <span className="fact cat">
                        <span className={"cd cat-bg-" + catColor(r.category)} />
                        <span className="cat-t">{area(r)}</span>
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div></div>
        </div>
        <div className="xs-foot" />
      </div>
    </div>,
    document.body,
  );
}

export default function RemindersStrip({
  items,
  missed = [],
  onTick,
  onTickMissed,
  onSnooze,
  onAdd,
  onOpen,
  onDelete,
  onAddAllToCalendar,
  onSeeAll,
}: {
  /** THE NEXT THREE (Dave's pass-off, 2026-09-26): what is still ahead of
   *  the clock, soonest first, and no more than three (stripPick). */
  items: ReminderView[];
  /** The missed ones, shown as ONE red count row that opens their list. */
  missed?: ReminderView[];
  /** The Reminders page: everything, organised by when. */
  onSeeAll?: () => void;
  onTick?: (id: string, done: boolean) => void;
  /** One tap on a row of the missed list: mark it done (the caller's toast
   *  offers Undo). */
  onTickMissed?: (id: string) => void;
  onSnooze?: (id: string) => void;
  onAdd?: () => void;
  onOpen?: (id: string) => void;
  /** Swipe left, Delete. Undo is the caller's, in the toast. */
  onDelete?: (id: string) => void;
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

  const [missedOpen, setMissedOpen] = useState(false);
  const hasRows = items.length > 0 || missed.length > 0;

  if (!hasRows && !onAdd) return null;

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
        {onAdd && hasRows && <button className="see-all pill-action" onClick={onAdd}>Add</button>}
        {onSeeAll && <button className="see-all pill-action" onClick={onSeeAll}>See All</button>}
      </div>
      <div className="pad-x"><div className="card">
        {items.map((r) => (
          <ReminderRow key={r.id} r={r} bursting={burstId === r.id}
            onTickRow={() => { if (!r.done) celebrate(r.id); onTick?.(r.id, !r.done); }}
            {...(onDelete ? { onDeleteRow: () => onDelete(r.id) } : {})}>
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
            {/* A missed reminder marks its TIME in the key's red (§AM,
                2026-09-25), not the whole row: it needs to be findable, not
                accusatory. Never a count. */}
            {/* 12-HOUR, LIKE EVERY OTHER TIME IN THE APP (Dave 2026-08-22:
                "reminders are rendering in military time"). r.time is the
                stored HH:MM; every other surface runs it through fmtTime and
                this one printed it raw, so 9 PM meds read "21:00". */}
            {/* THE INVARIANT (the reminders rebuild, 2026-09-15): an unscheduled
                reminder never renders a clock. It says the word instead. */}
            {r.unscheduled
              ? <span className="rem-time rem-unsch">Unscheduled</span>
              : <span className="rem-time">{fmtTime(r.time).time}<span className="ampm">{fmtTime(r.time).ap}</span></span>}
            {/* BROWSER-F-07 (2026-09-05): the name is what you tap to open a
                reminder and it measured 226x22. The row around it is already
                44 (min-height on .rem-row) and nothing else lives above or
                below the name, so .tap44 takes the free space the row was
                keeping for nobody. */}
            <div className="row-grow tap44" role="button" tabIndex={0} onClick={() => onOpen?.(r.id)}>
              {/* The name takes its own element so it can end in an
                  ellipsis rather than wrap (Dave 2026-09-15: "Make sure you
                  have enough money for bills" ran to three lines and the
                  row grew with it). One row, one height, here too. */}
              <div className="rem-name"><span className="rem-name-t">{titleCase(r.text)}</span></div>
              {/* THE AREA SAYS ITS NAME (Dave 2026-09-15: "why is there a
                  yellow dot and no category next to it"). The dot alone was
                  a colour with nothing to read it by. It is the Reminders
                  page's facts line, the same dot and the same plain grey
                  name, so the two surfaces read as one component. No TODAY
                  chip here: every row on this strip is today, and a tag
                  repeated on every row of a view named for it says nothing
                  (the rule Tasks already follows on its Today filter). */}
              {area(r) && !r.done && (
                <div className="facts">
                  <span className="fact cat">
                    <span className={"cd cat-bg-" + catColor(r.category)} />
                    <span className="cat-t">{area(r)}</span>
                  </span>
                </div>
              )}
            </div>
            {/* Snooze only exists while it still matters: once it is done,
                pushing it later is nonsense. */}
            {/* TODAY-F-04 (2026-09-05): one label, and it says the size of
                the push. "Snooze" then "+10 again" described a stack of ten
                minute pushes onto the reminder's original time; a snooze is
                ten minutes from now, whether it is the first or the third. */}
            {!r.done && onSnooze && (
              <button className="pill-act" onClick={() => onSnooze(r.id)}>Adjust</button>
            )}
          </ReminderRow>
        ))}
        {/* ONE RED ROW FOR THE MISSED (Dave's pass-off, 2026-09-26). The
            count wears the key's red (§AM: missed) and the row is the door
            to their list, where each is ticked off in one tap. Never a row
            per missed reminder on Today: a list of things you did not do is
            the opposite of help, and the Heads Up cards already chase the
            first two. */}
        {missed.length > 0 && (
          <div className="rem-row rem-missed-row" role="button" tabIndex={0}
            aria-label={missed.length + (missed.length === 1 ? " Missed Reminder" : " Missed Reminders")}
            onClick={() => setMissedOpen(true)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setMissedOpen(true); } }}>
            <span className="rem-missed-n">{missed.length} Missed</span>
            <div className="chev" />
          </div>
        )}
        {!hasRows && onAdd && (
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
      {missedOpen && (
        <MissedSheet missed={missed} onTick={(id) => onTickMissed?.(id)} onClose={() => setMissedOpen(false)} />
      )}
    </>
  );
}
