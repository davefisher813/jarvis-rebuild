// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { planningPatternObservation, readDurationCorrections, type DurationCorrection } from "./planningPatterns";
import { eventLog } from "../events";
import { emit } from "../events";

const NOW = 1_700_000_000_000; // fixed instant, arbitrary
const DAY = 86400000;

function corr(category: string, deltaMin: number, daysAgo = 0): DurationCorrection {
  return { category, deltaMin, ts: NOW - daysAgo * DAY };
}

describe("planningPatternObservation", () => {
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
    expect(r).toEqual({ id: "plan-dur-long-work", text: "Your work tasks have been taking about 20 minutes longer than the AI estimates." });
  });

  it("reports a category that consistently wraps up faster than estimated", () => {
    const cs = [corr("errands", -10), corr("errands", -15), corr("errands", -20)];
    const r = planningPatternObservation(cs, NOW);
    expect(r).toEqual({ id: "plan-dur-short-errands", text: "Your errands tasks have been wrapping up about 15 minutes faster than the AI estimates." });
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
