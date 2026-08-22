import { useEffect, useRef, useState } from "react";
import type { EventItem } from "../schedule/types";
import { fmtTime, fmtDistance, minToHHMM } from "../schedule/calendar";
import { catColor, catName } from "../shared/categories";
import { isPast } from "./todayData";
import { EventWeatherLine } from "../weather/WeatherLine";
import ProposedRow from "../schedule/screens/ProposedRow";
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

// One confident blend offer per block, keyed by event id. Built by the flow;
// this screen only draws it.
export type BlendMap = Record<string, { text: string; why: string; onAdd: () => void }>;

const WINDOW = 252; // ticker viewport height (px), matches .sched-ticker
// Pausing the day ticker survives leaving Today and coming back.
const TICKER_KEY = "jarvis.today.ticker.v1";

export interface LockedRange { s: number; e: number; label: string }

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
function LockedRow({ l, past, onOpen }: { l: LockedRange; past: boolean; onOpen?: () => void }) {
  const t = fmtTime(minToHHMM(l.s));
  return (
    <div className={"sched-row sched-locked" + (past ? " past" : "")} role="button" tabIndex={0} onClick={onOpen}>
      <div className="sched-time">{t.time}<span className="ampm">{t.ap}</span></div>
      <div className="sched-body">
        <div className="sched-title sched-lock-title">
          <svg className="ic lock-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
          {l.label}
        </div>
        <div className="sched-cat">Protected</div>
      </div>
    </div>
  );
}

// One full pass of the day: events + protected blocks in time order, with the
// Now line inserted at the right spot and time-as-distance on the next event.
function DaySet({ events, locked = [], now, nowLabel, onOpenEvent, onEditRoutine, blendMap = {}, proposed }: { events: EventItem[]; locked?: LockedRange[]; now: string; nowLabel: string; onOpenEvent?: (id: string) => void; onEditRoutine?: () => void; blendMap?: BlendMap; proposed?: ProposedDay }) {
  const toMin = (hhmm: string) => { const p = hhmm.split(":"); return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0); };
  const nowMin = toMin(now);
  // The distance label ("in 40 minutes") counts down to a COMMITMENT. A
  // proposal is not one yet, so it never wears it.
  const nextId = events.filter((e) => toMin(e.data.start) >= nowMin).sort((a, b) => toMin(a.data.start) - toMin(b.data.start))[0]?.id;
  type Entry =
    | { kind: "event"; ev: EventItem; s: number }
    | { kind: "locked"; l: LockedRange; s: number }
    | { kind: "proposed"; b: PlanBlock; s: number };
  const entries: Entry[] = [
    ...events.map((ev): Entry => ({ kind: "event", ev, s: toMin(ev.data.start) })),
    ...locked.map((l): Entry => ({ kind: "locked", l, s: l.s })),
    // Proposals join the SAME sort, not a separate list below the day. That
    // is the whole point: one schedule, in time order.
    ...(proposed?.blocks ?? []).map((b): Entry => ({ kind: "proposed", b, s: toMin(b.start) })),
  ].sort((a, b) => a.s - b.s);
  // Insert the Now line by minutes, simple and correct with locked rows mixed in.
  const out: JSX.Element[] = [];
  let nowPlaced = false;
  entries.forEach((en, i) => {
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
      out.push(<LockedRow key={"lock-" + i} l={en.l} past={en.l.e <= nowMin} onOpen={onEditRoutine} />);
    }
  });
  if (!nowPlaced) out.push(<NowLine key="now" label={nowLabel} />);
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
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

const FocusIcon = () => (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" />
  </svg>
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
  onEditRoutine?: () => void;
  title?: string;
  emptyText?: string;
  blendMap?: BlendMap;
  // A standing proposal for this day, rendered inline among the real rows.
  proposed?: ProposedDay;
  // Accept / Not Today, owned by the flow and drawn under the day.
  footer?: React.ReactNode;
}) {
  const measureRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    const el = measureRef.current;
    if (el) setOverflow(el.scrollHeight > WINDOW);
  }, [events, now]);

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
        {onFocus && <button className="plan-cta plan-cta-block" onClick={onFocus}><FocusIcon />Focus</button>}
        {onPlanDay && <button className={"plan-cta plan-cta-block" + (onFocus ? " plan-cta-ghost" : "")} onClick={onPlanDay}><CalIcon />Plan My Day</button>}
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
            {[15, 30, 60].map((m) => (
              <button className="seg" key={m} onClick={() => { setLateOpen(false); onRunningLate(m); }}>+{m === 60 ? "1h" : m + "m"}</button>
            ))}
          </div>
        </div>
      )}
    </>
  ) : null;

  const header = (
    <div className="sh2">
      <span className="t">{title}</span>
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
      <button className="see-all" onClick={onSeeAll}>Schedule</button>
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
  // exist in two copies, keyed the same, sliding past the thumb. While a
  // proposal stands, the day holds still; it starts moving again once the
  // day is accepted and there is nothing left to decide.
  if (!overflow || proposedCount > 0) {
    return (
      <div>
        {header}
        {planButton}
        <div>
          <div ref={measureRef}><DaySet events={events} locked={locked} now={now} nowLabel={nowLabel} onOpenEvent={onOpenEvent} onEditRoutine={onEditRoutine} blendMap={blendMap} proposed={proposed} /></div>
        </div>
        {footer}
      </div>
    );
  }

  // Overflowing: duplicate the day and let the CSS loop scroll it.
  return (
    <div>
      {header}
      {planButton}
      <div className="pad-x">
        <div className={"card sched-ticker" + (paused ? " paused" : "")}>
          <div className="ticker-track">
            <DaySet events={events} locked={locked} now={now} nowLabel={nowLabel} onOpenEvent={onOpenEvent} onEditRoutine={onEditRoutine} blendMap={blendMap} />
            <DaySet events={events} locked={locked} now={now} nowLabel={nowLabel} onOpenEvent={onOpenEvent} onEditRoutine={onEditRoutine} blendMap={blendMap} />
          </div>
        </div>
      </div>
    </div>
  );
}
