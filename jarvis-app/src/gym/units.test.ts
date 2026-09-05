import { describe, expect, it } from "vitest";
import { toLb, inUnit, beats, setVolume, LB_PER_KG } from "./measures";
import { isPR, bestBefore, lastHeader, receiptFor } from "./prs";
import { exerciseHistory, trendLine } from "./history";
import { liftSessions, weeklyVolume, chartValue } from "./chartData";
import { liftMeasureState, meetsLiftTarget, type LiftMeasure } from "./goalMeasures";
import type { Exercise, SetEntry, Workout, WorkoutExercise } from "./types";

// GYM-F-06 (2026-09-05, fork option A). lb and kg were compared and summed as
// raw numbers. The audit ran it: a session with Bench 200 lb x 5 and Squat
// 100 kg x 5 printed "1,500 lb moved"; 105 kg x 5 was not a PR against a
// 225 lb best; the header read "Best: 225 kg x 5"; History read
// "225 lb x 5 -> 100 lb x 5"; the mixed weekly-volume bars added the two.

let n = 0;
const set = (over: Partial<SetEntry> = {}): SetEntry => ({ id: `s${n++}`, ...over });
const wo = (date: string, exercises: WorkoutExercise[]): Workout =>
  ({ id: `w${n++}`, data: { programId: "p", dayId: "d", dayName: "Day", date, startedAt: 0, endedAt: 60_000, exercises } });
const bench = (unit: string, sets: SetEntry[]): WorkoutExercise =>
  ({ exerciseId: "e1", name: "Bench", kind: "weight_reps", unit, exerciseKey: "ekBench", sets });

const benchInKg: Exercise = { id: "e1", name: "Bench", kind: "weight_reps", unit: "kg", exerciseKey: "ekBench", sets: [] };
const benchInLb: Exercise = { id: "e1", name: "Bench", kind: "weight_reps", unit: "lb", exerciseKey: "ekBench", sets: [] };

describe("the conversion itself", () => {
  it("kg becomes pounds; anything else is already pounds", () => {
    expect(toLb(100, "kg")).toBeCloseTo(220.46, 2);
    expect(toLb(225, "lb")).toBe(225);
    expect(toLb(225, undefined)).toBe(225);
  });

  it("inUnit leaves a set with no weight, and a kind with no weight, alone", () => {
    expect(inUnit("weight_reps", { r: 8 }, "lb", "kg")).toEqual({ r: 8 });
    expect(inUnit("reps", { r: 8 }, "lb", "kg")).toEqual({ r: 8 });
    expect(inUnit("weight_reps", { w: 100, r: 5 }, "kg", "kg")).toEqual({ w: 100, r: 5 });
  });

  it("beats compares across units", () => {
    expect(beats("weight_reps", { w: 105, r: 5 }, { w: 225, r: 5 }, { of: "kg", than: "lb" })).toBe(true);
    expect(beats("weight_reps", { w: 100, r: 5 }, { w: 225, r: 5 }, { of: "kg", than: "lb" })).toBe(false);
  });
});

describe("PRs and the header", () => {
  const history = [wo("2026-08-01", [bench("lb", [set({ w: 225, r: 5 })])])];

  it("105 kg x 5 IS a PR against a 225 lb best (it is 231 lb)", () => {
    expect(isPR(history, benchInKg, "weight_reps", { w: 105, r: 5 })).toBe(true);
    expect(isPR(history, benchInKg, "weight_reps", { w: 100, r: 5 })).toBe(false);
  });

  it("the best carries the unit it was logged in", () => {
    const best = bestBefore(history, benchInKg, "weight_reps")!;
    expect(best.set.w).toBe(225);
    expect(best.unit).toBe("lb");
  });

  it("the header speaks the lift's CURRENT unit, never last session's number under this session's label", () => {
    const h = [...history, wo("2026-08-08", [bench("kg", [set({ w: 100, r: 5 })])])];
    const head = lastHeader(h, benchInKg, "weight_reps")!;
    expect(head.last).toBe("100 kg × 5");
    expect(head.best).toBe("102.1 kg × 5"); // the 225 lb best, in kg
  });
});

describe("the receipt's volume tile", () => {
  it("a mixed session totals what actually moved, in one unit", () => {
    const exercises: WorkoutExercise[] = [
      bench("lb", [set({ w: 200, r: 5 })]),
      { exerciseId: "e2", name: "Squat", kind: "weight_reps", unit: "kg", sets: [set({ w: 100, r: 5 })] },
    ];
    const r = receiptFor(exercises, [], 0, 60_000);
    expect(r.volumeUnit).toBe("lb");
    // 200x5 = 1000 lb, plus 100 kg x 5 = 1102 lb. It used to print 1500.
    expect(r.volume).toBe(1000 + Math.round(setVolume("weight_reps", { w: 100, r: 5 }, "kg")));
    expect(r.volume).toBeGreaterThan(2000);
  });

  it("a kg-first session totals in kg", () => {
    const exercises: WorkoutExercise[] = [
      { exerciseId: "e2", name: "Squat", kind: "weight_reps", unit: "kg", sets: [set({ w: 100, r: 5 })] },
      bench("lb", [set({ w: 220.46, r: 5 })]),
    ];
    const r = receiptFor(exercises, [], 0, 60_000);
    expect(r.volumeUnit).toBe("kg");
    expect(r.volume).toBe(1000); // 500 kg logged plus 500 kg worth of pounds
  });
});

describe("History", () => {
  it("the trend arrow does not read as a collapse when a lift moves to kg", () => {
    const h = [
      wo("2026-08-01", [bench("lb", [set({ w: 225, r: 5 })])]),
      wo("2026-08-15", [bench("kg", [set({ w: 100, r: 5 })])]),
    ];
    const row = exerciseHistory(h)[0]!;
    expect(row.unit).toBe("kg");
    // It used to print "225 lb × 5 → 100 lb × 5".
    expect(trendLine(row)).toBe("102.1 kg × 5 → 100 kg × 5 over 2 weeks");
    // and the best is still the heavier one, whichever unit it was logged in
    expect(row.best.set.w).toBe(225);
    expect(row.best.unit).toBe("lb");
  });
});

describe("the chart", () => {
  it("plots one continuous line across a unit change", () => {
    const h = [
      wo("2026-08-01", [bench("lb", [set({ w: 225, r: 5 })])]),
      wo("2026-08-08", [bench("kg", [set({ w: 105, r: 5 })])]),
    ];
    const rows = liftSessions(h, benchInKg, "weight_reps");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.unit).toBe("lb");
    expect(rows[1]!.unit).toBe("kg");
    // 105 kg is 231 lb: the line goes UP, where it used to plunge.
    expect(chartValue(rows[1]!)).toBeGreaterThan(chartValue(rows[0]!));
  });

  it("weekly volume bars sum in one unit", () => {
    const now = new Date("2026-08-10T12:00:00").getTime();
    const h = [wo("2026-08-08", [bench("kg", [set({ w: 100, r: 5 })])])];
    const inLb = weeklyVolume(h, benchInLb, "weight_reps", 1, now)!;
    const inKg = weeklyVolume(h, benchInKg, "weight_reps", 1, now)!;
    expect(inKg[0]).toBe(500);
    expect(inLb[0]).toBe(Math.round(500 * LB_PER_KG));
  });
});

describe("a lift goal", () => {
  it("a kg set clears an lb target when it really is heavier", () => {
    expect(meetsLiftTarget("weight_reps", { w: 225, r: 5 }, { w: 105, r: 5 }, { target: "lb", set: "kg" })).toBe(true);
    expect(meetsLiftTarget("weight_reps", { w: 225, r: 5 }, { w: 100, r: 5 }, { target: "lb", set: "kg" })).toBe(false);
  });

  it("progress toward an lb goal counts kg sessions, and reports in the goal's unit", () => {
    const m: LiftMeasure = { kind: "lift", exercise: "Bench", exerciseKey: "ekBench", measureKind: "weight_reps", target: { w: 250, r: 5 }, unit: "lb" };
    const h = [wo("2026-08-08", [bench("kg", [set({ w: 100, r: 5 })])])];
    const st = liftMeasureState(m, h);
    expect(st.met).toBe(false);
    expect(st.done).toBe(Math.round(100 * LB_PER_KG * 10) / 10);
  });
});
