// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { planningPatternObservation, readDurationCorrections, type DurationCorrection } from "./planningPatterns";
import { setCategoryRegistry } from "../shared/categories";
import { eventLog } from "../events";
import { emit } from "../events";

const NOW = 1_700_000_000_000; // fixed instant, arbitrary
const DAY = 86400000;

function corr(category: string, deltaMin: number, daysAgo = 0): DurationCorrection {
  return { category, deltaMin, ts: NOW - daysAgo * DAY };
}

describe("planningPatternObservation", () => {
  // BRAIN-F-05's other half (2026-09-06): the corrections carry category IDS
  // (PlanDaySheet emits t.category), and the copy resolves them to the user's
  // own names. The fixtures below feed ids and assert names, which is the
  // contract; asserting the id back was what let the uuid reach the card.
  beforeEach(() => {
    setCategoryRegistry([
      { id: "work", name: "Work", color: "blue" },
      { id: "errands", name: "Errands", color: "orange" },
      { id: "gym", name: "Gym", color: "green" },
    ]);
  });

  it("says nothing with no corrections", () => {
    expect(planningPatternObservation([], NOW)).toBeNull();
  });

  it("says nothing with fewer than 3 corrections for any category", () => {
    const cs = [corr("work", 20), corr("work", 25)];
    expect(planningPatternObservation(cs, NOW)).toBeNull();
  });

  it("reports a category that consistently runs longer than estimated", () => {
    const cs = [corr("work", 20), corr("work", 15), corr("work", 25)];
    const r = planningPatternObservation(cs, NOW);
    expect(r).toEqual({ id: "plan-dur-long-work", text: "Work tasks run 20 min long" }); // SPEC MOVED (short copy, 2026-08-15)
  });

  it("reports a category that consistently wraps up faster than estimated", () => {
    const cs = [corr("errands", -10), corr("errands", -15), corr("errands", -20)];
    const r = planningPatternObservation(cs, NOW);
    expect(r).toEqual({ id: "plan-dur-short-errands", text: "Errands tasks finish 15 min early" }); // SPEC MOVED
  });

  it("says nothing when the direction is not consistent (mixed signal, not a pattern)", () => {
    const cs = [corr("work", 20), corr("work", -15), corr("work", 25)];
    expect(planningPatternObservation(cs, NOW)).toBeNull();
  });

  it("says nothing when the average magnitude is too small to matter", () => {
    const cs = [corr("work", 5), corr("work", 5), corr("work", 5)];
    expect(planningPatternObservation(cs, NOW)).toBeNull();
  });

  it("ignores corrections older than 30 days", () => {
    const cs = [corr("work", 20, 40), corr("work", 20, 45), corr("work", 20, 50)];
    expect(planningPatternObservation(cs, NOW)).toBeNull();
  });

  it("ignores corrections with no category", () => {
    const cs = [corr("", 20), corr("", 25), corr("", 30)];
    expect(planningPatternObservation(cs, NOW)).toBeNull();
  });

  it("picks the category with the most evidence when more than one qualifies, ties broken alphabetically", () => {
    const cs = [
      corr("work", 20), corr("work", 20), corr("work", 20), corr("work", 20),
      corr("gym", 20), corr("gym", 20), corr("gym", 20),
    ];
    const r = planningPatternObservation(cs, NOW);
    expect(r?.id).toBe("plan-dur-long-work"); // 4 corrections beats 3
  });

  it("is deterministic: a true alphabetical tie always resolves the same way", () => {
    const cs = [
      corr("work", 20), corr("work", 20), corr("work", 20),
      corr("gym", 20), corr("gym", 20), corr("gym", 20),
    ];
    const r = planningPatternObservation(cs, NOW);
    expect(r?.id).toBe("plan-dur-long-gym"); // "gym" < "work" alphabetically
  });
});

// BRAIN-F-05's other half (2026-09-06). plan.duration_corrected carries the
// category ID, so this observation printed a raw uuid on the card, and
// accepting it wrote a strand carrying that uuid into every AI prompt from
// then on. Ids in, names out, exactly as deriveSlipCategory already does.
describe("a duration observation never speaks a category id", () => {
  const MONEY = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
  const three = (cat: string) => [corr(cat, 20), corr(cat, 25), corr(cat, 30)];

  it("a live area is named the way the user named it", () => {
    setCategoryRegistry([{ id: MONEY, name: "Money", color: "green" }]);
    const r = planningPatternObservation(three(MONEY), NOW);
    expect(r?.text).toBe("Money tasks run 25 min long");
    expect(r?.text).not.toContain(MONEY);
  });

  it("an area that no longer exists produces no observation, not a uuid", () => {
    // Never the id, never "Unknown", never a blank: a sentence about an area
    // nobody can see is not a fact anyone can check.
    setCategoryRegistry([]);
    expect(planningPatternObservation(three(MONEY), NOW)).toBeNull();
  });

  it("a rename shows immediately and does not re-offer a fact already answered", () => {
    // The registry is refreshed live by AppShell's category bus, so the copy
    // follows the rename. The derivation key must NOT: it is what the accept
    // path matches and what the dismiss memory remembers, so a renamed area
    // has to keep asking the same question, not a new one.
    setCategoryRegistry([{ id: MONEY, name: "Money", color: "green" }]);
    const before = planningPatternObservation(three(MONEY), NOW);
    setCategoryRegistry([{ id: MONEY, name: "Finances", color: "green" }]);
    const after = planningPatternObservation(three(MONEY), NOW);
    expect(after?.text).toBe("Finances tasks run 25 min long");
    expect(after?.id).toBe(before?.id);
    expect(after?.id).toBe("plan-dur-long-" + MONEY);
  });
});

describe("readDurationCorrections", () => {
  beforeEach(() => { eventLog.clear(); });

  it("reads plan.duration_corrected events back into the domain shape", () => {
    emit({ type: "plan.duration_corrected", entityType: "task", entityId: "t1", props: { category: "work", n: 20 } });
    emit({ type: "plan.picked", entityType: "task", entityId: "t2", props: { n: 1 } }); // noise, must be ignored
    const out = readDurationCorrections();
    expect(out).toHaveLength(1);
    expect(out[0]!.category).toBe("work");
    expect(out[0]!.deltaMin).toBe(20);
  });

  it("returns nothing when the log is empty", () => {
    expect(readDurationCorrections()).toEqual([]);
  });
});
