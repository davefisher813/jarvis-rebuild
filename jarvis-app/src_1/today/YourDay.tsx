import { useEffect, useRef, useState } from "react";
import type { EventItem } from "../schedule/types";
import { fmtTime } from "../schedule/calendar";
import { catColor, catName } from "../shared/categories";
import { nowIndex, isPast } from "./todayData";

const WINDOW = 252; // ticker viewport height (px), matches .sched-ticker

function Row({ ev, past }: { ev: EventItem; past: boolean }) {
  const t = fmtTime(ev.data.start);
  return (
    <div className={"sched-row" + (past ? " past" : "")}>
      <div className="sched-time">{t.time}<span className="ampm">{t.ap}</span></div>
      <div className="sched-body">
        <div className="sched-title">{ev.data.title}</div>
        <div className="sched-cat">
          <span className={"cat-dot cat-bg-" + catColor(ev.data.category)} />
          {catName(ev.data.category)}
        </div>
      </div>
    </div>
  );
}

// One full pass of the day, with the Now line inserted at the right spot.
function DaySet({ events, now, nowLabel }: { events: EventItem[]; now: string; nowLabel: string }) {
  const ni = nowIndex(events, now);
  const out: JSX.Element[] = [];
  events.forEach((ev, i) => {
    if (i === ni) out.push(<NowLine key="now" label={nowLabel} />);
    out.push(<Row key={ev.id} ev={ev} past={isPast(ev, now)} />);
  });
  if (ni === events.length) out.push(<NowLine key="now" label={nowLabel} />);
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

export default function YourDay({
  events,
  now,
  nowLabel,
  onSeeAll,
}: {
  events: EventItem[];
  now: string;
  nowLabel: string;
  onSeeAll: () => void;
}) {
  const measureRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const el = measureRef.current;
    if (el) setOverflow(el.scrollHeight > WINDOW);
  }, [events, now]);

  const header = (
    <div className="sec-head">
      <div className="sec-left">
        <div className="sec-ico ico-blue"><CalIcon /></div>
        <div className="sec-title">Your Day</div>
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
    return (
      <div className="yourday">
        {header}
        <div className="pad-x"><div className="card"><div className="empty-state">Nothing scheduled today</div></div></div>
      </div>
    );
  }

  // Not overflowing: a plain static card (no animation, no toggle).
  if (!overflow) {
    return (
      <div className="yourday">
        {header}
        <div className="pad-x">
          <div className="card">
            <div ref={measureRef}><DaySet events={events} now={now} nowLabel={nowLabel} /></div>
          </div>
        </div>
      </div>
    );
  }

  // Overflowing: duplicate the day and let the CSS loop scroll it.
  return (
    <div className="yourday">
      {header}
      <div className="pad-x">
        <div className={"card sched-ticker" + (paused ? " paused" : "")}>
          <div className="ticker-track">
            <DaySet events={events} now={now} nowLabel={nowLabel} />
            <DaySet events={events} now={now} nowLabel={nowLabel} />
          </div>
        </div>
      </div>
    </div>
  );
}
