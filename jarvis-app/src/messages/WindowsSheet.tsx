import { createPortal } from "react-dom";
import { useState } from "react";
import {
  addWindow, removeWindow, setWindowStart, setWindowLen, toggleDay,
  WINDOW_LENGTHS, MAX_WINDOWS, DAY_LETTER,
  type WindowSettings,
} from "./batching";

// THE WINDOWS EDITOR (2026-08-22). Turning the curtain on is a decision made
// here, with every window visible and editable, never a stray tap on a row.
// Everything is his: each window's start and length, which days it runs, and
// the off switch, which lives here so one impatient moment at the curtain
// does not kill a habit (Open Anyway is the impatient path, and it costs
// nothing).
const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const toMin = (v: string) => {
  const p = v.split(":");
  return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0);
};
const lenLabel = (m: number) => (m < 60 ? `${m}m` : m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h ${m % 60}m`);

export default function WindowsSheet({
  initial,
  onSave,
  onTurnOff,
  onClose,
}: {
  initial: WindowSettings;
  onSave: (w: WindowSettings) => void;
  onTurnOff?: () => void; // present only when the curtain is currently on
  onClose: () => void;
}) {
  // Drafted locally; nothing is live until Start/Save. A half-edited window
  // must never close his email out from under him.
  const [draft, setDraft] = useState<WindowSettings>({ ...initial, windows: [...initial.windows], days: [...initial.days] });

  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Email Windows</div></div>
        <div className="pad-x sheet-form">
          <div className="p3-q">Email opens only in these windows</div>
          <div className="plan-sub">Outside them the tab rests. Open Anyway always works, and VIPs always show.</div>

          <div className="row win-days">
            <div className="row-grow"><div className="conn-name">Days</div></div>
            {DAY_LETTER.map((l, d) => (
              <button
                key={d}
                type="button"
                className={"chip win-day" + (draft.days.includes(d) ? " chip-on" : "")}
                aria-label={"Runs on day " + d}
                aria-pressed={draft.days.includes(d)}
                onClick={() => setDraft(toggleDay(draft, d))}
              >
                {l}
              </button>
            ))}
          </div>

          <div className="list-flat">
            {draft.windows.map((w, i) => (
              <div className="row win-row" key={i}>
                <input
                  type="time"
                  className="input input-compact"
                  aria-label={"Window " + (i + 1) + " start"}
                  value={hhmm(w.startMin)}
                  onChange={(e) => e.target.value && setDraft(setWindowStart(draft, i, toMin(e.target.value)))}
                />
                <div className="chip-row win-lens">
                  {WINDOW_LENGTHS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={"chip" + (w.minutes === m ? " chip-on" : "")}
                      aria-label={"Window " + (i + 1) + ": " + m + " minutes"}
                      onClick={() => setDraft(setWindowLen(draft, i, m))}
                    >
                      {lenLabel(m)}
                    </button>
                  ))}
                </div>
                {draft.windows.length > 1 && (
                  <button type="button" className="quiet-action win-x" aria-label={"Remove window " + (i + 1)} onClick={() => setDraft(removeWindow(draft, i))}>
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
          {draft.windows.length < MAX_WINDOWS && (
            <button type="button" className="row-act" onClick={() => setDraft(addWindow(draft))}>Add a Window</button>
          )}
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-block" onClick={() => onSave({ ...draft, on: true })}>
            {initial.on ? "Save" : "Start Windows"}
          </button>
          {onTurnOff && (
            <button className="btn btn-tertiary btn-block" onClick={onTurnOff}>Turn Off</button>
          )}
          <button className="btn btn-tertiary btn-block" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
