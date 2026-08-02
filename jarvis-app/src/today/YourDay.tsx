import { useEffect, useRef, useState } from "react";
import type { EventItem } from "../schedule/types";
import { fmtTime, fmtDistance, minToHHMM } from "../schedule/calendar";
import { catColor, catName } from "../shared/categories";
import { isPast } from "./todayData";

const WINDOW = 252; // ticker viewport height (px), matches .sched-ticker

export interface LockedRange { s: number; e: number; label: string }

function Row({ ev, past, dist, onOpen }: { ev: EventItem; past: boolean; dist: string | null; onOpen?: () => void }) {
  const t = fmtTime(ev.data.start);
  return (
    <div className={"sched-row" + (past ? " past" : "")} role="button" tabIndex={0} onClick={onOpen}>
      <div className="sched-time">{t.time}<span className="ampm">{t.ap}</span></div>
      <div className="sched-body">
        <div className="sched-title">{ev.data.title}{dist && <span className="sched-dist">{dist}</span>}</div>
        <div className="sched-cat">
          <span className={"cat-dot cat-bg-" + catColor(ev.data.category)} />
          {catName(ev.data.category)}
        </div>
      </div>
    </div>
  );
}

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
function DaySet({ events, locked = [], now, nowLabel, onOpenEvent, onEditRoutine }: { events: EventItem[]; locked?: LockedRange[]; now: string; nowLabel: string; onOpenEvent?: (id: string) => void; onEditRoutine?: () => void }) {
  const toMin = (hhmm: string) => { const p = hhmm.split(":"); return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0); };
  const nowMin = toMin(now);
  const nextId = events.filter((e) => toMin(e.data.start) >= nowMin).sort((a, b) => toMin(a.data.start) - toMin(b.data.start))[0]?.id;
  type Entry = { kind: "event"; ev: EventItem; s: number } | { kind: "locked"; l: LockedRange; s: number };
  const entries: Entry[] = [
    ...events.map((ev): Entry => ({ kind: "event", ev, s: toMin(ev.data.start) })),
    ...locked.map((l): Entry => ({ kind: "locked", l, s: l.s })),
  ].sort((a, b) => a.s - b.s);
  // Insert the Now line by minutes, simple and correct with locked rows mixed in.
  const out: JSX.Element[] = [];
  let nowPlaced = false;
  entries.forEach((en, i) => {
    if (!nowPlaced && en.s >= nowMin) { out.push(<NowLine key="now" label={nowLabel} />); nowPlaced = true; }
    if (en.kind === "event") {
      out.push(<Row key={en.ev.id} ev={en.ev} past={isPast(en.ev, now)} dist={en.ev.id === nextId ? fmtDistance(en.ev.data.start, now) : null} onOpen={onOpenEvent ? () => onOpenEvent(en.ev.id) : undefined} />);
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
  onFocus,
  onOpenEvent,
  onEditRoutine,
  title = "Your Day",
  emptyText = "Nothing scheduled today",
}: {
  events: EventItem[];
  locked?: LockedRange[];
  now: string;
  nowLabel: string;
  onSeeAll: () => void;
  onPlanDay?: () => void;
  onFocus?: () => void;
  onOpenEvent?: (id: string) => void;
  onEditRoutine?: () => void;
  title?: string;
  emptyText?: string;
}) {
  const measureRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const el = measureRef.current;
    if (el) setOverflow(el.scrollHeight > WINDOW);
  }, [events, now]);

  // Focus (the one-card mode) pairs with Plan My Day when available: Focus is
  // the one red action on the page, Plan My Day drops to the quiet style.
  const planButton = onPlanDay || onFocus ? (
    <div className={"plan-cta-row" + (onPlanDay && onFocus ? " plan-cta-pair" : "")}>
      {onFocus && <button className="plan-cta plan-cta-block" onClick={onFocus}><FocusIcon />Focus</button>}
      {onPlanDay && <button className={"plan-cta plan-cta-block" + (onFocus ? " plan-cta-ghost" : "")} onClick={onPlanDay}><CalIcon />Plan My Day</button>}
    </div>
  ) : null;

  const header = (
    <div className="sec-head">
      <div className="sec-left">
        <div className="sec-ico ico-blue"><CalIcon /></div>
        <div className="sec-title">{title}</div>
        {overflow && (
          <button
            className={"ticker-toggle" + (paused ? " paused" : "")}
            aria-label={paused ? "Resume auto-scroll" : "Pause auto-scroll"}
            onClick={() => setPaused((p) => !p)}
          >
            <svg className="icon-pause" viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
            <svg className="icon-play" viewBox="0 0 24 24"><polygon points="7,5 19,12 7,19" /></svg>
          </button>
        )}
      </div>
      <button className="see-all" onClick={onSeeAll}>Schedule</button>
    </div>
  );

  if (events.length === 0) {
    // Actionable empty state: an icon, one warm line, and the obvious next
    // tap, instead of a grey sentence (RDB, Dave 2026-07-29).
    return (
      <div className="yourday">
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
          </div>
        </div></div>
      </div>
    );
  }

  // Not overflowing: a plain static card (no animation, no toggle).
  if (!overflow) {
    return (
      <div className="yourday">
        {header}
        {planButton}
        <div className="pad-x">
          <div className="card">
            <div ref={measureRef}><DaySet events={events} locked={locked} now={now} nowLabel={nowLabel} onOpenEvent={onOpenEvent} onEditRoutine={onEditRoutine} /></div>
          </div>
        </div>
      </div>
    );
  }

  // Overflowing: duplicate the day and let the CSS loop scroll it.
  return (
    <div className="yourday">
      {header}
      {planButton}
      <div className="pad-x">
        <div className={"card sched-ticker" + (paused ? " paused" : "")}>
          <div className="ticker-track">
            <DaySet events={events} locked={locked} now={now} nowLabel={nowLabel} onOpenEvent={onOpenEvent} onEditRoutine={onEditRoutine} />
            <DaySet events={events} locked={locked} now={now} nowLabel={nowLabel} onOpenEvent={onOpenEvent} onEditRoutine={onEditRoutine} />
          </div>
        </div>
      </div>
    </div>
  );
}
