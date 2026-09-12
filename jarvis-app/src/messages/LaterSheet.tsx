import { createPortal } from "react-dom";
import { useState } from "react";
import { addDays } from "../schedule/calendar";

// LATER, TO A DAY (E-28, Email Build Master 2026-09-12, Push H).
//
// A Needs You row's Later used to be the Sweep's only: a task due today,
// mail untouched. From the list it asks WHEN, in the three answers a person
// actually gives: tonight, tomorrow, or a day he picks (the same date input
// the task sheet uses). The task is made exactly as the Sweep's Later makes
// it (no archive), and Tonight also snoozes the thread's Today notice until
// the evening so it visibly comes back. At a Desk is untouched and sits
// beside this on the waiting rows.

export const TONIGHT_HHMM = "18:00";

export interface LaterPick { due: string; when: "tonight" | "tomorrow" | "day" }

export default function LaterSheet({ who, today, onPick, onClose }: {
  who: string;
  today: string;
  onPick: (p: LaterPick) => void;
  onClose: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [day, setDay] = useState(addDays(today, 2));
  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Later</div></div>
        <div className="pad-x sheet-form">
          <div className="p3-q">{"Come back to " + who}</div>
          <div className="plan-sub">A task, on the day you pick. The mail stays where it is.</div>
          <div className="list-flat">
            <div className="row" role="button" tabIndex={0} onClick={() => onPick({ due: today, when: "tonight" })}>
              <div className="row-grow"><div className="conn-name">Tonight</div><div className="conn-meta">Back on Today at 6 PM</div></div>
              <div className="chev" />
            </div>
            <div className="row" role="button" tabIndex={0} onClick={() => onPick({ due: addDays(today, 1), when: "tomorrow" })}>
              <div className="row-grow"><div className="conn-name">Tomorrow</div></div>
              <div className="chev" />
            </div>
            {picking ? (
              <div className="row later-day">
                <div className="row-grow"><div className="conn-name">Pick a Day</div></div>
                <input type="date" className="xs-input" aria-label="Day" min={today} value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
                <button type="button" className="pill-act" onClick={() => onPick({ due: day, when: "day" })}>Save</button>
              </div>
            ) : (
              <div className="row" role="button" tabIndex={0} onClick={() => setPicking(true)}>
                <div className="row-grow"><div className="conn-name">Pick a Day</div></div>
                <div className="chev" />
              </div>
            )}
          </div>
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-tertiary btn-block" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
