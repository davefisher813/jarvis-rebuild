import { useState } from "react";
import { createPortal } from "react-dom";
import { plateFacts, type RackConfig } from "./ramp";
import Stepper from "../shared/Stepper";

// THE PLATE CALCULATOR (2026-09-14, the reference's "Load the bar"). The
// total and the bar in the rack's own unit, the plates per side as chips,
// and the nearest buildable number when the rack cannot make this one. The
// same arithmetic the open set chip already uses (ramp.plateFacts), on a
// sheet the session can open before the bar is loaded.
export default function PlateSheet({ total, unit, rack, onClose }: {
  /** The weight to load, in the exercise's own unit. */
  total: number;
  unit?: string;
  rack: RackConfig;
  onClose: () => void;
}) {
  const step = Math.min(...rack.plates) * 2 || 5;
  const [t, setT] = useState(total > 0 ? total : rack.bar);
  const facts = plateFacts(t, rack, unit);
  const u = unit ?? rack.unit;
  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Load the Bar</div></div>
        <div className="pad-x sheet-form">
          <div className="row">
            <div className="row-grow"><div className="conn-name">{`Total, ${u}`}</div><div className="conn-meta">{`Includes the ${rack.bar} ${rack.unit} bar`}</div></div>
            <Stepper value={t} step={step} min={0} label="Total weight" onChange={setT} />
          </div>
          <div className="field">
            <div className="input-label">On Each Side</div>
            {facts && facts.kind === "plates" ? (
              <div className="se-plates">
                {facts.per.map((p, i) => <span className="se-plate" key={p + ":" + i}>{p}</span>)}
              </div>
            ) : facts && facts.kind === "none" ? (
              <div className="facts">
                <span className="fact amber">{`Not buildable at ${facts.at}`}</span>
                {facts.nearest != null && <span className="fact">{`Nearest ${facts.nearest}`}</span>}
              </div>
            ) : t < rack.bar ? (
              // A TOTAL UNDER THE BAR IS NOT "JUST THE BAR" (2026-09-16, Dave
              // photographed 35 lb reading "Includes the 45 lb bar / Just the
              // bar"). plateFacts returns null both when the total IS the bar
              // and when it is BELOW it, and this branch called both of them
              // the same thing -- so an impossible number was reported as a
              // loaded bar. Below the bar the honest answer is that the bar
              // alone already weighs more than the target.
              <div className="facts">
                <span className="fact amber">{`The bar alone is ${rack.bar} ${rack.unit}`}</span>
              </div>
            ) : (
              <div className="facts"><span className="fact">Just the bar</span></div>
            )}
          </div>
          <div className="input-hint">{`Pairs on this rack: ${rack.plates.join(", ")} ${rack.unit} · Collars excluded`}</div>
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-secondary btn-block" onClick={onClose}>Back to Workout</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
