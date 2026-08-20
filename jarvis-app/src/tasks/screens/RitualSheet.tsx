import { createPortal } from "react-dom";
import { useState } from "react";
import { LENGTHS, endsAt, ritualIsReady, whyNotReady, type Ritual } from "../startRitual";

// THE START RITUAL SHEET (C1). Three decisions, all pre-answered: when it
// starts, how long it runs, and what the first move is. He can change any of
// them, but the sheet opens with a complete plan already in it, because
// arriving at an empty form is the same wall the feature exists to remove.
export default function RitualSheet({
  initial,
  onSet,
  onCancel,
}: {
  initial: Ritual;
  onSet: (r: Ritual) => void;
  onCancel: () => void;
}) {
  const [start, setStart] = useState(initial.startHHMM);
  const [minutes, setMinutes] = useState(initial.minutes);
  const [firstMove, setFirstMove] = useState(initial.firstMove);

  const draft: Ritual = { ...initial, startHHMM: start, minutes, firstMove };
  const why = whyNotReady(draft);

  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Set a Start</div></div>
        <div className="pad-x sheet-form">
          <div className="field">
            <div className="input-label">{initial.text}</div>
          </div>

          <div className="field">
            <div className="input-label">Starts</div>
            <input type="time" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>

          <div className="field">
            <div className="input-label">For</div>
            <div className="segmented">
              {LENGTHS.map((m) => (
                <div
                  key={m}
                  className={"seg" + (minutes === m ? " active" : "")}
                  role="button" tabIndex={0}
                  onClick={() => setMinutes(m)}
                >{m}m</div>
              ))}
            </div>
            {ritualIsReady(draft) && (
              <div className="input-hint">Ends {endsAt(draft)}. Finishing is not the point.</div>
            )}
          </div>

          <div className="field">
            <div className="input-label">First Move</div>
            <input
              className="input"
              placeholder="e.g. open the template"
              value={firstMove}
              onChange={(e) => setFirstMove(e.target.value)}
            />
            {why ? <div className="input-error">{why}</div> : null}
          </div>
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-block" disabled={!ritualIsReady(draft)} onClick={() => onSet(draft)}>
            Set It
          </button>
          <button className="btn btn-block" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
