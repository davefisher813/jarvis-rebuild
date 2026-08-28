import { createPortal } from "react-dom";
import { useState } from "react";
import { minToHHMM } from "../calendar";
import { DUR_CHOICES, durLabel } from "../durations";

// THE SAME TAP AS A REAL EVENT (2026-08-28). Dave, all caps: "when I click on
// something in the schedule it should allow me to edit it like a normal
// scheduled event" - not the full Your Routine screen (Quick Add presets,
// nine kinds, What Happens in This Block, Where), which is a settings page,
// not a quick edit. This is EventSheet's shape - name, time, Move, Length,
// Save, Delete, Cancel - carrying only what a tap from the schedule should
// ever need to touch. Kind, mode, Flexible and location are untouched by it;
// "Edit Full Details" below is the one link out to the page that owns those.

const DOW_LETTER = ["S", "M", "T", "W", "T", "F", "S"];
const DOW_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const toMin = (hhmm: string): number => {
  const p = hhmm.split(":");
  return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0);
};

// Same shift amounts as EventSheet's Move row. No "Tomorrow": a block is a
// weekly rule, not a single date, so there is no single day to bump.
const NUDGES: [number, string][] = [[-30, "-30m"], [-15, "-15m"], [15, "+15m"], [30, "+30m"]];

export interface BlockDraft {
  label: string;
  startMin: number;
  endMin: number;
  days: number[];
}

export default function BlockSheet({
  initial,
  onSave,
  onDelete,
  onEditFull,
  onCancel,
}: {
  initial: BlockDraft;
  onSave: (draft: BlockDraft) => void;
  onDelete?: () => void;
  // The escape hatch to the full Your Routine editor, for kind, mode,
  // Flexible and location - everything this quick sheet deliberately leaves
  // alone.
  onEditFull?: () => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initial.label);
  const [start, setStart] = useState(minToHHMM(initial.startMin));
  const [end, setEnd] = useState(minToHHMM(initial.endMin));
  const [days, setDays] = useState<number[]>([...initial.days]);
  const [err, setErr] = useState(false);

  // Keep end sensible, same rule as EventSheet: when start moves past end,
  // push end to start + 1h rather than asking for it. End genuinely has a
  // good default; only a name, a start and at least one day cannot be
  // invented for a block.
  const onStartChange = (v: string) => {
    setStart(v);
    if (!end || toMin(end) <= toMin(v)) setEnd(minToHHMM(Math.min(24 * 60 - 1, toMin(v) + 60)));
    if (err) setErr(false);
  };
  const endInvalid = !!end && toMin(end) <= toMin(start);
  const toggleDay = (d: number) => setDays((ds) => (ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d].sort((a, b) => a - b)));

  const save = () => {
    if (!label.trim() || !start || !end || endInvalid || days.length === 0) {
      setErr(true);
      return;
    }
    onSave({ label: label.trim(), startMin: toMin(start), endMin: toMin(end), days: [...days].sort((a, b) => a - b) });
  };

  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Edit Protected Time</div></div>
        <div className="pad-x sheet-form">
          <div className="field">
            <label className="input-label">Name <span className="input-req">*</span></label>
            <input
              className="input"
              placeholder="Gym · Lunch · Deep Work"
              value={label}
              onChange={(e) => { setLabel(e.target.value); if (err) setErr(false); }}
            />
          </div>

          <div className="field-row">
            <div className="field">
              <label className="input-label">Start <span className="input-req">*</span></label>
              <input type="time" className="input" value={start} onChange={(e) => onStartChange(e.target.value)} />
            </div>
            <div className="field">
              <label className="input-label">End</label>
              <input type="time" className="input" value={end} onChange={(e) => { setEnd(e.target.value); if (err) setErr(false); }} />
            </div>
          </div>

          <div className="field">
            <div className="input-label">Move</div>
            <div className="chip-row">
              {NUDGES.map(([mins, nudgeLabel]) => {
                const dur = end && toMin(end) > toMin(start) ? toMin(end) - toMin(start) : 0;
                const nextStart = toMin(start) + mins;
                const blocked = nextStart < 0 || nextStart + dur > 24 * 60 - 1;
                return (
                  <div
                    key={mins}
                    className={"chip" + (blocked ? " chip-off" : "")}
                    role="button"
                    tabIndex={blocked ? -1 : 0}
                    aria-disabled={blocked}
                    onClick={() => {
                      if (blocked) return;
                      setStart(minToHHMM(nextStart));
                      setEnd(minToHHMM(nextStart + dur));
                      if (err) setErr(false);
                    }}
                  >
                    {nudgeLabel}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="field">
            <div className="input-label">Length</div>
            <div className="chip-row">
              {DUR_CHOICES.map((mins) => {
                const activeDur = !!end && toMin(end) - toMin(start) === mins;
                return (
                  <div
                    key={mins}
                    className={"chip" + (activeDur ? " active" : "")}
                    role="button"
                    tabIndex={0}
                    onClick={() => { setEnd(minToHHMM(toMin(start) + mins)); if (err) setErr(false); }}
                  >{durLabel(mins)}</div>
                );
              })}
            </div>
          </div>

          <div className="field">
            <div className="input-label">Days <span className="input-req">*</span></div>
            <div className="chip-row">
              {DOW_LETTER.map((ltr, d) => (
                <div
                  key={d}
                  className={"chip" + (days.includes(d) ? " active" : "")}
                  role="button"
                  tabIndex={0}
                  aria-pressed={days.includes(d)}
                  aria-label={DOW_ABBR[d]}
                  onClick={() => { toggleDay(d); if (err) setErr(false); }}
                >{ltr}</div>
              ))}
            </div>
          </div>

          {endInvalid && <div className="input-error">End must be after start</div>}
          {err && !endInvalid && <div className="input-error">Needs a name · At least one day</div>}
        </div>

        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-block" onClick={save}>Save</button>
          {onEditFull && (
            <button className="btn btn-secondary btn-block" onClick={onEditFull}>Edit Full Details</button>
          )}
          {onDelete && (
            <button className="btn btn-secondary btn-block btn-danger-text" onClick={onDelete}>Delete Block</button>
          )}
          <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
