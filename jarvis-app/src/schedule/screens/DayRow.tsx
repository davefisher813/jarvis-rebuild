import { useRef, useState } from "react";
import type { EventItem } from "../types";
import { fmtTime, fmtDistance } from "../calendar";
import { catColor, catName } from "../../shared/categories";

// One event row on the Schedule day list. Same anatomy as before, plus the
// roadmap-v2 basics: swipe left reveals Push 15 / Tomorrow (recurring events
// keep tap-to-edit only: shifting a whole series from a swipe is a footgun),
// the next upcoming event carries a time-as-distance label, and past events
// dim. Tap always opens the editor.

export default function DayRow({
  e,
  conflict,
  isNext,
  isPast,
  now,
  onOpen,
  onPush15,
  onPushTomorrow,
}: {
  e: EventItem;
  conflict: boolean;
  isNext: boolean;
  isPast: boolean;
  now: string | null; // "HH:MM" when viewing today, else null
  onOpen?: () => void;
  onPush15?: () => void;
  onPushTomorrow?: () => void;
}) {
  const t = fmtTime(e.data.start);
  const endT = e.data.end ? fmtTime(e.data.end) : null;
  const rep = e.data.recurrence && e.data.recurrence !== "none" ? e.data.recurrence : null;
  const dist = isNext && now ? fmtDistance(e.data.start, now) : null;

  // Swipe machinery, ported from the task rows so every list feels the same.
  const swipeable = !rep && !isPast && (onPush15 || onPushTomorrow);
  const REVEAL = 176;
  const [dx, setDx] = useState(0);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const horizontal = useRef(false);
  const decided = useRef(false);

  const onStart = (ev: React.TouchEvent) => {
    if (!swipeable) return;
    startX.current = ev.touches[0]!.clientX;
    startY.current = ev.touches[0]!.clientY;
    decided.current = false;
    horizontal.current = false;
    setDragging(true);
  };
  const onMove = (ev: React.TouchEvent) => {
    if (!swipeable) return;
    const mx = ev.touches[0]!.clientX - startX.current;
    const my = ev.touches[0]!.clientY - startY.current;
    if (!decided.current) {
      if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;
      horizontal.current = Math.abs(mx) > Math.abs(my);
      decided.current = true;
    }
    if (!horizontal.current) return;
    const base = open ? -REVEAL : 0;
    setDx(Math.min(0, Math.max(-REVEAL, base + mx)));
  };
  const onEnd = () => {
    if (!swipeable) return;
    setDragging(false);
    const shouldOpen = dx < -REVEAL / 2;
    setOpen(shouldOpen);
    setDx(shouldOpen ? -REVEAL : 0);
  };
  const closeThen = (fn?: () => void) => { setOpen(false); setDx(0); fn?.(); };

  return (
    <div className="sched-swipe-wrap">
      {swipeable && (
        <div className="sched-actions" aria-hidden={!open}>
          <button className="sched-act" onClick={() => closeThen(onPush15)}>+15 min</button>
          <button className="sched-act sched-act-quiet" onClick={() => closeThen(onPushTomorrow)}>Tomorrow</button>
        </div>
      )}
      <div
        className={"sched-row" + (conflict ? " sched-row-warn" : "") + (isPast ? " past" : "") + (dragging ? " swiping" : "")}
        style={swipeable ? { transform: `translateX(${dx}px)` } : undefined}
        role="button"
        tabIndex={0}
        onClick={() => (open ? closeThen() : onOpen?.())}
        onTouchStart={onStart}
        onTouchMove={onMove}
        onTouchEnd={onEnd}
      >
        <div className="sched-time">{t.time}<span className="ampm">{t.ap}</span></div>
        <div className="sched-body">
          <div className="sched-title">
            {e.data.title}
            {conflict && <span className="sched-badge">Overlaps</span>}
            {dist && <span className="sched-dist">{dist}</span>}
          </div>
          <div className="sched-cat">
            <span className={"cat-dot cat-bg-" + catColor(e.data.category)} />
            {catName(e.data.category)}
            {endT && <span className="sched-until">until {endT.time} {endT.ap}</span>}
            {rep && <span className="sched-rep">Repeats {rep}</span>}
          </div>
          {e.data.location && (
            <a className="sched-loc" href={"https://maps.apple.com/?q=" + encodeURIComponent(e.data.location)} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()}>
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z" /><circle cx="12" cy="10" r="3" /></svg>
              {e.data.location}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
