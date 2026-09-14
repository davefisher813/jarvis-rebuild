import { describe, it, expect } from "vitest";
import { periodFor, previousPeriod, workingSetsOf, isCompletedWorkout, durationOf, periodOverview, sleepNights, hoursLabel, SUSPECT_ACTIVE_MIN } from "./analytics";
import type { Workout } from "../gym/types";
import type { MetricDef, MetricLog } from "../gym/metrics";

// The approved Health design (2026-09-14), item 10: one set of definitions.
const T = (iso: string, h: number, m = 0) => new Date(`${iso}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`).getTime();
const w = (id: string, date: string, startedAt: number, endedAt: number, sets: { w?: number; r?: number; warmup?: boolean; skipped?: boolean; drop?: boolean; at?: number }[], pausedMs?: number): Workout =>
  ({ id, data: { programId: "p", dayId: "d", dayName: "Push", date, startedAt, endedAt, ...(pausedMs ? { pausedMs } : {}), exercises: [{ exerciseId: "e", name: "Bench", kind: "weight_reps", unit: "lb", sets: sets.map((s, i) => ({ id: "s" + i, ...s })) }] } }) as Workout;

describe("periods", () => {
  it("ends today, inclusive, and the previous period sits right before it", () => {
    const p = periodFor("7d", "2026-09-14");
    expect(p).toEqual({ key: "7d", from: "2026-09-08", to: "2026-09-14", days: 7 });
    expect(previousPeriod(p)).toEqual({ key: "7d", from: "2026-09-01", to: "2026-09-07", days: 7 });
    expect(periodFor("28d", "2026-09-14").from).toBe("2026-08-18");
    expect(periodFor("custom", "2026-09-14", { from: "2026-09-01", to: "2026-09-10" })).toEqual({ key: "custom", from: "2026-09-01", to: "2026-09-10", days: 10 });
    expect(periodFor("custom", "2026-09-14", { from: "2026-09-10", to: "2026-09-01" }).key).toBe("7d");
  });
});

describe("working sets and completed workouts", () => {
  it("counts scoring sets that are not warm-ups, drops or skips; a session with none is not a workout", () => {
    const a = w("a", "2026-09-10", T("2026-09-10", 18), T("2026-09-10", 19), [{ w: 95, r: 8, warmup: true }, { w: 135, r: 5 }, { w: 135, r: 5, skipped: true }, { w: 95, r: 8, drop: true }, { w: 135, r: 4 }]);
    expect(workingSetsOf(a.data)).toBe(2);
    expect(isCompletedWorkout(a.data)).toBe(true);
    const b = w("b", "2026-09-11", T("2026-09-11", 18), T("2026-09-11", 19), [{ w: 95, r: 8, warmup: true }]);
    expect(isCompletedWorkout(b.data)).toBe(false);
  });
});

describe("duration", () => {
  it("reads elapsed, active and the set span, and flags a session left running", () => {
    const start = T("2026-09-12", 18, 45);
    const ok = w("ok", "2026-09-12", start, start + 50 * 60000, [{ w: 135, r: 5, at: start + 5 * 60000 }, { w: 135, r: 5, at: start + 40 * 60000 }], 5 * 60000);
    expect(durationOf(ok.data)).toMatchObject({ elapsedMin: 50, activeMin: 45, pausedMin: 5, setSpanMin: 35, flagged: false });
    const left = w("left", "2026-09-12", start, start + 627 * 60000, [{ w: 135, r: 5, at: start + 5 * 60000 }, { w: 135, r: 5, at: start + 40 * 60000 }]);
    const d = durationOf(left.data);
    expect(d.activeMin).toBe(627);
    expect(d.activeMin).toBeGreaterThan(SUSPECT_ACTIVE_MIN);
    expect(d.flagged).toBe(true);
    // Nothing is capped: the number is the number until the person corrects it.
    expect(d.elapsedMin).toBe(627);
  });
  it("has no set span without stamps, and does not flag a plain long session under the threshold", () => {
    const start = T("2026-09-12", 18);
    const d = durationOf(w("x", "2026-09-12", start, start + 90 * 60000, [{ w: 135, r: 5 }]).data);
    expect(d.setSpanMin).toBeNull();
    expect(d.flagged).toBe(false);
  });
});

describe("periodOverview and sleep", () => {
  const def: MetricDef = { id: "m1", data: { name: "Sleep", type: "number", unit: "hrs", presetKey: "sleep", createdOn: "2026-09-01" } };
  const log = (date: string, value: number): MetricLog => ({ id: date, data: { metricId: "m1", date, value, at: 1 } });
  it("sums the period, keeps a night not logged as null, and never invents a zero", () => {
    const p = periodFor("7d", "2026-09-14");
    const ws = [
      w("a", "2026-09-09", T("2026-09-09", 18), T("2026-09-09", 19), [{ w: 135, r: 5 }, { w: 135, r: 5 }]),
      w("b", "2026-09-12", T("2026-09-12", 18), T("2026-09-12", 18, 40), [{ w: 135, r: 5 }]),
      w("old", "2026-09-01", T("2026-09-01", 18), T("2026-09-01", 19), [{ w: 135, r: 5 }]),
      w("empty", "2026-09-13", T("2026-09-13", 18), T("2026-09-13", 19), [{ w: 95, r: 8, warmup: true }]),
    ];
    const o = periodOverview(ws, def, [log("2026-09-09", 7.5), log("2026-09-10", 8), log("2026-09-01", 6)], p);
    expect(o.workouts).toBe(2);
    expect(o.workingSets).toBe(3);
    expect(o.trainingMin).toBe(100);
    expect(o.days.map((d) => d.workouts)).toEqual([0, 1, 0, 0, 1, 0, 0]);
    expect(o.sleep).toMatchObject({ avgHours: 7.75, nights: 2 });
    expect(o.sleep.byDay.find((d) => d.date === "2026-09-11")!.hours).toBeNull();
    expect(o.flagged).toEqual([]);
  });
  it("sleep with no nights is null, not zero", () => {
    expect(sleepNights(def, [], periodFor("7d", "2026-09-14")).avgHours).toBeNull();
    expect(sleepNights(null, [], periodFor("7d", "2026-09-14")).nights).toBe(0);
  });
  it("labels hours", () => {
    expect(hoursLabel(7.4)).toBe("7h 24m");
    expect(hoursLabel(8)).toBe("8h");
    expect(hoursLabel(0.5)).toBe("30m");
  });
});
