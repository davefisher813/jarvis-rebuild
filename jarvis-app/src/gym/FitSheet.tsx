import { lineCase, liftTitle, workoutTitle } from "../shared/casing";
import { spanLabel } from "../shared/duration";
import { useState } from "react";
import { createPortal } from "react-dom";
import type { ProgramDay, Workout } from "./types";
import type { RackConfig } from "./ramp";
import { own } from "../shared/rowDoor";
import { planChip } from "./measures";
import { estimateDay, leverOffers, trimTargets, type FitPlan, type LeverKey, type LeverOffer } from "./fit";

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

  /** THE LEVERS AS THE BOARD WORDS THEM (Dave's approved board 2026-10-16,
   *  screen 3): a switch row with a bold name and one grey line under it.
   *  The cool-down lever reads as KEEP (on = kept, which is the default and
   *  the honest reading of a switch that is on when the sheet opens); the
   *  trim lever reads as the board says it; the others keep their own names,
   *  which carry the numbers. The saving rides the line as a second fact. */
  const leverFace = (o: LeverOffer): { name: string; subs: string[]; on: boolean } => {
    if (o.key === "skipCool") return { name: "Keep Warm-Up & Cool-Down", subs: ["Counts Toward Your Time"], on: !o.on };
    if (o.key === "trim") return { name: "Trim Accessories First", subs: ["If Time Runs Short", o.sub], on: o.on };
    return { name: liftTitle(o.name), subs: [o.sub, ...(o.note ? [o.note] : [])], on: o.on };
  };
  /** The plan under a lift's name: "275 Lb × 5", "8 Reps", or the block's clock. */
  const planLine = (e: ProgramDay["exercises"][number]) => {
    if (e.cond) return "Clock";
    const c = planChip(e);
    return c.target ? lineCase(c.target) : lineCase(`${c.count} ${c.noun}`);
  };
  const picked = doable.filter((e) => !(plan.skip ?? []).includes(e.id)).length;
  /** The board's order: Keep Warm-Up & Cool-Down first, Trim next, the rest after. */
  const rank = (k: LeverKey) => (k === "skipCool" ? 0 : k === "trim" ? 1 : 2);
  const ordered = [...offers].sort((a, b) => rank(a.key) - rank(b.key));
  const paceLine = est.liftCount === 0 && est.condCount > 0
    ? lineCase("timed from the block's own clock")
    : est.learnedCount > 0
      ? lineCase(`${est.learnedCount === est.liftCount ? "all " : ""}${est.learnedCount === est.liftCount ? est.liftCount : `${est.learnedCount} of ${est.liftCount}`} exercises at your logged pace`)
      : "Default Pace, Improves as You Log";

  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      {/* .wo-sheet: the board's geometry for Doing Today (screen 3), scoped in ruled.css; the sheet portals to body,
          so it cannot inherit the screen's .wo-screen. */}
      <div className="card wo-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        {/* THE HEAD AS THE BOARD DRAWS IT (screen 3): the day and its planned
            length as the title, the count and the order as its one grey line.
            The game line (UP-ATH-02) rides the same grey line when there is one. */}
        <div className="pad-x fit-head">
          <div className="fit-title">{workoutTitle(day.name)} · Plan {spanLabel(planMin)}</div>
          <div className="facts">
            <span className="fact">{lineCase(`${doable.length} ${doable.length === 1 ? "exercise" : "exercises"}, in program order`)}</span>
            {gameLine && <span className="fact">{gameLine}</span>}
          </div>
        </div>

        <div className="sheet-form">
        {/* NUMBERS, NOT GREEN CHECKS (the board, screen 3; Dave 2026-10-16: green
            is done). Every lift is on when the sheet opens, numbered in the
            program's order; untick one and its badge dims and strikes, the row
            goes grey, and the estimate below moves. The program is untouched
            either way: this is a stance for one session (LAW 17). The last
            lift on cannot be unticked (a workout you did not do is not a
            workout). A filler rides inside its partner's rest, so it is not
            offered. */}
        {doable.length > 0 && (
          <div className="pad-x"><div className="card list-card-ruled">
            {doable.map((e, i) => {
              const on = !(plan.skip ?? []).includes(e.id);
              return (
                <div className={"row fit-row" + (on ? "" : " fit-row-off")} key={e.id} role="checkbox" aria-checked={on} tabIndex={0}
                  aria-label={`${liftTitle(e.name)}, ${on ? "doing today" : "not today"}`}
                  onClick={() => toggleEx(e.id)}
                  onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggleEx(e.id); } }}>
                  <span className={"fit-no" + (on ? "" : " off")} aria-hidden="true">{i + 1}</span>
                  <div className="row-grow">
                    <div className={"conn-name truncate" + (on ? "" : " fit-off")}>{liftTitle(e.name)}</div>
                    <div className="conn-meta">{planLine(e)}</div>
                  </div>
                </div>
              );
            })}
          </div></div>
        )}

        <div className="pad-x fit-time">
          <div className="grp xs-grp"><div className="eyebrow">How Long Do You Have</div></div>
          {/* ONE SELECTED STATE: the picked length wears a red outline, nothing is filled. */}
          <div className="chip-row chip-wrap-row">
            {chips.map((b) => (
              <div key={b} className={"chip" + (budget === b ? " active" : "")} role="button" tabIndex={0}
                aria-pressed={budget === b} onClick={() => setBudget(b)}>{spanLabel(b)}</div>
            ))}
            <div className={"chip" + (budget === 0 ? " active" : "")} role="button" tabIndex={0}
              aria-pressed={budget === 0} onClick={() => setBudget(0)}>No Cap</div>
          </div>
        </div>

        {offers.length > 0 && (
          <div className="pad-x"><div className="card list-card-ruled">
            {ordered.map((o) => {
              const f = leverFace(o);
              return (
                // The whole lever row flips its switch (Dave 2026-09-15: "I want all rows clickable").
                <div className="row fit-lever" key={o.key} onClick={() => toggle(o.key)}>
                  <div className="row-grow">
                    <div className="conn-name truncate">{f.name}</div>
                    <div className="conn-meta">
                      {f.subs.map((t) => <span className="fact" key={t}>{t}</span>)}
                    </div>
                  </div>
                  <div className={"switch" + (f.on ? "" : " off")} role="switch" aria-checked={f.on} tabIndex={0}
                    onClick={own(() => toggle(o.key))} />
                </div>
              );
            })}
          </div></div>
        )}

        {/* THE FIT LINE IS PLAIN TEXT (the board): "Fits: 56 Min · All 8 Exercises at Your Logged Pace", the values bold, no
            pill. The honesty line (D5 "needs D7 for honest numbers") is the sentence's tail: which world the estimate came
            from. A For Time cap is the ceiling, not a forecast, so it is named when counted. */}
        <div className="pad-x">
          <div className="fit-line">
            <span className="fit-k">Fits:</span>
            <span className="facts">
              <span className="fact"><b>{spanLabel(est.min)}</b></span>
              <span className="fact">
                {est.liftCount > 0 && picked === doable.length
                  ? <><b>{lineCase(`all ${doable.length} ${doable.length === 1 ? "exercise" : "exercises"}`)}</b>{est.learnedCount === est.liftCount && est.learnedCount > 0 ? " at Your Logged Pace" : ""}</>
                  : <><b>{lineCase(`${picked} of ${doable.length} exercises`)}</b></>}
              </span>
              {!(est.liftCount > 0 && picked === doable.length && est.learnedCount === est.liftCount && est.learnedCount > 0) && <span className="fact">{paceLine}</span>}
              {est.cappedCount > 0 && <span className="fact">A For Time Cap Is the Ceiling, Not a Forecast</span>}
              {budget > 0 && over !== 0 && <span className="fact"><b>{over > 0 ? `${spanLabel(over)} Over` : `${spanLabel(-over)} Under`}</b></span>}
            </span>
          </div>
        </div>
        </div>

        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-launch btn-block" onClick={start}>Start · {spanLabel(est.min)}</button>
          <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
