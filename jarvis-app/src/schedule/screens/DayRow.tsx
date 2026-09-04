import { useRef, useState } from "react";
import type { EventItem } from "../types";
import { useSwipe } from "../../shared/useSwipe";
import { useChipInView } from "../../shared/useChipInView";
import { fmtTime, fmtDistance } from "../calendar";
import { catColor, catName } from "../../shared/categories";
import { attachLabel } from "../attachments";
import { DUR_CHOICES, durLabel, minutesBetween, endFor } from "../durations";
import { Check as CheckGlyph } from "../../shared/icons";
import { EventWeatherLine } from "../../weather/WeatherLine";

// One event row on the Schedule day list. Same anatomy as before, plus the
// roadmap-v2 basics: swipe left reveals Push 15 / Tomorrow (recurring events
// keep tap-to-edit only: shifting a whole series from a swipe is a footgun),
// the next upcoming event carries a time-as-distance label, and past events
// dim. Tap always opens the editor.
//
// The chevron (Dave 2026-08-07, "it's something you don't wanna tap on because
// it's a headache") exists because the swipe alone had two problems. It was
// invisible: nothing on screen said the actions were there, so the fast path
// only helped someone who already knew about it. And it was bound to
// onTouchStart/Move/End only, which meant +15 min and Tomorrow were literally
// unreachable with a mouse or a keyboard, on a row whose every other action
// was not. The chevron is the same reveal, announced and operable by anyone.

export interface GymDoorView {
  /** Real minutes stamped for this date -- the block already earned its
   *  receipt. */
  trainedMin?: number;
  /** The pinned day's name, when the athlete's pins claim this weekday. */
  dayName?: string;
  /** Derived facts: "7 exercises · Est 52 min · Last trained Aug 24". */
  meta?: string;
  /** Present only when starting makes sense (today). Opens the gym. */
  onStart?: () => void;
}

export default function DayRow({
  e,
  conflict,
  onFixOverlap,
  attach,
  isNext,
  isPast,
  now,
  onOpen,
  onShift,
  onMoveTo,
  onSkipToday,
  onPushTomorrow,
  onSetEnd,
  selecting = false,
  picked = false,
  onPick,
  weatherDateIso,
  gymDoor,
}: {
  e: EventItem;
  conflict: boolean;
  // N5 completion (hotfix 2026-08-21): the Overlaps badge stops being inert.
  // Tapping it opens the fix sheet for this row's clash instead of the editor.
  onFixOverlap?: () => void;
  attach?: { total: number; done: number }; // attached tasks (Session 4)
  isNext: boolean;
  isPast: boolean;
  now: string | null; // "HH:MM" when viewing today, else null
  onOpen?: () => void;
  onShift?: (mins: number) => void;
  onMoveTo?: (start: string) => void;
  onSkipToday?: () => void;
  onPushTomorrow?: () => void;
  // B3/B5 (2026-08-23): change how LONG this is, without the full editor.
  onSetEnd?: (end: string) => void;
  // Select mode (2026-08-24, bulk delete). The row picks instead of opening,
  // and every control inside it stands down: a half-swiped row under a
  // selection is two gestures fighting, and a time picker opening from a row
  // you meant to tick is the tap-stealing bug all over again.
  selecting?: boolean;
  picked?: boolean;
  onPick?: () => void;
  // Weather Fact (2026-08-28, brought over from Today's own row so the two
  // lists share one implementation instead of two that can drift). Only
  // Today passes a date: an event with a location happening TODAY is where
  // weather matters, and a past row never shows it.
  weatherDateIso?: string;
  // THE TRAINING DOOR (D4-C): present only on events the athlete marked as
  // the gym. The row grows the day's lift, its facts, and the way in.
  gymDoor?: GymDoorView | null;
}) {
  const t = fmtTime(e.data.start);
  const endT = e.data.end ? fmtTime(e.data.end) : null;
  const rep = e.data.recurrence && e.data.recurrence !== "none" ? e.data.recurrence : null;
  const dist = isNext && now ? fmtDistance(e.data.start, now) : null;

  // The one shared swipe controller, so every list feels the same. (The old
  // local copy's dx-ref lesson from audit 2026-08-07 lives inside useSwipe
  // now: release always judges the position the finger actually reached.)
  // REPEATING EVENTS ARE MOVABLE (Dave 2026-08-19, "locked in stuff should be
  // moveable with no issue"). They used to be excluded from this line
  // entirely, which is exactly why they felt welded to the calendar. What is
  // dangerous is moving a SERIES by accident, and the flow handles that by
  // moving one day only and saying so in the toast.
  const swipeable = !selecting && !isPast && (onShift || onPushTomorrow || onSkipToday);
  const { dx, open, dragging, handlers, closeThen, toggle } = useSwipe({ revealW: rep ? 268 : 232, enabled: !!swipeable });
  const [picking, setPicking] = useState(false);
  const [sizing, setSizing] = useState(false);
  const durs = useRef<HTMLDivElement>(null);
  useChipInView(durs, sizing);
  const mins = e.data.end ? minutesBetween(e.data.start, e.data.end) : null;

  return (
    <div className="sched-swipe-wrap">
      {/* THE STRIP IS THE ROW'S BOX, NOT THE WHOLE CARD (2026-08-24).
          .sched-actions is absolutely positioned to bottom:0 of its
          containing block. That used to be .sched-swipe-wrap, which was fine
          while the row was the only thing in it. B5 put the length editor in
          there too, so opening it grew the wrapper by 144px and the orange
          swipe rail grew with it: measured at 218px tall behind a 68px row,
          painting straight over the duration chips.
          The actions belong to the ROW, so they get a box that only ever
          contains the row. Clipping moves here with them; the wrapper keeps
          position:relative for the time popover and now no longer crops it. */}
      <div className="sched-strip">
      {swipeable && (
        // tabIndex mirrors aria-hidden (audit 2026-08-07): aria-hidden with
        // still-focusable children is an ARIA violation, and it let keyboard
        // users tab into buttons that were visually absent.
        <div className="sched-actions" aria-hidden={!open}>
          {/* Back 15 exists because until now nothing in the app could move
              an event EARLIER: every control only ever pushed later. */}
          {onShift && <button className="sched-act" tabIndex={open ? 0 : -1} onClick={() => closeThen(() => onShift(-15))}>&minus;15m</button>}
          {onShift && <button className="sched-act" tabIndex={open ? 0 : -1} onClick={() => closeThen(() => onShift(15))}>+15m</button>}
          {onShift && <button className="sched-act" tabIndex={open ? 0 : -1} onClick={() => closeThen(() => onShift(60))}>+1h</button>}
          {rep
            ? onSkipToday && <button className="sched-act sched-act-quiet" tabIndex={open ? 0 : -1} onClick={() => closeThen(onSkipToday)}>Skip Today</button>
            : onPushTomorrow && <button className="sched-act sched-act-quiet" tabIndex={open ? 0 : -1} onClick={() => closeThen(onPushTomorrow)}>Tomorrow</button>}
        </div>
      )}
      <div
        className={"sched-row" + (conflict ? " sched-row-warn" : "") + (isPast ? " past" : "") + (dragging ? " swiping" : "")}
        style={swipeable ? { transform: `translateX(${dx}px)` } : undefined}
        role="button"
        tabIndex={0}
        onClick={() => (selecting ? onPick?.() : open ? closeThen() : onOpen?.())}
        {...handlers}
      >
        {/* THE CATEGORY BAR (Dave 2026-08-19, "doesn't show which category
            things are tied to"): the dot on the third line was there but read
            as absent. This is the same fact at a glance, no reading. */}
        <span className={"sched-bar cat-bg-" + catColor(e.data.category)} />
        {selecting && (
          <button
            type="button"
            className={"sel-box sched-sel" + (picked ? " on" : "")}
            role="checkbox" aria-checked={picked}
            aria-label={(picked ? "Deselect " : "Select ") + e.data.title}
            onClick={(ev) => { ev.stopPropagation(); onPick?.(); }}
          >{picked && <CheckGlyph className="ic" />}</button>
        )}
        {selecting ? (
          <div className="sched-time">{t.time}<span className="ampm">{t.ap}</span></div>
        ) : onMoveTo ? (
          <button
            type="button"
            className="sched-time sched-time-btn"
            aria-label={"Change time or length, currently " + t.time + " " + t.ap}
            onClick={(ev) => { ev.stopPropagation(); setPicking(true); }}
          >{t.time}<span className="ampm">{t.ap}</span></button>
        ) : (
          <div className="sched-time">{t.time}<span className="ampm">{t.ap}</span></div>
        )}
        <div className="sched-body">
          <div className="sched-title">
            {e.data.title}
            {conflict && (onFixOverlap && !selecting ? (
              <button
                type="button"
                className="sched-badge sched-badge-btn"
                aria-label="Overlaps another event, tap to fix"
                onClick={(ev) => { ev.stopPropagation(); onFixOverlap(); }}
              >Overlaps</button>
            ) : (
              <span className="sched-badge">Overlaps</span>
            ))}
            {dist && <span className="sched-dist">{dist}</span>}
          </div>
          {/* THE DOT BREAKS (2026-08-23). Dave reported this as "Work Repeats
              daily" with nothing between the category and the recurrence, and
              adding the length button made it worse: "Work Set Length Repeats
              daily" reads as one run-on phrase. Every segment on this line is
              a separate fact and gets the separator the rest of the app uses,
              which also brings it under the dot-break casing law instead of
              slipping past it on a technicality. */}
          <div className="sched-cat">
            <span className={"cat-dot cat-bg-" + catColor(e.data.category)} />
            {/* No area: say so, don't leave a dot hanging before the first
                separator (Dave 2026-09-04; same words the task rows use). */}
            {catName(e.data.category) || "No category"}
            {/* B3/B5 (2026-08-23): "until 10:00 AM" was the last piece of
                dead text on this row, and it names the one thing about an
                event that nothing here could change: its LENGTH. Tap the
                time to move it, tap the until to resize it. Same popover, so
                the second control costs nothing to learn.

                A row with no end has no length to state, so instead of
                rendering nothing it offers to give it one. */}
            {/* ONE GREY LINE (A Cleaner Top, Dave 2026-09-02, picked "In the
                one grey meta line"). It reads area, length, repeat, place,
                in that order, all in the same quiet ink.

                THE RED CAPSULE IS GONE. A block with no end wore "Set
                Length" as an accent capsule, which put a red verb on nearly
                every row of the day: red is a verb in this app and it was
                being spent on a field that happens to be blank. A block
                with no length now says nothing, and the way to give it one
                is the same tap that moves it (see the time popover below,
                which carries both) -- his own note on the pick: "I would
                like the same functionality as the option you recommended as
                well". The length, once set, is still the door to changing
                it, so nothing that was reachable stopped being reachable.

                The length is the SPAN, not the end time: "30m" is what you
                are deciding when you pick a duration chip, and "Until 9:00
                AM" made every row do arithmetic to answer "how long". */}
            {mins != null && (
              <>
                <span className="sched-sep">&middot;</span>
                {onSetEnd && !selecting ? (
                  <button
                    type="button"
                    className="sched-until sched-until-btn"
                    aria-label={"Change length, currently " + mins + " minutes"}
                    aria-expanded={sizing}
                    onClick={(ev) => { ev.stopPropagation(); setSizing(!sizing); }}
                  >{durLabel(mins)}</button>
                ) : (
                  <span className="sched-until">{durLabel(mins)}</span>
                )}
              </>
            )}
            {rep && <><span className="sched-sep">&middot;</span><span className="sched-rep">{rep.charAt(0).toUpperCase() + rep.slice(1)}</span></>}
            {/* The place joins the line instead of taking one of its own in
                accent red. It is still the link it was. */}
            {e.data.location && (
              <>
                <span className="sched-sep">&middot;</span>
                <a
                  className="sched-loc truncate"
                  href={"https://maps.apple.com/?q=" + encodeURIComponent(e.data.location)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(ev) => ev.stopPropagation()}
                >{e.data.location}</a>
              </>
            )}
            {weatherDateIso && !isPast && e.data.location && <EventWeatherLine dateIso={weatherDateIso} start={e.data.start} />}
          </div>
          {attach && (
            <div className="sched-cat">
              <svg className="ic clip-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
              {attachLabel(attach)}
            </div>
          )}
          {/* THE TRAINING DOOR (D4-C): "it names the day's lift, taps
              straight into the session, and when you finish, the block
              stamps itself done with the real minutes." Start is a capsule,
              not a filled red -- the schedule page already spends its one
              red on Plan My Day. */}
          {gymDoor && !selecting && (
            <div className="sched-gym" onClick={(ev) => ev.stopPropagation()}>
              {gymDoor.trainedMin != null ? (
                <div className="sched-cat sched-gym-line">
                  <span className="pill pill-good">Trained</span>
                  <span>{gymDoor.trainedMin} min</span>
                </div>
              ) : (
                <>
                  {gymDoor.dayName && <div className="sched-gym-name">{gymDoor.dayName}</div>}
                  {gymDoor.meta && <div className="sched-cat">{gymDoor.meta}</div>}
                  {gymDoor.onStart && (
                    <button type="button" className="pill-act sched-gym-start" onClick={gymDoor.onStart}>
                      {gymDoor.dayName ? `Start ${gymDoor.dayName}` : "Start Training"}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        {swipeable && (
          <button
            type="button"
            className={"sched-grip" + (open ? " open" : "")}
            aria-label={open ? "Hide quick actions" : "Quick actions"}
            aria-expanded={open}
            onClick={(ev) => { ev.stopPropagation(); toggle(); }}
          >
            <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
        )}
      </div>
      </div>
      {/* TAP THE UNTIL (B5): the same move for the other half of the block.
          Chips, not a stepper, because PlanDaySheet already settled that:
          45m to 2h is one tap on a chip and five on a stepper. The list is
          the shared one, so the plan sheet, a proposed row and a real event
          all offer exactly the same lengths.

          IN PLACE, not a popover. The first build floated it the way the
          time picker floats, and the browser walk caught it half hidden
          behind the capture bar on any row low in the list. It is also just
          the wrong shape: ProposedRow already expands in place with these
          exact controls, and two ways to edit a row is how the app grew two
          schedule formats in the first place. Same .plan-controls, so the
          surfaces cannot drift. */}
      {sizing && onSetEnd && (
        <div className="draft-edit-body" onClick={(ev) => ev.stopPropagation()}>
          <div className="plan-controls">
            <div className="chip-row plan-durs" ref={durs}>
              {DUR_CHOICES.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={"chip" + (mins === d ? " chip-on" : "")}
                  aria-label={e.data.title + ": " + d + " minutes"}
                  onClick={() => { setSizing(false); onSetEnd(endFor(e.data.start, d)); }}
                >{durLabel(d)}</button>
              ))}
            </div>
            <div className="plan-when">
              <button type="button" className="btn-sm" onClick={() => setSizing(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
      {/* TAP THE TIME (M3): a time change should not cost the whole editor.
          AMENDED 2026-09-02 (A Cleaner Top, Dave on the meta-line pick: "I
          would like the same functionality as the option you recommended as
          well"). The recommended shape put the length under the time and
          set it by tapping there. He took the other line but wants that
          reach, so the time popover carries both halves of the block now:
          when it starts, and how long it runs. That is also what makes the
          red "Set Length" capsule removable -- a block with no length is
          still one tap from having one, at the control you would tap. */}
      {picking && onMoveTo && (
        <>
          <div className="time-pop-scrim" onClick={() => setPicking(false)} />
          <div className="time-pop">
            <input
              className="input time-pop-input"
              type="time"
              aria-label="New time"
              defaultValue={e.data.start}
              onChange={(ev) => { const v = ev.target.value; if (v) { setPicking(false); onMoveTo(v); } }}
            />
            {onSetEnd && (
              <div className="time-pop-durs">
                <div className="input-label">How Long</div>
                <div className="chip-row plan-durs">
                  {DUR_CHOICES.map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={"chip" + (mins === d ? " chip-on" : "")}
                      aria-label={e.data.title + ": " + d + " minutes"}
                      onClick={() => { setPicking(false); onSetEnd(endFor(e.data.start, d)); }}
                    >{durLabel(d)}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
