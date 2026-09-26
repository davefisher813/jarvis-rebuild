import { liftTitle } from "../shared/casing";
import { useState } from "react";
import { createPortal } from "react-dom";
import type { ProgramDay, Workout } from "./types";
import type { RackConfig } from "./ramp";
import { own } from "../shared/rowDoor";
import { estimateDay, leverOffers, trimTargets, type FitPlan, type LeverKey } from "./fit";

// THE FIT SHEET, D5 (Training Catalog V2, approved 2026-08-31). "Starting a
// day asks how long you have (or reads the block length)." Every lever is a
// switch the athlete flips, every saving is priced in the open, and the plan
// itself is never edited -- a fit is a stance for one session (LAW 17).
// Walking in through a timed gym block pre-fills the budget from the block's
// own length; from the gym page the default is no cap, so an athlete who
// never asked for time-boxing is never paced by a number they didn't pick.
export default function FitSheet({ day, history, rack, defaultBudgetMin, onStart, onCancel, gameLine }: {
  day: ProgramDay;
  history: Workout[];
  rack: RackConfig;
  /** From the door event's own start/end when the session enters through the
   *  calendar (D4-C); absent from the gym page. */
  defaultBudgetMin?: number;
  onStart: (fit: FitPlan) => void;
  onCancel: () => void;
  /** UP-ATH-02 (2026-09-06): "Game Saturday 6 PM", when the program is in
   *  season and the athlete has said which category means a game. Said ONCE,
   *  here, as a fact beside the plan. It changes no lever and no estimate:
   *  what to do about a game on Saturday is the athlete's call, and a taper
   *  is exactly the kind of advice this app does not give. */
  gameLine?: string;
}) {
  const [budget, setBudget] = useState<number>(defaultBudgetMin ?? 0);
  const [plan, setPlan] = useState<FitPlan>({});
  const planMin = estimateDay(day, history, rack).min;
  const est = estimateDay(day, history, rack, plan);
  const offers = leverOffers(day, history, rack, plan);
  const over = budget > 0 ? est.min - budget : 0;
  const budgetTone = over > 0 ? "fit-over" : "fit-under";

  const chips: number[] = [30, 45, 60];
  if (defaultBudgetMin && !chips.includes(defaultBudgetMin)) {
    chips.push(defaultBudgetMin);
    chips.sort((a, b) => a - b);
  }

  // A filler rides inside its partner's rest and is not a thing you choose
  // separately, so it is not offered as one.
  const doable = day.exercises.filter((e) => !e.filler);
  const toggleEx = (id: string) => setPlan((p) => {
    const skip = new Set(p.skip ?? []);
    if (skip.has(id)) skip.delete(id);
    // NEVER ALL OF THEM. Unticking the last lift would start an empty
    // session, which is a workout you did not do; the last one on stays on.
    else if (doable.some((e) => e.id !== id && !skip.has(e.id))) skip.add(id);
    return { ...p, skip: [...skip] };
  });
  const toggle = (key: LeverKey) => setPlan((p) => {
    if (key === "restCut") return { ...p, restCut: !p.restCut };
    if (key === "superset") return { ...p, superset: !p.superset };
    if (key === "skipCool") return { ...p, skipCool: !p.skipCool };
    return { ...p, trims: Object.keys(p.trims ?? {}).length ? {} : trimTargets(day) };
  });

  const start = () => {
    const trims = plan.trims && Object.keys(plan.trims).length ? plan.trims : undefined;
    onStart({
      ...(plan.skip?.length ? { skip: plan.skip } : {}),
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
        <div className="grp"><div className="eyebrow">{day.name} · Plan {planMin} Min{gameLine ? " · " + gameLine : ""}</div></div>

        <div className="sheet-form">
        {/* WHAT, BEFORE HOW LONG (2026-09-21). The sheet asked how long you
            had and offered to trim accessory sets, and never asked which
            lifts -- so a day was a script you ran, and choosing meant Skip or
            Swap once the session was already going.
            Everything is on when the sheet opens, so doing nothing here is
            exactly the behaviour that shipped. Untick two and the session is
            the rest -- and the estimate below moves as you tick, which makes
            the time cap and the choice one decision instead of two. The
            program is untouched either way: this is a stance for one session,
            the same as every lever under it. */}
        {doable.length > 1 && (
          <>
            <div className="pad-x"><div className="input-label">Doing Today</div></div>
            <div><div className="list-flat">
              {doable.map((e) => {
                const on = !(plan.skip ?? []).includes(e.id);
                return (
                  <div className="row" key={e.id} onClick={() => toggleEx(e.id)}>
                    <div className="task-check-tap" role="checkbox" aria-checked={on}
                      aria-label={`${liftTitle(e.name)}, ${on ? "doing today" : "not today"}`}
                      onClick={own(() => toggleEx(e.id))}>
                      <div className={"task-check" + (on ? " done" : "")} />
                    </div>
                    <div className="row-grow">
                      <div className={"conn-name truncate" + (on ? "" : " fit-off")}>{liftTitle(e.name)}</div>
                    </div>
                    <span className="conn-meta">{e.cond ? "Clock" : `${e.sets.length} \u00d7 ${e.sets[0]?.r ?? ""}`}</span>
                  </div>
                );
              })}
            </div></div>
          </>
        )}

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
                // The whole lever row flips its switch (Dave 2026-09-15: "I want all rows clickable").
                <div className="row" key={o.key} onClick={() => toggle(o.key)}>
                  <div className="row-grow">
                    <div className="conn-name truncate">{liftTitle(o.name)}</div>
                    <div className="conn-meta">{o.sub}</div>
                  </div>
                  <div className={"switch" + (o.on ? "" : " off")} role="switch" aria-checked={o.on} tabIndex={0}
                    onClick={own(() => toggle(o.key))} />
                </div>
              ))}
            </div></div>
          </>
        )}

        <div className="pad-x">
          <div className="fit-line">
            <span>Fits: {est.min} min</span>
            {/* No cap says nothing here: the selected No Cap chip above says it. */}
            {budget > 0 && <span className={budgetTone}>{over > 0 ? `${over} min over` : over < 0 ? `${-over} min under` : "On budget"}</span>}
          </div>
          {/* The honesty line (D5 "needs D7 for honest numbers"): the sheet
              always says which world its estimate came from. GYM-F-07
              (2026-09-05): a conditioning block is priced from its own stated
              clock, not from any pace, so a day made only of clocks says that
              instead of blaming a default pace it never used. A For Time cap
              is where the clock stops, not how long the work takes -- the only
              number in this sheet that can only be too high -- so when one is
              counted it rides the same line rather than stacking a second
              grey under it (§AK). */}
          <div className="conn-meta">
            {est.liftCount === 0 && est.condCount > 0
              ? "timed from the block's own clock"
              : est.learnedCount > 0
                ? `${est.learnedCount} of ${est.liftCount} lifts at your logged pace`
                : "default pace, improves as you log"}
            {est.cappedCount > 0 && "; a For Time cap is the ceiling, not a forecast"}
          </div>
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
