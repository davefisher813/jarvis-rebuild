import { useState } from "react";
import { createPortal } from "react-dom";
import { plateFacts, type RackConfig } from "./ramp";
import { plateMath, weightStep, weightLabel, type LoadStyle } from "./equipment";
import Stepper from "../shared/Stepper";

// THE LOAD CALCULATOR (2026-09-14 as "Load the bar"; rebuilt 2026-09-16 after
// Dave: "the plate calculator has to factor in all of the weight loading
// options not just dumbbells").
//
// It was a barbell calculator with no way of knowing it was one. Every loaded
// exercise offered it, and whatever it was handed it subtracted a 45 lb bar
// and halved the rest -- so a Smith carriage and a plate-loaded machine, which
// carry real plates and have no 45 to take off, both came out a bar's worth
// wrong; a dumbbell got barbell arithmetic applied to one bell; and a stack
// got plate math for a machine that has no plates at all.
//
// equipment.ts has known the difference the whole time (plates, hasBar, step,
// and what the number is COUNTED as). This reads it. One sheet, one question,
// answered in the terms of the hardware in front of the athlete:
//
//   barbell               the bar, then the plates per side
//   Smith, plate machine  the plates per side, and NO bar subtracted
//   dumbbell, kettlebell  one bell's number, and what the pair adds up to
//   stack, cable          the pin, and the nearest number the stack can make
//
// THE STANDING RULE HOLDS: a convention is a label, never a conversion. This
// computes what to LOAD; it never rewrites the number the athlete typed.
export default function PlateSheet({ total, unit, rack, style, onClose }: {
  /** The weight to load, in the exercise's own unit. */
  total: number;
  unit?: string;
  rack: RackConfig;
  /** What the athlete is lifting, and what their number counts. */
  style: LoadStyle;
  onClose: () => void;
}) {
  const math = plateMath(style);
  const step = math.offer ? (Math.min(...rack.plates) * 2 || 5) : weightStep(style, unit);
  // A bar comes off only where there IS one. equipment.ts says so per kind.
  const bar = math.hasBar ? rack.bar : 0;
  const [t, setT] = useState(total > 0 ? total : bar || step);
  const u = unit ?? rack.unit ?? "lb";
  const facts = math.offer ? plateFacts(t, rack, unit, bar) : null;

  const pair = style.equipment === "dumbbell" || style.equipment === "kettlebell";
  const stack = style.equipment === "stack" || style.equipment === "cable";
  const title = math.offer ? (math.hasBar ? "Load the Bar" : "Load the Plates")
    : pair ? "One Bell, and the Pair" : "Set the Pin";

  // A stack moves in fixed notches, so the only honest question is whether the
  // number asked for is one of them, and which notch is nearest if it is not.
  const notch = stack ? Math.round(t / step) * step : null;

  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{title}</div></div>
        <div className="pad-x sheet-form">
          <div className="row">
            <div className="row-grow">
              <div className="conn-name">{`${weightLabel(style)}, ${u}`}</div>
              {math.hasBar && <div className="conn-meta">{`Includes the ${rack.bar} ${rack.unit ?? "lb"} bar`}</div>}
            </div>
            <Stepper value={t} step={step} min={0} label="Weight" onChange={setT} />
          </div>

          {/* PLATES: a barbell, a Smith carriage or a plate-loaded machine. */}
          {math.offer && (
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
              ) : math.hasBar && t < rack.bar ? (
                // A TOTAL UNDER THE BAR IS NOT "JUST THE BAR" (2026-09-16, Dave
                // photographed 35 lb reading "Includes the 45 lb bar / Just the
                // bar"). plateFacts returns null both when the total IS the bar
                // and when it is below it, and one branch called both the same
                // thing, so an impossible number reported as a loaded bar.
                <div className="facts">
                  <span className="fact amber">{`The bar alone is ${rack.bar} ${rack.unit ?? "lb"}`}</span>
                </div>
              ) : math.hasBar ? (
                <div className="facts"><span className="fact">Just the bar</span></div>
              ) : (
                <div className="facts"><span className="fact">Nothing on it yet</span></div>
              )}
            </div>
          )}

          {/* A PAIR: the number is one bell, and the total moved is both. */}
          {pair && (
            <div className="field">
              <div className="input-label">Both Hands</div>
              <div className="facts">
                <span className="fact lime">{`${t * 2} ${u} moved`}</span>
                <span className="fact">{`2 × ${t} ${u}`}</span>
              </div>
            </div>
          )}

          {/* A STACK: notches, not plates. */}
          {stack && (
            <div className="field">
              <div className="input-label">On the Stack</div>
              {notch != null && Math.abs(notch - t) < 1e-9 ? (
                <div className="facts"><span className="fact">{`A pin at ${t} ${u}`}</span></div>
              ) : (
                <div className="facts">
                  <span className="fact amber">{`This stack steps in ${step} ${u}`}</span>
                  {notch != null && <span className="fact">{`Nearest pin ${notch}`}</span>}
                </div>
              )}
            </div>
          )}

          <div className="input-hint">
            {math.offer
              ? `Pairs on this rack: ${rack.plates.join(", ")} ${rack.unit ?? "lb"} · Collars excluded`
              : pair
                ? "The chip records one bell, the way a rack is labelled"
                : "The number beside the pin, whatever the pulley does to it"}
          </div>
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-secondary btn-block" onClick={onClose}>Back to Workout</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
