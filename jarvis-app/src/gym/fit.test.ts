import { describe, expect, it } from "vitest";
import { estimateDay, estimateDaySec, trimTargets, pairsIn, leverOffers, projectFinishMs, overBudgetMin, nextLever, type FitPlan } from "./fit";
import { DEFAULT_PLATES, DEFAULT_BAR, type RackConfig } from "./ramp";
import type { ProgramDay, Exercise, SetEntry, Workout, WorkoutExercise } from "./types";

// D5-C: fit is ordered visible levers, priced honestly, applied only by the
// athlete's own tap. These tests pin the arithmetic and the guardrails --
// above all that the main lift is never the thing the engine sacrifices.

const rack: RackConfig = { bar: DEFAULT_BAR, plates: [...DEFAULT_PLATES] };
let n = 0;
const sets = (c: number, w = 100): SetEntry[] => Array.from({ length: c }, () => ({ id: `s${n++}`, w, r: 5 }));
const ex = (name: string, c: number, extra: Partial<Exercise> = {}): Exercise =>
  ({ id: name, name, kind: "weight_reps", unit: "lb", sets: sets(c), ...extra });
const day = (exercises: Exercise[], extra: Partial<ProgramDay> = {}): ProgramDay =>
  ({ id: "d1", name: "Pull", exercises, ...extra });

describe("estimateDay", () => {
  it("prices unlearned lifts at work + stated rest, and says how many were learned", () => {
    const d = day([ex("Bench", 3, { restSec: 90 }), ex("Rows", 3)]); // 3*(130) + 3*(100)
    expect(estimateDaySec(d, [], rack)).toBe(3 * 130 + 3 * 100);
    const e = estimateDay(d, [], rack);
    expect(e.min).toBe(Math.round((390 + 300) / 60));
    expect(e.learnedCount).toBe(0);
    expect(e.liftCount).toBe(2);
  });

  it("an empty day estimates 0, not a floor: empty is legal", () => {
    expect(estimateDay(day([]), [], rack).min).toBe(0);
  });

  it("fillers cost nothing: their sets ride inside the partner's rest", () => {
    const d = day([ex("Bench", 3), ex("Band Pull-Apart", 3, { filler: true })]);
    expect(estimateDaySec(d, [], rack)).toBe(3 * 100);
  });

  it("blocks cost their stated minutes only; no minutes, no invented number", () => {
    const withMin = day([ex("Bench", 1)], { warmUp: [{ id: "b1", name: "Bike" }], warmUpMin: 8, coolDown: [{ id: "b2", name: "Stretch" }], coolDownMin: 5 });
    expect(estimateDaySec(withMin, [], rack)).toBe(100 + 8 * 60 + 5 * 60);
    const noMin = day([ex("Bench", 1)], { warmUp: [{ id: "b1", name: "Bike" }] });
    expect(estimateDaySec(noMin, [], rack)).toBe(100);
  });

  it("a ramp adds its derived warm-up sets at the stated per-set default", () => {
    const d = day([ex("Bench", 3, { ramp: true, sets: sets(3, 225) })]);
    const base = day([ex("Bench", 3, { sets: sets(3, 225) })]);
    const diff = estimateDaySec(d, [], rack) - estimateDaySec(base, [], rack);
    expect(diff % 60).toBe(0);
    expect(diff).toBeGreaterThan(0);
  });

  it("restCut shortens toward the floor and never below it", () => {
    const d = day([ex("Bench", 2, { restSec: 90 }), ex("Curls", 2, { restSec: 50 })]);
    // 90 -> 60, 50 -> 45 (floor), never 20.
    expect(estimateDaySec(d, [], rack, { restCut: true })).toBe(2 * (40 + 60) + 2 * (40 + 45));
  });

  it("a rest nobody stated is never cut: a lever wired to nothing is a lie", () => {
    const d = day([ex("Bench", 2)]); // no restSec, no timer to shorten
    expect(estimateDaySec(d, [], rack, { restCut: true })).toBe(estimateDaySec(d, [], rack));
    expect(leverOffers(d, [], rack, {}).some((o) => o.key === "restCut")).toBe(false);
  });

  it("superset shares one rest per round across a symmetric pair", () => {
    const a = ex("Rows", 3, { pairWith: "Curls", restSec: 60 });
    const b = ex("Curls", 3, { pairWith: "Rows", restSec: 90 });
    const d = day([ex("Bench", 3), a, b]);
    const base = estimateDaySec(d, [], rack);
    expect(estimateDaySec(d, [], rack, { superset: true })).toBe(base - 3 * 60);
  });
});

describe("trimTargets", () => {
  it("never the main lift, never pairs, never fillers, never under three sets", () => {
    const d = day([
      ex("Bench", 5), // main: first in the day
      ex("Rows", 3, { pairWith: "Curls" }),
      ex("Curls", 3, { pairWith: "Rows" }),
      ex("Face Pull", 2), // too few
      ex("Band Work", 4, { filler: true }),
      ex("Lat Raise", 3), // the one honest target
    ]);
    expect(trimTargets(d)).toEqual({ "Lat Raise": 1 });
  });
});

describe("leverOffers", () => {
  it("offers in catalog order with real names and marginal saves", () => {
    const d = day([
      ex("Bench", 3, { restSec: 90 }),
      ex("Rows", 3, { pairWith: "Curls", restSec: 90 }),
      ex("Curls", 3, { pairWith: "Rows", restSec: 90 }),
      ex("Lat Raise", 3, { restSec: 90 }),
    ], { coolDown: [{ id: "c1", name: "Stretch" }], coolDownMin: 5 });
    const offers = leverOffers(d, [], rack, {});
    expect(offers.map((o) => o.key)).toEqual(["restCut", "superset", "trim", "skipCool"]);
    expect(offers[0]!.name).toBe("Rests 90 → 60s");
    expect(offers[1]!.name).toBe("Superset Rows + Curls");
    expect(offers[2]!.name).toBe("Lat Raise 3 → 2 sets");
    expect(offers[2]!.sub).toContain("never your main lift");
    expect(offers[3]!.sub).toBe("saves 5 min");
    // restCut: 12 sets x 30s = 6 min.
    expect(offers[0]!.saveMin).toBe(6);
  });

  it("levers a day does not have are not offered", () => {
    const d = day([ex("Bench", 2, { restSec: 45 })]); // rest already at floor, nothing else
    expect(leverOffers(d, [], rack, {})).toEqual([]);
  });
});

const liveEx = (id: string, logged: number, extra: Partial<WorkoutExercise> = {}): WorkoutExercise =>
  ({ exerciseId: id, name: id, kind: "weight_reps", unit: "lb", sets: sets(logged), ...extra });

describe("projectFinishMs / overBudgetMin", () => {
  const h: Workout[] = [];
  it("prices only what is left, and drops the cool-down when skipped", () => {
    const d = day([ex("Bench", 3), ex("Rows", 3)], { coolDown: [{ id: "c1", name: "Stretch" }], coolDownMin: 5 });
    const live = { startedAt: 0, exercises: [liveEx("Bench", 2), liveEx("Rows", 0)] };
    const now = 1_000_000;
    // 1 bench + 3 rows = 4 x 100s + cool 300s.
    expect(projectFinishMs(live, d, h, rack, now)).toBe(now + (4 * 100 + 300) * 1000);
    expect(projectFinishMs({ ...live, skipCool: true }, d, h, rack, now)).toBe(now + 4 * 100 * 1000);
  });

  it("counts the warm-up only before the first logged set", () => {
    const d = day([ex("Bench", 2)], { warmUp: [{ id: "w1", name: "Bike" }], warmUpMin: 8 });
    const fresh = { startedAt: 0, exercises: [liveEx("Bench", 0)] };
    const going = { startedAt: 0, exercises: [liveEx("Bench", 1)] };
    expect(projectFinishMs(fresh, d, h, rack, 0)).toBe((2 * 100 + 8 * 60) * 1000);
    expect(projectFinishMs(going, d, h, rack, 0)).toBe(1 * 100 * 1000);
  });

  it("a trim shrinks the remaining plan", () => {
    const d = day([ex("Bench", 3), ex("Curls", 3)]);
    const live = { startedAt: 0, exercises: [liveEx("Bench", 3), liveEx("Curls", 0)], trims: { Curls: 1 } };
    expect(projectFinishMs(live, d, h, rack, 0)).toBe(2 * 100 * 1000);
  });

  it("no budget, no opinion; a budget prices the overrun in whole minutes", () => {
    const d = day([ex("Bench", 3)]);
    const live = { startedAt: 0, exercises: [liveEx("Bench", 0)] };
    expect(overBudgetMin(live, d, h, rack, 0)).toBeNull();
    // 300s of work, budget 2 min from start at t=0 -> 3 min over.
    expect(overBudgetMin({ ...live, budgetMin: 2 }, d, h, rack, 0)).toBe(3);
    expect(overBudgetMin({ ...live, budgetMin: 60 }, d, h, rack, 0)).toBeLessThanOrEqual(0);
  });
});

describe("nextLever", () => {
  const h: Workout[] = [];
  it("offers rests first, then the last trimmable accessory, then the cool-down", () => {
    const d = day([ex("Bench", 3, { restSec: 90 }), ex("Rows", 3, { restSec: 90 }), ex("Curls", 3, { restSec: 90 })],
      { coolDown: [{ id: "c1", name: "Stretch" }], coolDownMin: 5 });
    const live = { startedAt: 0, exercises: [liveEx("Bench", 0), liveEx("Rows", 0), liveEx("Curls", 0)] };
    expect(nextLever(live, d, h)).toEqual({ key: "restCut" });
    expect(nextLever({ ...live, restCut: true }, d, h)).toEqual({ key: "trim", exerciseId: "Curls", name: "Curls" });
    expect(nextLever({ ...live, restCut: true, trims: { Curls: 1, Rows: 1 } }, d, h)).toEqual({ key: "skipCool" });
    expect(nextLever({ ...live, restCut: true, trims: { Curls: 1, Rows: 1 }, skipCool: true }, d, h)).toBeNull();
  });

  it("never offers to trim the main lift even when it is all that is left", () => {
    const d = day([ex("Bench", 5, { restSec: 45 })]);
    const live = { startedAt: 0, exercises: [liveEx("Bench", 0)], restCut: true };
    expect(nextLever(live, d, h)).toBeNull();
  });

  it("does not offer a trim whose last set already happened", () => {
    const d = day([ex("Bench", 3, { restSec: 45 }), ex("Curls", 3, { restSec: 45 })]);
    const live = { startedAt: 0, exercises: [liveEx("Bench", 0), liveEx("Curls", 3)], restCut: true };
    expect(nextLever(live, d, h)).toBeNull();
  });
});
