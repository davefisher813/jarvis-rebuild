import { describe, expect, it } from "vitest";
import { metricMeasureState, type MetricMeasure } from "./metricGoals";
import type { MetricLog } from "./metrics";

// Health Push, Dave's ask 2026-09-12: a goal on a reading, same rigor as
// D12-A/C's goal on the bar -- a state derived from the actual logs, never a
// percentage invented from nothing.

let n = 0;
const log = (metricId: string, date: string, value: number): MetricLog => ({ id: `l${n++}`, data: { metricId, date, value, at: 0 } });

const weightGoal = (over: Partial<MetricMeasure> = {}): MetricMeasure => ({
  kind: "metric", metricId: "m1", metricName: "Bodyweight", unit: "lb", direction: "down", target: 170, ...over,
});

describe("metricMeasureState", () => {
  it("with nothing logged, names the target and claims no progress", () => {
    const s = metricMeasureState(weightGoal(), []);
    expect(s).toEqual({ done: 0, target: 170, met: false, pct: 0, line: expect.stringContaining("170") });
    expect(s.line.toLowerCase()).toContain("log bodyweight");
  });

  it("ignores another metric's logs entirely", () => {
    const s = metricMeasureState(weightGoal(), [log("other", "2026-09-01", 500)]);
    expect(s.done).toBe(0);
  });

  it("reads the LATEST log, not the first or the biggest", () => {
    const logs = [log("m1", "2026-09-01", 190), log("m1", "2026-09-10", 182), log("m1", "2026-09-05", 300)];
    const s = metricMeasureState(weightGoal(), logs);
    expect(s.done).toBe(182);
  });

  describe("direction: down (losing weight)", () => {
    it("is met once the reading falls to or below the target", () => {
      expect(metricMeasureState(weightGoal(), [log("m1", "2026-09-10", 170)]).met).toBe(true);
      expect(metricMeasureState(weightGoal(), [log("m1", "2026-09-10", 165)]).met).toBe(true);
      expect(metricMeasureState(weightGoal(), [log("m1", "2026-09-10", 171)]).met).toBe(false);
    });

    it("with a baseline, pct is the share of the drop already covered", () => {
      // 190 -> 170 is a 20 lb goal; sitting at 180 is 10 of 20, or 50%.
      const g = weightGoal({ startValue: 190 });
      const s = metricMeasureState(g, [log("m1", "2026-09-10", 180)]);
      expect(s.pct).toBe(50);
      expect(s.met).toBe(false);
    });

    it("never reports over 100% for overshooting the target", () => {
      const g = weightGoal({ startValue: 190 });
      const s = metricMeasureState(g, [log("m1", "2026-09-10", 160)]);
      expect(s.pct).toBe(100);
      expect(s.met).toBe(true);
    });

    it("never reports a negative pct for moving the wrong way", () => {
      const g = weightGoal({ startValue: 190 });
      const s = metricMeasureState(g, [log("m1", "2026-09-10", 195)]);
      expect(s.pct).toBe(0);
      expect(s.met).toBe(false);
    });
  });

  describe("direction: up (a number climbing toward a target)", () => {
    const up = (over: Partial<MetricMeasure> = {}): MetricMeasure => weightGoal({ direction: "up", target: 20, unit: "reps", ...over });

    it("is met once the reading reaches or passes the target", () => {
      expect(metricMeasureState(up(), [log("m1", "2026-09-10", 20)]).met).toBe(true);
      expect(metricMeasureState(up(), [log("m1", "2026-09-10", 25)]).met).toBe(true);
      expect(metricMeasureState(up(), [log("m1", "2026-09-10", 19)]).met).toBe(false);
    });

    it("with a baseline, pct is the share of the climb already made", () => {
      // 8 -> 20 is a 12-rep climb; sitting at 14 is 6 of 12, or 50%.
      const g = up({ startValue: 8 });
      const s = metricMeasureState(g, [log("m1", "2026-09-10", 14)]);
      expect(s.pct).toBe(50);
    });
  });

  it("with no baseline (goal set after the fact), states the reading against the target without a fabricated percentage", () => {
    // weightGoal() carries no startValue by default -- this is that case.
    const s = metricMeasureState(weightGoal(), [log("m1", "2026-09-10", 175)]);
    expect(s.pct === 0 || s.pct === 100).toBe(true);
    expect(s.line).toContain("175");
    expect(s.line).toContain("170");
  });

  it("a baseline already past the target (direction changed since) still reports honestly rather than dividing by a non-positive span", () => {
    // Losing weight, but the goal was set with a start already below target.
    const g = weightGoal({ startValue: 165 }); // target 170, direction down
    const s = metricMeasureState(g, [log("m1", "2026-09-10", 168)]);
    expect(Number.isFinite(s.pct)).toBe(true);
    expect(s.pct).toBeGreaterThanOrEqual(0);
    expect(s.pct).toBeLessThanOrEqual(100);
  });
});
