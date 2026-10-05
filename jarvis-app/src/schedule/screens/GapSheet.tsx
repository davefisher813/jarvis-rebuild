import { createPortal } from "react-dom";
import { fmtTime } from "../calendar";
import { catColor, catName } from "../../shared/categories";
import { spanLabel } from "../../shared/duration";
import { durLabel } from "../durations";
import { rowDoor, own } from "../../shared/rowDoor";
import type { GapOption } from "../gapOffer";

// SCHEDULE SOMETHING HERE (schedule audit 2026-10-01, item 7). The sheet a
// "30 Min Open" row opens. The row is an invitation to use the time, so the
// answer to a tap is what could go in it: the tasks that fit, one tap each to
// book into the gap, then the two doors the row used to lead to alone. New
// Event is the blank form the Schedule tab's gap opened; Focus is the panel
// Today's Now card opened. Neither is gone, they are just no longer the only
// answer.
//
// A sheet with no Save: every tap is the whole decision, like OverlapSheet.

export default function GapSheet({
  start,
  end,
  minutes,
  options,
  onBook,
  onNewEvent,
  onFocus,
  onClose,
}: {
  /** The gap, as "HH:MM". */
  start: string;
  end: string;
  minutes: number;
  options: GapOption[];
  onBook: (o: GapOption) => void;
  onNewEvent?: () => void;
  onFocus?: () => void;
  onClose: () => void;
}) {
  const s = fmtTime(start);
  const e = fmtTime(end);
  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" role="dialog" aria-label="Schedule something here" onClick={(ev) => ev.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Schedule Something Here</div></div>
        <div className="pad-x sheet-form">
          {/* 2026-10-05 (the catalog gate): the gap is two facts and the stylesheet
              draws the dot. It was one sub line with the dot typed into it
              (R6), the length and the clock in the same grey (R1). The length
              is white ink, the clock a neutral time in small caps (R8). */}
          <div className="facts">
            <span className="fact"><b>{spanLabel(minutes)}</b> Open</span>
            <span className="fact date">{s.time} {s.ap} to {e.time} {e.ap}</span>
          </div>
          {options.length > 0 ? (
            <div className="card gap-offer">
              {options.map((o) => (
                <div className="row gap-offer-row" key={o.id} {...rowDoor(() => onBook(o))}>
                  <span className={"cat-dot cat-bg-" + catColor(o.category)} />
                  <div className="row-grow">
                    <div className="conn-name truncate">{o.text}</div>
                    <div className="conn-meta facts">
                      {catName(o.category) && <span className="fact">{catName(o.category)}</span>}
                      <span className="fact"><b>{durLabel(o.minutes)}</b></span>
                    </div>
                  </div>
                  <button type="button" className="pill-act" aria-label={`Book ${o.text} at ${s.time} ${s.ap}`} onClick={own(() => onBook(o))}>Book</button>
                </div>
              ))}
            </div>
          ) : (
            <div className="plan-sub">Nothing on your list fits this gap.</div>
          )}
        </div>
        <div className="pad-x sheet-actions">
          {onNewEvent && <button type="button" className="btn btn-secondary btn-block" onClick={onNewEvent}>New Event</button>}
          {onFocus && <button type="button" className="btn btn-tertiary btn-block" onClick={onFocus}>Focus</button>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
