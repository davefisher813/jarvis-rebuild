import { useState } from "react";
import { createPortal } from "react-dom";
import type { ProgramDay, Workout } from "./types";
import type { RackConfig } from "./ramp";
import { estimateDay, leverOffers, trimTargets, type FitPlan, type LeverKey } from "./fit";

// THE FIT SHEET, D5 (Training Catalog V2, approved 2026-08-31). "Starting a
// day asks how long you have (or reads the block length)." Every lever is a
// switch the athlete flips, every saving is priced in the open, and the plan
// itself is never edited -- a fit is a stance for one session (LAW 17).
// Walking in through a timed gym block pre-fills the budget from the block's
// own length; from the gym page the default is no cap, so an athlete who
// never asked for time-boxing is never paced by a number they didn't pick.
export default function FitSheet({ day, history, rack, defaultBudgetMin, onStart, onCancel }: {
  day: ProgramDay;
  history: Workout[];
  rack: RackConfig;
  /** From the door event's own start/end when the session enters through the
   *  calendar (D4-C); absent from the gym page. */
  defaultBudgetMin?: number;
  onStart: (fit: FitPlan) => void;
  onCancel: () => void;
}) {
  const [budget, setBudget] = useState<number>(defaultBudgetMin ?? 0);
  const [plan, setPlan] = useState<FitPlan>({});
  const planMin = estimateDay(day, history, rack).min;
  const est = estimateDay(day, history, rack, plan);
  const offers = leverOffers(day, history, rack, plan);
  const over = budget > 0 ? est.min - budget : 0;

  const chips: number[] = [30, 45, 60];
  if (defaultBudgetMin && !chips.includes(defaultBudgetMin)) {
    chips.push(defaultBudgetMin);
    chips.sort((a, b) => a - b);
  }

  const toggle = (key: LeverKey) => setPlan((p) => {
    if (key === "restCut") return { ...p, restCut: !p.restCut };
    if (key === "superset") return { ...p, superset: !p.superset };
    if (key === "skipCool") return { ...p, skipCool: !p.skipCool };
    return { ...p, trims: Object.keys(p.trims ?? {}).length ? {} : trimTargets(day) };
  });

  const start = () => {
    const trims = plan.trims && Object.keys(plan.trims).length ? plan.trims : undefined;
    onStart({
      ...(budget > 0 ? { budgetMin: budget } : {}),
      ...(plan.restCut ? { restCut: true } : {}),
      ...(plan.superset ? { superset: true } : {}),
      ...(plan.skipCool ? { skipCool: true } : {}),
      ...(trims ? { trims } : {}),
    });
  };

  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{day.name} · Plan {planMin} Min</div></div>

        <div className="pad-x">
          <div className="field">
            <div className="input-label">How Long Do You Have</div>
            <div className="chip-row chip-wrap-row">
              {chips.map((b) => (
                <div key={b} className={"chip" + (budget === b ? " active" : "")} role="button" tabIndex={0}
                  aria-pressed={budget === b} onClick={() => setBudget(b)}>{b} min</div>
              ))}
              <div className={"chip" + (budget === 0 ? " active" : "")} role="button" tabIndex={0}
                aria-pressed={budget === 0} onClick={() => setBudget(0)}>No Cap</div>
            </div>
          </div>
        </div>

        {offers.length > 0 && (
          <>
            <div className="pad-x"><div className="input-label">Levers</div></div>
            <div><div className="list-flat">
              {offers.map((o) => (
                <div className="row" key={o.key}>
                  <div className="row-grow">
                    <div className="conn-name truncate">{o.name}</div>
                    <div className="conn-meta">{o.sub}</div>
                  </div>
                  <div className={"switch" + (o.on ? "" : " off")} role="switch" aria-checked={o.on} tabIndex={0}
                    onClick={() => toggle(o.key)} />
                </div>
              ))}
            </div></div>
          </>
        )}

        <div className="pad-x">
          <div className="fit-line">
            <span>Fits: {est.min} min</span>
            {budget > 0
              ? <span className={over > 0 ? "fit-over" : "fit-under"}>{over > 0 ? `${over} over` : "Under budget"}</span>
              : <span className="conn-meta">No cap</span>}
          </div>
          {/* The honesty line (D5 "needs D7 for honest numbers"): the sheet
              always says which world its estimate came from. */}
          <div className="conn-meta">
            {est.learnedCount > 0
              ? `${est.learnedCount} of ${est.liftCount} lifts at your logged pace`
              : "default pace · improves as you log"}
          </div>
        </div>

        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-launch btn-block" onClick={start}>Start · {est.min} Min</button>
          <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
