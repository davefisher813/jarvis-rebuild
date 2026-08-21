import { createPortal } from "react-dom";
import type { Overlap } from "../dayEdit";
import { fmtRange } from "../calendar";

// THE BADGE THAT DOES SOMETHING (N5 completion, hotfix 2026-08-21, from the
// "adhd nightmare" screenshots: nine red badges, zero affordances). Tap an
// Overlaps badge and this sheet offers the ways out, one tap each: nudge the
// later event, push it to tomorrow, move it to the day's next free slot
// (named, so the button is a promise about a real time), or Keep Both, which
// quiets THIS pair until either event moves again. The later event is the
// one that moves, same principle as the collide card's fix: the earlier
// commitment is already underway.

export default function OverlapSheet({
  overlap,
  nextFree,
  onNudge,
  onTomorrow,
  onMoveToFree,
  onKeepBoth,
  onClose,
}: {
  overlap: Overlap;
  // The derived landing slot for Move to Next Free, or null when the day has
  // no honest slot to promise (the button renders only with real data).
  nextFree: string | null;
  onNudge: (mins: number) => void;
  onTomorrow: () => void;
  onMoveToFree: () => void;
  onKeepBoth: () => void;
  onClose: () => void;
}) {
  const { a, b } = overlap;
  const fmt = (hhmm: string) => {
    const [h, m] = hhmm.split(":");
    let hr = Number(h);
    const ap = hr < 12 ? "AM" : "PM";
    hr = hr % 12 || 12;
    return `${hr}:${m} ${ap}`;
  };
  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Fix Overlap</div></div>
        <div className="pad-x sheet-form">
          <div className="p3-q">{b.data.title} overlaps {a.data.title}</div>
          <div className="plan-sub">
            {fmtRange(b.data.start, b.data.end)} against {fmtRange(a.data.start, a.data.end)}
          </div>
          <div className="chip-row">
            <button type="button" className="chip" onClick={() => onNudge(15)}>+15m</button>
            <button type="button" className="chip" onClick={() => onNudge(30)}>+30m</button>
            <button type="button" className="chip" onClick={() => onNudge(60)}>+1h</button>
            <button type="button" className="chip" onClick={onTomorrow}>Tomorrow</button>
          </div>
        </div>
        <div className="pad-x sheet-actions">
          {nextFree && (
            <button className="btn btn-primary btn-block" onClick={onMoveToFree}>
              Move to Next Free &middot; {fmt(nextFree)}
            </button>
          )}
          <button className="btn btn-tertiary btn-block" onClick={onKeepBoth}>Keep Both</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
