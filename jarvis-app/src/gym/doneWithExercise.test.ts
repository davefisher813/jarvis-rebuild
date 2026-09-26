import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { posix } from "node:path";

// ---------------------------------------------------------------------------
// DAVE, 2026-09-17: "When logging workouts there should be a done button for
// exercises right now it just goes on forever til I switch to another
// exercise."
//
// The log bar held one button that said Log, at every moment of every
// exercise. The plan running out looked exactly like the plan having two sets
// left, and the only way on was to notice a row further down the screen and
// tap it. There was no way to SAY you were finished.
// ---------------------------------------------------------------------------

const { join } = posix;
const SRC = join(process.cwd().replace(/\\/g, "/"), "src");
const read = (f: string) => readFileSync(join(SRC, f), "utf8");
const SESSION = read("gym/SessionScreen.tsx");
const RULED = read("styles/ruled.css");

describe("an exercise can be finished on purpose", () => {
  // Warm-ups and drops are not the work and never have been: workLogged
  // already filters them, and this reads that same count.
  it("counts the plan as done from the working sets, not every chip", () => {
    expect(SESSION).toContain("const planComplete = !current.skipped && (planEx.sets.length > 0");
    expect(SESSION).toContain("? workLogged >= planEx.sets.length");
  });

  // A lift added mid-session, or any lift in a scratch session, has no plan
  // to run out. One logged set is the whole of "there is something here".
  it("finishes an unplanned lift on its first logged set", () => {
    expect(SESSION).toContain(": logged.length > 0);");
  });

  // AMENDED 2026-09-26 (workout logging): the destination is one decision,
  // `nextIdx` / `goNext`, and inside a superset it names the partner's turn
  // ("Next: A2") instead of walking the day's order.
  it("says where the button goes, rather than just Done", () => {
    // "Done" alone on the last exercise of a session would be a button that
    // silently ends the workout.
    expect(SESSION).toContain('const nextLabel = pairNextLiveIdx >= 0 ? `Next: ${labels.get(pairNextId!) ?? ""}`.trim() : nextIdx >= 0 ? "Next Exercise" : "Finish Workout";');
    expect(SESSION).toContain("const goNext = () => (nextIdx >= 0 ? onMove(nextIdx) : onFinish());");
  });

  // AMENDED 2026-09-26 (workout logging, Dave: one flow, only the red button
  // logs): the extra set is not written on the spot from a number nowhere on
  // the screen. "Add a Set" opens one more Now row, prefilled with the set
  // before, and the red button logs it like every other set.
  it("keeps another set one tap away, as the secondary", () => {
    expect(SESSION).toContain('<button className="btn btn-secondary btn-lg" onClick={() => setExtraOpen(true)}>Add a Set</button>');
    expect(SESSION).toContain('<button className="btn btn-secondary btn-lg" onClick={() => setClockOpen(true)}>Run It Again</button>');
  });

  it("leaves a skipped exercise alone", () => {
    expect(SESSION).toContain("const planComplete = !current.skipped &&");
  });

  // The bar was built for exactly one button (.btn { width: 100% } and no
  // gap), so a second one would have sat on top of the first.
  it("gives the bar room for two", () => {
    expect(RULED).toContain(".ruled.health-ruled .logbar .btn:not(:only-child) { flex: 1 1 0; min-width: 0; }");
    expect(RULED).toContain(".ruled.health-ruled .logbar .btn.btn-launch:not(:only-child) { flex: 1.35 1 0; }");
    const bar = RULED.slice(RULED.indexOf(".ruled.health-ruled .logbar {"), RULED.indexOf(".ruled.health-ruled .logbar {") + 500);
    expect(bar, "two buttons with no gap are one button").toContain("gap: var(--s-2);");
  });
});

// ---------------------------------------------------------------------------
// The create sheet on the Exercises page, second pass.
// ---------------------------------------------------------------------------
describe("creating a lift from the library carries what the sheet was told", () => {
  const FLOW = read("gym/GymFlow.tsx");

  it("seeds the loading convention, so it is not asked for twice", () => {
    expect(FLOW).toContain("key, name: cased, kind: draft.kind,");
    const seed = FLOW.slice(FLOW.indexOf("onCreate={(draft) => {"), FLOW.indexOf("onCreate={(draft) => {") + 1600);
    expect(seed).toContain("...loadFields(draft),");
  });

  it("files a muscle where every other muscle assignment is filed", () => {
    // Not on the entry: a muscle is a CLASSIFICATION, and putting it in the
    // class store is also what takes the amber Assign Muscles chip off the
    // brand new row.
    expect(FLOW).toContain("if (draft.muscleGroup) {");
    expect(FLOW).toContain("primary: [draft.muscleGroup], measure: draft.kind");
  });

  it("still refuses to mint a second row for a name already here", () => {
    expect(FLOW).toContain("const twin = library.find((e) => e.name.trim().toLowerCase() === name.toLowerCase() && e.kind === draft.kind);");
  });

  it("reuses the key the sheet already minted, rather than a second one", () => {
    expect(FLOW).toContain("const key = draft.exerciseKey ?? newExerciseKey();");
  });
});

// ---------------------------------------------------------------------------
// DAVE, 2026-09-21, on a live Push Day: "I still can't make an exercise as
// done during a workout."
//
// He could, but only once every planned set was logged. Two of three, because
// two is genuinely all you have in you, and the way on was not offered: the
// only exit was Skip This Exercise, a row far down the screen, and the wrong
// word for it. Skipped means you did none of it.
// ---------------------------------------------------------------------------
describe("the way on is offered before the plan runs out", () => {
  // AMENDED 2026-09-26 (workout logging): the extra Now row (Add a Set)
  // counts as "the plan is not done" for the bar, so the pair reads the same
  // while it is open.
  it("appears as soon as there is anything worth keeping", () => {
    expect(SESSION).toContain("{(!planComplete || extraOpen) && logged.length > 0 && !cond && (");
  });

  it("is the same destination as the one after the plan completes", () => {
    // Two buttons, one decision: whichever is on screen, it goes through
    // goNext, to the partner's turn, the next exercise, or the finish.
    const goes = SESSION.match(/onClick=\{goNext\}/g) ?? [];
    expect(goes.length, "the mid-plan one and the plan-complete one").toBeGreaterThanOrEqual(2);
    const says = SESSION.match(/\{nextLabel\}/g) ?? [];
    expect(says.length).toBeGreaterThanOrEqual(2);
  });

  it("stays SECONDARY until the plan is done, then they swap", () => {
    // The 2026-09-17 ruling is unchanged: until the plan is complete logging
    // is the common move, so moving on does not take the primary.
    expect(SESSION).toContain(`{(!planComplete || extraOpen) && logged.length > 0 && !cond && (
            <button className="btn btn-secondary btn-lg" onClick={goNext}>{nextLabel}</button>`);
    expect(SESSION).toContain(`{planComplete && !extraOpen
            ? <button className="btn btn-primary btn-launch btn-lg"`);
  });

  // AMENDED 2026-09-26 (workout logging): Skip lives in the More sheet, and
  // only while nothing is logged, since skipping discards the sets done.
  it("is not offered with nothing logged, where Skip is the honest word", () => {
    // An exercise you did none of IS skipped, and that line exists for it.
    expect(SESSION).toContain("logged.length > 0 && !cond");
    expect(SESSION).toContain('...(logged.length === 0 ? [{ label: "Skip This Exercise", onClick: onSkip }] : []),');
  });
});
