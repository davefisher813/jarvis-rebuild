import { describe, expect, it } from "vitest";
import { meetsLiftTarget, liftMeasureState, trainingMeasureState, type LiftMeasure, type TrainingMeasure } from "./goalMeasures";
import type { Workout, SetEntry, WorkoutExercise } from "./types";

// D12-A/C: a goal with a bar to clear, not a percentage pretending to be
// more precise than "did a logged set meet or beat it".

let n = 0;
const set = (extra: Partial<SetEntry>): SetEntry => ({ id: `s${n++}`, ...extra });
function workout(date: string, exercises: WorkoutExercise[]): Workout {
  return { id: `w${n++}`, data: { programId: "p1", dayId: "d1", dayName: "Push", date, startedAt: 0, endedAt: 0, exercises } };
}
const bench = (date: string, sets: SetEntry[]): Workout =>
  workout(date, [{ exerciseId: "e1", name: "Bench", kind: "weight_reps", unit: "lb", sets }]);

describe("meetsLiftTarget", () => {
  it("weight_reps needs BOTH the weight and the rep floor", () => {
    const target = { w: 225, r: 5 };
    expect(meetsLiftTarget("weight_reps", target, { w: 225, r: 5 })).toBe(true);
    expect(meetsLiftTarget("weight_reps", target, { w: 225, r: 3 })).toBe(false); // fewer reps at the weight does not count
    expect(meetsLiftTarget("weight_reps", target, { w: 200, r: 8 })).toBe(false); // more reps at less weight does not count
    expect(meetsLiftTarget("weight_reps", target, { w: 230, r: 5 })).toBe(true); // heavier at the same reps clears it
  });

  it("a warmup or skipped set never counts, even if the numbers clear the bar", () => {
    const target = { w: 225, r: 5 };
    expect(meetsLiftTarget("weight_reps", target, { w: 300, r: 5, warmup: true })).toBe(false);
    expect(meetsLiftTarget("weight_reps", target, { w: 300, r: 5, skipped: true })).toBe(false);
  });

  it("a faster time is beaten by going LOWER", () => {
    expect(meetsLiftTarget("time_faster", { v: 5.0 }, { v: 4.9 })).toBe(true);
    expect(meetsLiftTarget("time_faster", { v: 5.0 }, { v: 5.1 })).toBe(false);
  });

  it("done has no score, so no lift goal can ever fire on it", () => {
    expect(meetsLiftTarget("done", {}, { done: true })).toBe(false);
  });

  // GYM-F-20 (2026-09-05): a target of 0 was met by any set at all for
  // height, distance and time_longer ("0 In -- hit it", 100%, celebrated on
  // the next receipt), and could never be met for time_faster. It is not a
  // target either way.
  it("a target of zero is not a target, in either direction", () => {
    expect(meetsLiftTarget("height", { v: 0 }, { v: 12 })).toBe(false);
    expect(meetsLiftTarget("distance", { v: 0 }, { v: 400 })).toBe(false);
    expect(meetsLiftTarget("time_longer", { v: 0 }, { v: 60 })).toBe(false);
    expect(meetsLiftTarget("time_faster", { v: 0 }, { v: 4.9 })).toBe(false);
    expect(meetsLiftTarget("reps", { r: 0 }, { r: 10 })).toBe(false);
    expect(meetsLiftTarget("weight_reps", { w: 0, r: 5 }, { w: 225, r: 5 })).toBe(false);
    expect(meetsLiftTarget("distance_time", { v: 400, t: 0 }, { v: 400, t: 60 })).toBe(false);
    // A real target still behaves exactly as it did.
    expect(meetsLiftTarget("height", { v: 30 }, { v: 32 })).toBe(true);
  });
});

describe("liftMeasureState", () => {
  const target: LiftMeasure = { kind: "lift", exercise: "Bench", measureKind: "weight_reps", target: { w: 225, r: 5 }, unit: "lb" };

  it("not yet met: progress is the best weight actually logged at the rep floor", () => {
    const h = [bench("2026-08-01", [set({ w: 205, r: 5 })]), bench("2026-08-08", [set({ w: 215, r: 3 })])]; // 3 reps doesn't qualify
    const st = liftMeasureState(target, h);
    expect(st.met).toBe(false);
    expect(st.done).toBe(205);
    expect(st.target).toBe(225);
    expect(st.line).toBe("205 of 225 Lb at 5+ reps");
  });

  it("met the instant one set clears it, anywhere in history", () => {
    const h = [bench("2026-08-01", [set({ w: 205, r: 5 })]), bench("2026-08-15", [set({ w: 225, r: 5 })])];
    const st = liftMeasureState(target, h);
    expect(st.met).toBe(true);
    expect(st.pct).toBe(100);
    expect(st.line).toBe("225 Lb at 5+ reps -- hit it");
  });

  it("a faster-time goal fills toward 100 as the best time drops", () => {
    const m: LiftMeasure = { kind: "lift", exercise: "40yd", measureKind: "time_faster", target: { v: 4.8 }, unit: "s" };
    const h = [workout("2026-08-01", [{ exerciseId: "e1", name: "40yd", kind: "time_faster", timeUnit: "sec", sets: [set({ v: 5.2 })] }])];
    const st = liftMeasureState(m, h);
    expect(st.met).toBe(false);
    expect(st.pct).toBeGreaterThan(0);
    expect(st.pct).toBeLessThan(100);
  });

  it("no history at all is 0 of target, not met", () => {
    const st = liftMeasureState(target, []);
    expect(st.done).toBe(0);
    expect(st.met).toBe(false);
  });

  // GYM-F-20: the goal card used to read "0 In -- hit it" at 100% for a goal
  // saved with the target untouched.
  it("a zero-target goal is never met and never full", () => {
    const m: LiftMeasure = { kind: "lift", exercise: "Vertical Jump", measureKind: "height", target: { v: 0 }, unit: "in" };
    const h = [workout("2026-08-01", [{ exerciseId: "e1", name: "Vertical Jump", kind: "height", unit: "in", sets: [set({ v: 30 })] }])];
    const st = liftMeasureState(m, h);
    expect(st.met).toBe(false);
    expect(st.pct).toBe(0);
  });
});

describe("trainingMeasureState", () => {
  it("block: counts every session logged since the stamp", () => {
    const m: TrainingMeasure = { kind: "training", per: "block", times: 3, since: "2026-08-01" };
    const h = [bench("2026-07-20", [set({ w: 100, r: 5 })]), bench("2026-08-05", [set({ w: 100, r: 5 })]), bench("2026-08-12", [set({ w: 100, r: 5 })])];
    const st = trainingMeasureState(m, h, new Date("2026-08-20").getTime());
    expect(st.done).toBe(2); // the pre-stamp session doesn't count
    expect(st.met).toBe(false);
    expect(st.line).toBe("2 of 3 This block");
  });

  it("week: only sessions inside the rolling Monday-first window", () => {
    const now = new Date("2026-08-31T12:00:00").getTime(); // a Monday
    const m: TrainingMeasure = { kind: "training", per: "week", times: 2 };
    const h = [bench("2026-08-31", [set({ w: 100, r: 5 })]), bench("2026-08-24", [set({ w: 100, r: 5 })])];
    const st = trainingMeasureState(m, h, now);
    expect(st.done).toBe(1);
  });

  it("scoped to one exercise: a session that never touched it does not count", () => {
    const m: TrainingMeasure = { kind: "training", per: "block", times: 2, since: "2026-08-01", exercise: "Squat" };
    const h = [bench("2026-08-05", [set({ w: 100, r: 5 })]), workout("2026-08-10", [{ exerciseId: "e2", name: "Squat", kind: "weight_reps", unit: "lb", sets: [set({ w: 225, r: 5 })] }])];
    const st = trainingMeasureState(m, h, new Date("2026-08-20").getTime());
    expect(st.done).toBe(1);
  });

  it("a session with nothing logged (all skipped) never counts toward either kind", () => {
    const m: TrainingMeasure = { kind: "training", per: "block", times: 1, since: "2026-08-01" };
    const h = [bench("2026-08-05", [set({ w: 100, r: 5, skipped: true })])];
    const st = trainingMeasureState(m, h, new Date("2026-08-20").getTime());
    expect(st.done).toBe(0);
  });

  // GYM-F-22 (2026-09-05): a mobility or arm-care day is all "done" kind, and
  // scoreOf("done") is null by design (there is no PR in a couch stretch).
  // countsSession reused that as "did work happen", so the day finished,
  // showed in Recent, printed "Also Did" on the receipt, and left the goal
  // reading 2 of 3.
  it("a done-only session is a session: it counts toward a training goal", () => {
    const m: TrainingMeasure = { kind: "training", per: "block", times: 3, since: "2026-08-01" };
    const h = [workout("2026-08-05", [
      { exerciseId: "e1", name: "Band Pull-Aparts", kind: "done", sets: [set({ done: true })] },
      { exerciseId: "e2", name: "Couch Stretch", kind: "done", sets: [set({ done: true })] },
    ])];
    const st = trainingMeasureState(m, h, new Date("2026-08-20").getTime());
    expect(st.done).toBe(1);
    expect(st.line).toBe("1 of 3 This block");
  });

  it("a done-only session where every chip was skipped still counts for nothing", () => {
    const m: TrainingMeasure = { kind: "training", per: "block", times: 1, since: "2026-08-01" };
    const h = [workout("2026-08-05", [
      { exerciseId: "e1", name: "Band Pull-Aparts", kind: "done", sets: [set({ skipped: true })] },
    ])];
    expect(trainingMeasureState(m, h, new Date("2026-08-20").getTime()).done).toBe(0);
  });

  it("an exercise skipped outright does not make its session count", () => {
    const m: TrainingMeasure = { kind: "training", per: "block", times: 1, since: "2026-08-01" };
    const h = [workout("2026-08-05", [
      { exerciseId: "e1", name: "Band Pull-Aparts", kind: "done", skipped: true, sets: [set({ done: true })] },
    ])];
    expect(trainingMeasureState(m, h, new Date("2026-08-20").getTime()).done).toBe(0);
  });
});
