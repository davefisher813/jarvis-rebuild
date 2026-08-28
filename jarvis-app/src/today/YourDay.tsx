import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { LATE_CHOICES } from "../schedule/durations";
import type { EventItem } from "../schedule/types";
import { fmtTime, fmtDistance, minToHHMM } from "../schedule/calendar";
import { catColor, catName } from "../shared/categories";
import { isPast } from "./todayData";
import { EventWeatherLine } from "../weather/WeatherLine";
import ProposedRow from "../schedule/screens/ProposedRow";
import { holdersIn, holderFor, holderKey, spanOf, type HoldRange } from "../schedule/nesting";
import HeldTasks from "../schedule/screens/HeldTasks";
import type { PlanBlock } from "../schedule/planDay";

// A standing proposal for this day, plus the handlers that edit it. Absent
// when nothing is drafted, which is most of the time.
export interface ProposedDay {
  blocks: PlanBlock[];
  openId: string | null;
  onToggle: (taskId: string) => void;
  onDuration: (taskId: string, minutes: number) => void;
  onDrop: (taskId: string) => void;
}
import { BullseyeGlyph, CalendarGlyph, LockGlyph } from "../shared/glyphs";

// One confident blend offer per block, keyed by event id. Built by the flow;
// this screen only draws it.
export type BlendMap = Record<string, { text: string; why: string; onAdd: () => void }>;

const WINDOW = 252; // ticker viewport height (px), matches .sched-ticker
// Pausing the day ticker survives leaving Today and coming back.
// Exported so the tests set the same string the app reads. A test that
// hardcodes its own copy of a storage key passes forever after the key is
// renamed, and tests the wrong thing quietly.
export const TICKER_KEY = "jarvis.today.ticker.v1";

// ONE SHAPE (2026-08-24). This used to be a local `{ s, e, label }`, which
// silently discarded the `kind` and `mode` fields that say whether a block
// HOLDS work. The data always arrived (protectedRangesFor supplies it); the
// type threw it away, which is why nesting could not even be asked about on
// this screen. Re-exported under the old name so callers are unchanged.
export type LockedRange = HoldRange;

function Row({ ev, past, dist, onOpen }: { ev: EventItem; past: boolean; dist: string | null; onOpen?: () => void }) {
  const t = fmtTime(ev.data.start);
  return (
    <div className={"sched-row" + (past ? " past" : "")} role="button" tabIndex={0} onClick={onOpen}>
      {/* Category at a glance (Dave 2026-08-19): the dot on the line below is
          still there, but the bar is what you actually see, and it survives
          the scrolling ticker where the dot used to get clipped away. */}
      <span className={"sched-bar cat-bg-" + catColor(ev.data.category)} />
      <div className="sched-time">{t.time}<span className="ampm">{t.ap}</span></div>
      <div className="sched-body">
        <div className="sched-title">{ev.data.title}{dist && <span className="sched-dist">{dist}</span>}</div>
        <div className="sched-cat">
          <span className={"cat-dot cat-bg-" + catColor(ev.data.category)} />
          {catName(ev.data.category)}
          {/* Weather Fact (addendum item 4), day-of, placed events only: an
              event with a location happens somewhere weather matters.
              Threshold-gated, so most rows show nothing. */}
          {!past && ev.data.location && <EventWeatherLine dateIso={todayISODate()} start={ev.data.start} />}
        </div>
      </div>
    </div>
  );
}

const todayISODate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// A protected block from Your Routine, real on the day view. Tap edits the routine.
// I2 (2026-08-24, Dave: the word Protected appeared four times down one
// screenshot). Every one of those rows already carried a lock glyph saying
// exactly that, so the word was the same fact twice on one row and four times
// on one screen. The line it occupied now carries something the row did NOT
// say before: when the block ends.
//
// A HOLDING block gets no lock, because it is not protecting time FROM work,
// it is collecting work into itself. That is also how the Schedule tab
// already draws it.
function LockedRow({ l, past, onOpen, children }: { l: LockedRange; past: boolean; onOpen?: () => void; children?: ReactNode }) {
  const t = fmtTime(minToHHMM(l.s));
  const end = fmtTime(minToHHMM(l.e));
  const holds = holdersIn([l]).length > 0;
  return (
    <div className={"sched-row sched-locked" + (past ? " past" : "")} role="button" tabIndex={0} onClick={onOpen}>
      <div className="sched-time">{t.time}<span className="ampm">{t.ap}</span></div>
      <div className="sched-body">
        <div className="sched-title sched-lock-title">
          {/* Both halves of a merge, and both are right (2026-08-24). The
              other session replaced the inline SVG with the shared glyph;
              this one added the guard, because a block that HOLDS tasks
              already says so and the padlock beside it read as a second,
              contradictory status. Glyph from there, guard from here. */}
          {!holds && <LockGlyph className="ic lock-ic" />}
          {l.label}
        </div>
        <div className="sched-cat">Until {end.time} {end.ap}</div>
        {/* The work this block is holding, at its own times. */}
        {children}
      </div>
    </div>
  );
}

// One full pass of the day: events + protected blocks in time order, with the
// Now line inserted at the right spot and time-as-distance on the next event.
function DaySet({ events, locked = [], now, nowLabel, onOpenEvent, onEditRoutine, blendMap = {}, proposed, fromMin, expandHeld = false }: { events: EventItem[]; locked?: LockedRange[]; now: string; nowLabel: string; onOpenEvent?: (id: string) => void; onEditRoutine?: (blockId?: string) => void; blendMap?: BlendMap; proposed?: ProposedDay; fromMin?: number; expandHeld?: boolean }) {
  const toMin = (hhmm: string) => { const p = hhmm.split(":"); return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0); };
  const nowMin = toMin(now);
  // The distance label ("in 40 minutes") counts down to a COMMITMENT. A
  // proposal is not one yet, so it never wears it.
  const nextId = events.filter((e) => toMin(e.data.start) >= nowMin).sort((a, b) => toMin(a.data.start) - toMin(b.data.start))[0]?.id;
  type Entry =
    | { kind: "event"; ev: EventItem; s: number }
    | { kind: "locked"; l: LockedRange; s: number }
    | { kind: "proposed"; b: PlanBlock; s: number };
  // NESTING (2026-08-24, Dave on a screenshot: "the tasks should be inside
  // deep work. That's another bug"). A focus block PULLS TASKS IN by design,
  // so a task the planner deliberately placed into Deep Work rendering as an
  // unrelated row at the same minute reads as a clash instead of a plan.
  //
  // The Schedule tab already nested committed events. It did NOT nest
  // proposals, and this screen nested neither. One helper, both kinds, both
  // surfaces.
  const holders = holdersIn(locked);
  const heldEv = new Map<string, EventItem[]>();
  const heldProp = new Map<string, PlanBlock[]>();
  const nested = new Set<string>();
  for (const ev of events) {
    const h = holderFor(holders, ...spanOf(ev.data.start, ev.data.end));
    if (!h) continue;
    const k = holderKey(h);
    heldEv.set(k, [...(heldEv.get(k) ?? []), ev]);
    nested.add("e:" + ev.id);
  }
  for (const b of proposed?.blocks ?? []) {
    const h = holderFor(holders, ...spanOf(b.start, b.end));
    if (!h) continue;
    const k = holderKey(h);
    heldProp.set(k, [...(heldProp.get(k) ?? []), b]);
    nested.add("p:" + b.taskId);
  }

  const entries: Entry[] = [
    ...events.filter((ev) => !nested.has("e:" + ev.id))
      .map((ev): Entry => ({ kind: "event", ev, s: toMin(ev.data.start) })),
    ...locked.map((l): Entry => ({ kind: "locked", l, s: l.s })),
    // Proposals join the SAME sort, not a separate list below the day. That
    // is the whole point: one schedule, in time order.
    ...(proposed?.blocks ?? []).filter((b) => !nested.has("p:" + b.taskId))
      .map((b): Entry => ({ kind: "proposed", b, s: toMin(b.start) })),
  ].sort((a, b) => a.s - b.s);
  // Insert the Now line by minutes, simple and correct with locked rows mixed in.
  const out: JSX.Element[] = [];
  // MERGE B (2026-08-24). With Now promoted to this section's head, the list
  // below it is "the rest of today", so anything that has already STARTED is
  // either finished or is the thing the head is describing. Either way it is
  // not the rest of the day, and drawing it again is the duplication the
  // merge exists to remove.
  //
  // No coordination with the head is needed for that: "has started" is
  // s < now, which is exactly what the head can be showing.
  const shown = fromMin === undefined ? entries : entries.filter((en) => en.s >= fromMin);
  let nowPlaced = fromMin !== undefined; // the head IS the now line
  shown.forEach((en, i) => {
    if (!nowPlaced && en.s >= nowMin) { out.push(<NowLine key="now" label={nowLabel} />); nowPlaced = true; }
    if (en.kind === "event") {
      out.push(<Row key={en.ev.id} ev={en.ev} past={isPast(en.ev, now)} dist={en.ev.id === nextId ? fmtDistance(en.ev.data.start, now) : null} onOpen={onOpenEvent ? () => onOpenEvent(en.ev.id) : undefined} />);
      // BLENDING ON TODAY (2026-08-21). Same offer, same anatomy, same one
      // tap as the Schedule tab. It belongs here MORE than there: Today is
      // the page he is on when the drive is forty minutes away.
      const b = blendMap[en.ev.id];
      if (b && !isPast(en.ev, now)) {
        out.push(
          <div className="blend-tuck blend-tuck-today" key={"blend-" + en.ev.id} role="button" tabIndex={0}
            onClick={(e) => { e.stopPropagation(); b.onAdd(); }}>
            <span className="blend-plus" aria-hidden>+</span>
            <div className="row-grow">
              <div className="blend-text truncate">{b.text}</div>
              <div className="blend-why">{b.why}</div>
            </div>
          </div>,
        );
      }
    } else if (en.kind === "proposed") {
      // Keys are prefixed because event ids and task ids share this list.
      out.push(
        <ProposedRow
          key={"prop-" + en.b.taskId}
          block={en.b}
          open={proposed!.openId === en.b.taskId}
          onToggle={() => proposed!.onToggle(en.b.taskId)}
          onDuration={(m) => proposed!.onDuration(en.b.taskId, m)}
          onDrop={() => proposed!.onDrop(en.b.taskId)}
        />,
      );
    } else {
      const k = holderKey(en.l);
      const evs = heldEv.get(k) ?? [];
      const props = heldProp.get(k) ?? [];
      out.push(
        <LockedRow key={"lock-" + i} l={en.l} past={en.l.e <= nowMin} onOpen={onEditRoutine ? () => onEditRoutine(en.l.id) : undefined}>
          {(evs.length > 0 || props.length > 0) && (
            <HeldTasks count={evs.length + props.length} alwaysOpen={expandHeld}>
              <>
              {evs.map((h) => (
                <div className="block-held" key={h.id} role="button" tabIndex={0}
                  onClick={(ev) => { ev.stopPropagation(); onOpenEvent?.(h.id); }}>
                  <span className={"cat-dot cat-bg-" + catColor(h.data.category)} />
                  <span className="block-held-t truncate">{h.data.title}</span>
                  <span className="block-held-u">{fmtTime(h.data.start).time}</span>
                </div>
              ))}
              {props.map((b) => (
                <div className="block-held block-held-prop" key={"p" + b.taskId} role="button" tabIndex={0}
                  onClick={(ev) => { ev.stopPropagation(); proposed?.onToggle(b.taskId); }}>
                  <span className={"cat-dot-hollow cat-bd-" + catColor(b.category)} />
                  <span className="block-held-t truncate">{b.text}</span>
                  <span className="block-held-u">{fmtTime(b.start).time}</span>
                </div>
              ))}
              </>
            </HeldTasks>
          )}
        </LockedRow>,
      );
    }
  });
  if (!nowPlaced) out.push(<NowLine key="now" label={nowLabel} />);
  // Merged mode with nothing ahead: say so rather than render an empty strip
  // under a band that promised "the rest of today".
  if (fromMin !== undefined && shown.length === 0) {
    return <div className="pad-x day-clear">Nothing else scheduled</div>;
  }
  return <>{out}</>;
}

function NowLine({ label }: { label: string }) {
  return (
    <div className="now-line">
      <span className="now-label">Now {label}</span>
      <span className="now-rule" />
    </div>
  );
}

const CalIcon = () => (
  <CalendarGlyph />
);

const FocusIcon = () => (
  <BullseyeGlyph />
);

export default function YourDay({
  events,
  locked = [],
  now,
  nowLabel,
  onSeeAll,
  onPlanDay,
  onPlanTomorrow,
  onRunningLate,
  onFocus,
  onOpenEvent,
  onEditRoutine,
  title = "Your Day",
  emptyText = "Nothing scheduled today",
  blendMap = {},
  proposed,
  footer,
  nowHead,
}: {
  events: EventItem[];
  locked?: LockedRange[];
  now: string;
  nowLabel: string;
  onSeeAll: () => void;
  onPlanDay?: () => void;
  onPlanTomorrow?: () => void;
  onRunningLate?: (mins: number) => void;
  onFocus?: () => void;
  onOpenEvent?: (id: string) => void;
  onEditRoutine?: (blockId?: string) => void;
  title?: string;
  emptyText?: string;
  blendMap?: BlendMap;
  // A standing proposal for this day, rendered inline among the real rows.
  proposed?: ProposedDay;
  // Accept / Not Today, owned by the flow and drawn under the day.
  footer?: React.ReactNode;
  // MERGE B (2026-08-24, Dave: "can't now and your day be combined somehow?").
  // The Now card, rendered as this section's head instead of as its own
  // section above. Passed rather than rebuilt because TodayFlow owns what
  // "now" means; this screen owns where it sits. Absent in the evening, which
  // is exactly when the full-day view is the right one again.
  nowHead?: React.ReactNode;
}) {
  const measureRef = useRef<HTMLDivElement>(null);
  const firstPass = useRef(true);
  const [overflow, setOverflow] = useState(false);
  // PAUSING IS A PREFERENCE, NOT A CHORE (Dave, 2026-08-21: "make the
  // scrolling schedule still an option. If you want to make pausing it
  // easier or something that's fine").
  //
  // The ticker stays. What was hard was stopping it: pause was component
  // state, so every return to Today started it moving again and he had to
  // find the same small button and press it again. Pausing it once now means
  // it is paused, the way turning something off means it is off.
  //
  // The other half is in CSS: touching or hovering the ticker stops it for
  // as long as you are on it. Reaching for a button to read a line you are
  // already looking at is the wrong shape for the problem.
  const [paused, setPaused] = useState(() => {
    try { return localStorage.getItem(TICKER_KEY) === "off"; } catch { return false; }
  });
  const setPausedSticky = (next: boolean) => {
    setPaused(next);
    try { localStorage.setItem(TICKER_KEY, next ? "off" : "on"); } catch { /* private mode */ }
  };

  // THE TWIN IS A MEASUREMENT, NOT A SECOND DAY.
  //
  // Deciding whether the day scrolls means measuring the day the TICKER would
  // show, which is every held task expanded, and the compressed day on screen
  // is not that. So a hidden twin renders the expanded version and gets
  // measured. First cut left the twin mounted permanently, and a permanent
  // twin is a permanent second copy of every row in the document: six
  // existing tests broke on "found multiple elements", which was the DOM
  // telling the truth about a real cost, not a test problem.
  //
  // So it mounts for one frame. `measuring` puts it in the tree, the layout
  // effect reads it before paint and takes it back out. Nothing sees it: not
  // the user, not the accessibility tree, not a text search.
  const [measuring, setMeasuring] = useState(true);
  // WHAT THE DAY IS, AS A STRING, because `locked = []` above is a fresh array
  // on every render and so is `blendMap = {}`. Depending on those references
  // used to be harmless: the effect only ever set `overflow` to the value it
  // already held, and React drops a state write that changes nothing. Now the
  // effect mounts the twin, the twin unmounts itself, and that IS a change, so
  // an unstable dependency became a render loop that hung the test run rather
  // than failing it. Compare the content, not the containers.
  const daySig = events.map((e) => e.id + "@" + e.data.start + ":" + e.data.title).join("|")
    + "//" + locked.map((l) => l.s + "-" + l.e + ":" + l.label).join("|")
    + "//" + (proposed?.blocks ?? []).map((b) => b.taskId + "@" + b.start).join("|");
  useEffect(() => {
    // Skipped on mount, where the layout effect below already measures. Without
    // this, mount measures, unmounts the twin, then this effect remounts it and
    // measures again to reach the same answer.
    if (firstPass.current) { firstPass.current = false; return; }
    setMeasuring(true);
  }, [daySig, now]);
  useLayoutEffect(() => {
    if (!measuring) return;
    const el = measureRef.current;
    // Null while the ticker is running, which renders no twin because the
    // ticker's own content IS the expanded day.
    if (el) setOverflow(el.scrollHeight > WINDOW);
    setMeasuring(false);
  }, [measuring]);

  // Focus (the one-card mode) pairs with Plan My Day when available: Focus is
  // the one red action on the page, Plan My Day drops to the quiet style.
  // Running Late on Today (2026-08-09): the plan lives here, so recovering
  // from a slipped morning cannot require a tab switch. Armed chip row, same
  // vocabulary as the Schedule tab's. Offered only while something ahead can
  // still move.
  const [lateOpen, setLateOpen] = useState(false);
  const hasFuture = !!onRunningLate && events.some((e) => (!e.data.recurrence || e.data.recurrence === "none") && e.data.start >= now);

  const planButton = onPlanDay || onFocus || onPlanTomorrow || hasFuture ? (
    <>
      <div className={"plan-cta-row" + (onPlanDay && onFocus ? " plan-cta-pair" : "")}>
        {/* B15 (2026-08-23): ONE FILL PER SCREEN, and the fill belongs to
            whichever action advances the WHOLE screen.

            This row already ghosted Plan My Day when Focus was beside it,
            but that rule only ever saw these two buttons. It could not see
            the draft footer below, where Accept the Day commits every hour
            of the day at once. With a draft standing, Today rendered three
            filled reds: Start in the Now card, Focus here, and Accept below.

            `footer` is only ever passed while a draft is standing (see
            draftFooter in TodayFlow), so it is the honest signal for "a
            bigger decision is on this screen" without threading a new prop
            down for a fact the component already has. */}
        {onFocus && <button className={"plan-cta plan-cta-block" + (footer ? " plan-cta-ghost" : "")} onClick={onFocus}><FocusIcon />Focus</button>}
        {onPlanDay && <button className={"plan-cta plan-cta-block" + (onFocus || footer ? " plan-cta-ghost" : "")} onClick={onPlanDay}><CalIcon />Plan My Day</button>}
      </div>
      {(onPlanTomorrow || hasFuture) && (
        <div className="plan-cta-row plan-cta-pair">
          {/* Evening: plan the day that still has all its hours (2026-08-09). */}
          {onPlanTomorrow && <button className="plan-cta plan-cta-block plan-cta-ghost" onClick={onPlanTomorrow}><CalIcon />Plan Tomorrow</button>}
          {hasFuture && <button className={"plan-cta plan-cta-block plan-cta-ghost" + (lateOpen ? " late-armed" : "")} onClick={() => setLateOpen((v) => !v)}>Running Late?</button>}
        </div>
      )}
      {lateOpen && onRunningLate && (
        <div className="late-chips">
          <div className="segmented">
            {LATE_CHOICES.map((m) => (
              <button className="seg" key={m} onClick={() => { setLateOpen(false); onRunningLate(m); }}>+{m === 60 ? "1h" : m + "m"}</button>
            ))}
          </div>
        </div>
      )}
    </>
  ) : null;

  const header = (
    <div className="sh2">
      <span className="t">{nowHead ? "Now" : title}</span>
      <span className="sec-left">
        {overflow && (
          <button
            className={"ticker-toggle" + (paused ? " paused" : "")}
            aria-label={paused ? "Resume auto-scroll" : "Pause auto-scroll"}
            onClick={() => setPausedSticky(!paused)}
          >
            <svg className="icon-pause" viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
            <svg className="icon-play" viewBox="0 0 24 24"><polygon points="7,5 19,12 7,19" /></svg>
          </button>
        )}
      <button className="see-all pill-action" onClick={onSeeAll}>Schedule</button>
      </span>
    </div>
  );

  // A day with five proposals and no meetings is not an empty day. The
  // emptiness test counts what is on screen, not just what is committed.
  const proposedCount = proposed?.blocks.length ?? 0;
  if (events.length === 0 && proposedCount === 0) {
    // Actionable empty state: an icon, one warm line, and the obvious next
    // tap, instead of a grey sentence (RDB, Dave 2026-07-29).
    return (
      <div>
        {header}
        <div className="pad-x"><div className="card">
          <div className="empty-state empty-compact">
            <div className="empty-icon"><CalIcon /></div>
            <div className="empty-title">{emptyText}</div>
            {/* The line that used to sit here, "Want me to build your day
                around what matters?", asked whether you wanted the thing the
                button below it does. Same helper-text pattern removed from the
                Tasks empty state and the First Step card. */}
            {onPlanDay && <button className="btn btn-primary" onClick={onPlanDay}><CalIcon />Plan My Day</button>}
            {/* An empty evening is the best moment to plan tomorrow, not a
                reason to hide the button (2026-08-09). */}
            {onPlanTomorrow && <button className="btn btn-secondary" onClick={onPlanTomorrow}><CalIcon />Plan Tomorrow</button>}
          </div>
        </div></div>
      </div>
    );
  }

  // YOU CANNOT EDIT A MOVING TARGET (blend, 2026-08-22). The ticker renders
  // the day TWICE inside a scrolling track, so an editable proposal would
  // exist in two copies, keyed the same, sliding past the thumb.
  //
  // The original answer was to hold the whole day still while any proposal
  // stood. Correct, and it cost Dave the feature outright (2026-08-25: "the
  // home page one is supposed to be one that rotates the display with a
  // pause button"). He plans most mornings, so proposals are the normal
  // state and the ticker was effectively never on.
  //
  // PAUSED IS THE EDITABLE VIEW. Moving and editing are now two modes rather
  // than a conflict: while it scrolls it is ambient and read-only, and the
  // moment it is paused it renders the real single list with every control
  // live. So a proposal is safe in the loop, because you cannot reach it
  // there, and reaching it is one tap away.
  //
  // That tap is anywhere on the ticker, not just the pause button: touching
  // something that is sliding under your thumb should stop it, and the tap
  // that stopped it must not also activate whatever it landed on.
  const nowMinutes = (() => { const p = now.split(":"); return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0); })();

  if (!overflow || paused) {
    return (
      <div>
        {header}
        {nowHead}
        {/* Quiet on purpose: the accent on the head above is what makes Now
            the one loud thing on this screen. */}
        {nowHead && <div className="day-band">The rest of today</div>}
        <div className="day-hold">
          {/* THE MEASUREMENT IS OF WHAT THE TICKER WOULD SHOW, not of what is
              on screen. This div renders the visible, COMPRESSED day, and
              compression is exactly what made Dave's day fit: two rows and a
              "5 tasks" line where there had been seven rows, so the overflow
              test said "it fits" and the ticker never started.
              The hidden twin below measures the day with every held task
              expanded, which is the ticker's own content. Deciding whether a
              thing should scroll by measuring something other than that thing
              is how the feature switched itself off. */}
          <div><DaySet events={events} locked={locked} now={now} nowLabel={nowLabel} onOpenEvent={onOpenEvent} onEditRoutine={onEditRoutine} blendMap={blendMap} proposed={proposed} fromMin={nowHead ? nowMinutes : undefined} /></div>
          {measuring && (
            <div ref={measureRef} className="day-measure" aria-hidden="true">
              <DaySet events={events} locked={locked} now={now} nowLabel={nowLabel} blendMap={blendMap} proposed={proposed} expandHeld />
            </div>
          )}
        </div>
        {/* NOW FLOWS INTO SCHEDULE (Dave 2026-08-26, three-way catalog,
            Option B: "actions trail the list"). Focus / Plan My Day used to
            sit between the Now card and the band, splitting Now from what's
            coming. Now nothing sits between them, and the whole-day actions
            trail everything already committed today -- a deliberate step
            once you've seen the day, not a wall you scroll past to reach
            it. */}
        {planButton}
        {footer}
      </div>
    );
  }

  // Overflowing: duplicate the day and let the CSS loop scroll it.
  //
  // The ticker deliberately shows the WHOLE day, past included, even when Now
  // is the head. It is a loop: it comes back around to the morning either way,
  // and a loop with a hole cut in it reads as a rendering fault rather than as
  // a decision. The head still owns Now; this is the ambient version below it.
  return (
    <div>
      {header}
      {nowHead}
      {nowHead && <div className="day-band">The whole day</div>}
      <div className="pad-x">
        <div
          className="card sched-ticker"
          // Capture, so the tap that stops the scroll is swallowed before it
          // reaches the row it happened to land on. Without this the first
          // touch opens whatever was passing, which is the worst possible
          // outcome of reaching for a moving list.
          onClickCapture={(e) => { e.stopPropagation(); setPausedSticky(true); }}
        >
          <div className="ticker-track">
            <DaySet events={events} locked={locked} now={now} nowLabel={nowLabel} blendMap={blendMap} proposed={proposed} expandHeld />
            <DaySet events={events} locked={locked} now={now} nowLabel={nowLabel} blendMap={blendMap} proposed={proposed} expandHeld />
          </div>
        </div>
        {/* Says what the tap does, because a list that stops when you touch
            it is only obvious after it has happened once. */}
        <div className="ticker-hint">Tap to hold it still</div>
      </div>
      {/* Same move as the paused view (Option B, 2026-08-26): actions trail
          the day instead of splitting Now from it. */}
      {planButton}
    </div>
  );
}
