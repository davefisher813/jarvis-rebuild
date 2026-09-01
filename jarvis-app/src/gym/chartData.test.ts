import { describe, expect, it } from "vitest";
import { e1rm, liftSessions, chartValue, chartLabel, prIndexes, weeklySetCounts, weeklyVolume, chartableExercises } from "./chartData";
import type { Workout, SetEntry, WorkoutExercise } from "./types";

// D9-A: one canonical per-session series, numeric and dated, that the
// chart, the correlation panels, plateau detection and goal-crossing all
// read from the same place.

let n = 0;
const set = (extra: Partial<SetEntry>): SetEntry => ({ id: `s${n++}`, ...extra });
function workout(date: string, exercises: WorkoutExercise[]): Workout {
  return { id: `w${n++}`, data: { programId: "p1", dayId: "d1", dayName: "Push", date, startedAt: 0, endedAt: 0, exercises } };
}
const bench = (date: string, sets: SetEntry[]): Workout =>
  workout(date, [{ exerciseId: "e1", name: "Bench", kind: "weight_reps", unit: "lb", sets }]);

describe("e1rm", () => {
  it("Epley, rounded", () => {
    expect(e1rm(225, 5)).toBe(263); // 225 * (1 + 5/30) = 262.5 -> 263
    expect(e1rm(100, 0)).toBe(100);
  });
});

describe("liftSessions", () => {
  it("one point per workout, the session's best working set, oldest first", () => {
    const h = [
      bench("2026-08-10", [set({ w: 185, r: 5 })]),
      bench("2026-08-03", [set({ w: 175, r: 5 }), set({ w: 180, r: 3 })]),
    ];
    const s = liftSessions(h, "Bench", "weight_reps");
    expect(s.map((x) => x.date)).toEqual(["2026-08-03", "2026-08-10"]);
    expect(s[0]!.top.w).toBe(180); // heavier top set wins the session, not the first logged
    expect(s[0]!.e1rm).toBe(e1rm(180, 3));
  });

  it("skips warmups, skipped chips, and a session with nothing scoring", () => {
    const h = [bench("2026-08-10", [set({ w: 135, r: 5, warmup: true }), set({ w: 185, r: 5, skipped: true })])];
    expect(liftSessions(h, "Bench", "weight_reps")).toEqual([]);
  });

  it("carries no e1RM for a kind e1RM does not apply to", () => {
    const h = [workout("2026-08-10", [{ exerciseId: "e1", name: "Plank", kind: "time_longer", unit: undefined, timeUnit: "sec", sets: [set({ v: 90 })] }])];
    const s = liftSessions(h, "Plank", "time_longer");
    expect(s[0]!.e1rm).toBeNull();
    expect(s[0]!.score).toBe(90);
  });
});

describe("chartValue / chartLabel", () => {
  it("charts e1RM for weight_reps, the raw score for everything else", () => {
    const h = [bench("2026-08-10", [set({ w: 185, r: 5 })])];
    const s = liftSessions(h, "Bench", "weight_reps")[0]!;
    expect(chartValue(s)).toBe(e1rm(185, 5));
    expect(chartLabel("weight_reps")).toBe("Est 1RM");
    expect(chartLabel("reps")).toBe("Best");
  });
});

describe("prIndexes", () => {
  it("marks a running best, direction-aware for lower-wins kinds", () => {
    const h = [bench("2026-08-01", [set({ w: 175, r: 5 })]), bench("2026-08-08", [set({ w: 170, r: 5 })]), bench("2026-08-15", [set({ w: 185, r: 5 })])];
    const s = liftSessions(h, "Bench", "weight_reps");
    expect(prIndexes(s, "weight_reps")).toEqual([0, 2]); // the middle session did not beat the first
  });

  it("a faster time treats a lower number as the PR", () => {
    const h = [
      workout("2026-08-01", [{ exerciseId: "e1", name: "40yd", kind: "time_faster", timeUnit: "sec", sets: [set({ v: 5.1 })] }]),
      workout("2026-08-08", [{ exerciseId: "e1", name: "40yd", kind: "time_faster", timeUnit: "sec", sets: [set({ v: 4.9 })] }]),
      workout("2026-08-15", [{ exerciseId: "e1", name: "40yd", kind: "time_faster", timeUnit: "sec", sets: [set({ v: 5.0 })] }]),
    ];
    const s = liftSessions(h, "40yd", "time_faster");
    expect(prIndexes(s, "time_faster")).toEqual([0, 1]);
  });
});

describe("weeklySetCounts", () => {
  it("buckets working sets into rolling weeks from `now`, oldest first", () => {
    const now = new Date("2026-08-31T12:00:00").getTime();
    const h = [
      bench("2026-08-31", [set({ w: 185, r: 5 }), set({ w: 185, r: 5 })]), // this week
      bench("2026-08-24", [set({ w: 180, r: 5 })]), // one week back
    ];
    const out = weeklySetCounts(h, "Bench", 4, now);
    expect(out).toEqual([0, 0, 1, 2]);
  });

  it("never counts warmup or skipped sets as working volume", () => {
    const now = new Date("2026-08-31T12:00:00").getTime();
    const h = [bench("2026-08-31", [set({ w: 45, r: 5, warmup: true }), set({ w: 185, r: 5, skipped: true }), set({ w: 185, r: 5 })])];
    expect(weeklySetCounts(h, "Bench", 1, now)).toEqual([1]);
  });
});

describe("weeklyVolume", () => {
  it("null for a kind with no volume to move", () => {
    expect(weeklyVolume([], "Plank", "time_longer")).toBeNull();
  });

  it("sums weight x reps into the same rolling weeks", () => {
    const now = new Date("2026-08-31T12:00:00").getTime();
    const h = [bench("2026-08-31", [set({ w: 185, r: 5 }), set({ w: 185, r: 5 })])];
    expect(weeklyVolume(h, "Bench", "weight_reps", 1, now)).toEqual([1850]);
  });
});

describe("chartableExercises", () => {
  it("one row per name+kind, most recently trained first", () => {
    const h = [bench("2026-08-01", [set({ w: 175, r: 5 })]), bench("2026-08-20", [set({ w: 180, r: 5 })])];
    const h2 = [...h, workout("2026-08-10", [{ exerciseId: "e2", name: "Squat", kind: "weight_reps", unit: "lb", sets: [set({ w: 225, r: 5 })] }])];
    expect(chartableExercises(h2).map((x) => x.name)).toEqual(["Bench", "Squat"]);
  });

  it("an exercise with nothing scoring never appears", () => {
    const h = [bench("2026-08-01", [set({ w: 175, r: 5, skipped: true })])];
    expect(chartableExercises(h)).toEqual([]);
  });
});
