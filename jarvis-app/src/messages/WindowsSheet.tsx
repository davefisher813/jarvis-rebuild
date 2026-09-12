import { createPortal } from "react-dom";
import { useState } from "react";
import {
  addWindow, removeWindow, setWindowStart, setWindowLen, toggleDay, crossesMidnight, minLabel,
  WINDOW_LENGTHS, MAX_WINDOWS, DAY_SHORT,
  type WindowSettings,
} from "./batching";

// THE WINDOWS EDITOR (2026-08-22). Turning the curtain on is a decision made
// here, with every window visible and editable, never a stray tap on a row.
// Everything is his: each window's start and length, which days it runs, and
// the off switch, which lives here so one impatient moment at the curtain
// does not kill a habit (Open Anyway is the impatient path, and it costs
// nothing).
//
// E-12 (Push G, Email Build Master 2026-09-12): the sheet is a list. Each
// window is one row, "9 AM · 45m", and a chevron opens a single-window
// editor for that one, so four length chips and a time input never fight a
// row for 390px. Days are Su..Sa, inverted when on. E-14: the editor refuses
// a window that would cross midnight with a line, rather than saving one
// the curtain would silently cut at 23:59; the sheet says times are device
// local; and "Same on Every Device" is the opt-in that lets the windows
// ride the mail mirror.
const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const toMin = (v: string) => {
  const p = v.split(":");
  return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0);
};
export const lenLabel = (m: number) => (m < 60 ? `${m}m` : m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h ${m % 60}m`);
export const MIDNIGHT_LINE = "That runs past midnight · Pick an earlier start or a shorter length";

export default function WindowsSheet({
  initial,
  mirror = false,
  onSave,
  onTurnOff,
  onClose,
}: {
  initial: WindowSettings;
  // E-14: whether this device mirrors its windows to the profile.
  mirror?: boolean;
  onSave: (w: WindowSettings, mirror: boolean) => void;
  onTurnOff?: () => void; // present only when the curtain is currently on
  onClose: () => void;
}) {
  // Drafted locally; nothing is live until Start/Save. A half-edited window
  // must never close his email out from under him.
  const [draft, setDraft] = useState<WindowSettings>({ ...initial, windows: [...initial.windows], days: [...initial.days] });
  const [mirrorDraft, setMirrorDraft] = useState(mirror);
  // The single-window editor: which row is open, and its own uncommitted
  // start and length, so a refused combination never reaches the draft.
  const [editing, setEditing] = useState<number | null>(null);
  const [edStart, setEdStart] = useState(0);
  const [edLen, setEdLen] = useState(45);
  const open = (i: number) => {
    const w = draft.windows[i]!;
    setEdStart(w.startMin); setEdLen(w.minutes); setEditing(i);
  };
  const refused = crossesMidnight(edStart, edLen);
  const done = () => {
    if (editing === null || refused) return;
    // Both through the pure operations, so the sort and the clamps that
    // batching.ts already promises still hold. Length first: it keeps the
    // index; the start is what re-sorts.
    setDraft(setWindowStart(setWindowLen(draft, editing, edLen), editing, edStart));
    setEditing(null);
  };

  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Email Windows</div></div>
        <div className="pad-x sheet-form">
          <div className="p3-q">Email opens only in these windows</div>
          <div className="plan-sub">Outside them the tab rests. Open Anyway always works, and VIPs always show.</div>

          <div className="row win-days" role="group" aria-label="Days">
            {DAY_SHORT.map((l, d) => (
              <button
                key={d}
                type="button"
                className={"chip win-day" + (draft.days.includes(d) ? " on" : "")}
                aria-label={"Runs on day " + d}
                aria-pressed={draft.days.includes(d)}
                onClick={() => setDraft(toggleDay(draft, d))}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="win-note">Times are device local</div>

          <div className="list-flat">
            {draft.windows.map((w, i) => (
              editing === i ? (
                <div className="win-editor" key={"ed" + i}>
                  <div className="win-editor-head">
                    <div className="conn-name">{"Window " + (i + 1)}</div>
                    <input
                      type="time"
                      className="input input-compact"
                      aria-label={"Window " + (i + 1) + " start"}
                      value={hhmm(edStart)}
                      onChange={(e) => e.target.value && setEdStart(toMin(e.target.value))}
                    />
                  </div>
                  <div className="chip-row win-lens">
                    {WINDOW_LENGTHS.map((m) => (
                      <button
                        key={m}
                        type="button"
                        className={"chip" + (edLen === m ? " on" : "")}
                        aria-label={"Window " + (i + 1) + ": " + m + " minutes"}
                        onClick={() => setEdLen(m)}
                      >
                        {lenLabel(m)}
                      </button>
                    ))}
                  </div>
                  {refused && <div className="win-error" role="alert">{MIDNIGHT_LINE}</div>}
                  <div className="win-editor-acts">
                    {draft.windows.length > 1 && (
                      <button type="button" className="quiet-action win-x" aria-label={"Remove window " + (i + 1)} onClick={() => { setDraft(removeWindow(draft, i)); setEditing(null); }}>
                        Remove
                      </button>
                    )}
                    <button type="button" className="quiet-action" onClick={() => setEditing(null)}>Cancel</button>
                    <button type="button" className="pill-act" disabled={refused} onClick={done}>Done</button>
                  </div>
                </div>
              ) : (
                <div className="row win-row" role="button" tabIndex={0} key={i}
                  aria-label={"Edit window " + (i + 1)}
                  onClick={() => open(i)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(i); } }}>
                  <div className="row-grow">
                    <div className="conn-name">{minLabel(w.startMin) + " · " + lenLabel(w.minutes)}</div>
                  </div>
                  <div className="chev" />
                </div>
              )
            ))}
          </div>
          {draft.windows.length < MAX_WINDOWS && editing === null && (
            <button type="button" className="row-act" onClick={() => setDraft(addWindow(draft))}>Add a Window</button>
          )}

          {/* E-14: the mirror is a choice, made here, off by default. */}
          <div className="row">
            <div className="row-grow">
              <div className="conn-name">Same on Every Device</div>
              <div className="conn-meta">{mirrorDraft ? "On · Rides the mail mirror" : "Off · These windows stay on this device"}</div>
            </div>
            <button type="button" className="pill-act" aria-pressed={mirrorDraft} onClick={() => setMirrorDraft((v) => !v)}>
              {mirrorDraft ? "Turn Off" : "Turn On"}
            </button>
          </div>
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-block" disabled={editing !== null} onClick={() => onSave({ ...draft, on: true }, mirrorDraft)}>
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
