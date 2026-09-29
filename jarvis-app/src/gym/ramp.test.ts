import { describe, it, expect } from "vitest";
import { rampFor, nextRampStep, startsInWarmUp, warmupSeed, DEFAULT_PLATES, DEFAULT_BAR } from "./ramp";
import type { Exercise } from "./types";

const ex = (over: Partial<Exercise> = {}): Exercise => ({
  id: "e1", name: "Bench", kind: "weight_reps", unit: "lb",
  sets: [{ id: "s1", w: 225, r: 5 }, { id: "s2", w: 225, r: 5 }], ...over,
});

// THE RAMP, D3-A. Reverse pyramid off the athlete's own first working
// weight, rounded to plates that exist, and never a prescription: every set
// is editable and one tap logs it.
describe("rampFor", () => {
  it("builds bar, then a light, medium and heavy approach", () => {
    const r = rampFor(ex(), { bar: 45, plates: DEFAULT_PLATES });
    // 40 / 60 / 85 percent of 225, each floored to a weight the rack can build.
    expect(r.map((s) => `${s.w}x${s.r}`)).toEqual(["45x10", "90x8", "135x5", "190x3"]);
  });

  it("marks every ramp set as a warm-up, so nothing downstream counts it", () => {
    for (const s of rampFor(ex(), { bar: 45, plates: DEFAULT_PLATES })) expect(s.warmup).toBe(true);
  });

  it("rounds to weights the rack can actually make", () => {
    for (const s of rampFor(ex({ sets: [{ id: "s1", w: 187, r: 5 }] }), { bar: 45, plates: DEFAULT_PLATES })) {
      expect((s.w! - 45) % 5).toBe(0);
    }
  });

  it("never offers a step at or above the working weight, or under the bar", () => {
    const r = rampFor(ex({ sets: [{ id: "s1", w: 95, r: 5 }] }), { bar: 45, plates: DEFAULT_PLATES });
    expect(r.length).toBeGreaterThan(0);
    for (const s of r) { expect(s.w!).toBeLessThan(95); expect(s.w!).toBeGreaterThanOrEqual(45); }
  });

  it("a working weight at or under the bar has nothing to ramp", () => {
    expect(rampFor(ex({ sets: [{ id: "s1", w: 45, r: 5 }] }), { bar: 45, plates: DEFAULT_PLATES })).toEqual([]);
  });

  it("kinds with no weight get no ramp at all, rather than a fake one", () => {
    expect(rampFor(ex({ kind: "reps", sets: [{ id: "s1", r: 12 }] }), { bar: 45, plates: DEFAULT_PLATES })).toEqual([]);
    expect(rampFor(ex({ kind: "time_faster", sets: [{ id: "s1", v: 4.6 }] }), { bar: 45, plates: DEFAULT_PLATES })).toEqual([]);
  });

  it("an empty strip is legal and ramps to nothing", () => {
    expect(rampFor(ex({ sets: [{ id: "s1" }] }), { bar: 45, plates: DEFAULT_PLATES })).toEqual([]);
  });

  it("reads the first WORKING weight, skipping a leading skipped chip", () => {
    const r = rampFor(ex({ sets: [{ id: "s0", skipped: true, w: 500 }, { id: "s1", w: 225, r: 5 }] }), { bar: 45, plates: DEFAULT_PLATES });
    expect(r[r.length - 1]!.w).toBe(190);
  });

  // GYM-F-19 (2026-09-05): the rack now says which unit its own numbers are
  // in. A kg rack that says so behaves exactly as this always meant to.
  it("kg lifters ramp on a kg bar, not a rounded pound one", () => {
    const r = rampFor(ex({ unit: "kg", sets: [{ id: "s1", w: 100, r: 5 }] }), { bar: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25], unit: "kg" });
    expect(r[0]!.w).toBe(20);
    for (const s of r) expect(s.w!).toBeLessThan(100);
  });

  it("a kg lift on the default POUND rack ramps on that bar's real weight in kg, never on 45", () => {
    // The audit's own case: rampFor on a 60 kg squat used to hand back
    // "45 kg x 10 · 50 kg x 3" -- the 45 is the lb bar, relabelled.
    const r = rampFor(ex({ unit: "kg", sets: [{ id: "s1", w: 60, r: 5 }] }), { bar: 45, plates: DEFAULT_PLATES, unit: "lb" });
    expect(r[0]!.w).toBeCloseTo(20.41, 1); // a 45 lb bar, in kg
    expect(r.every((s) => s.w! < 60)).toBe(true);
    expect(r.some((s) => s.w === 45)).toBe(false);
  });

  it("an lb lift on a kg rack is converted the other way too", () => {
    const r = rampFor(ex({ unit: "lb", sets: [{ id: "s1", w: 225, r: 5 }] }), { bar: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25], unit: "kg" });
    expect(r[0]!.w).toBeCloseTo(44.09, 1); // a 20 kg bar, in lb
  });

  // GYM-F-19: the plate line speaks the RACK's own plates, because those are
  // the discs the athlete picks up, and converts the chip's weight into the
  // rack's unit to work out which ones.
  it("plateLine converts a kg chip onto a pound rack, and back", async () => {
    const { plateLine } = await import("./ramp");
    const lbRack = { bar: 45, plates: DEFAULT_PLATES, unit: "lb" };
    expect(plateLine(225, lbRack, "lb")).toBe("45 · 45");
    expect(plateLine(102.06, lbRack, "kg")).toBe("45 · 45"); // 225 lb, in kg
    const kgRack = { bar: 20, plates: [25, 20, 15, 10, 5, 2.5], unit: "kg" };
    expect(plateLine(80, kgRack, "kg")).toBe("25 · 5");
    expect(plateLine(176.37, kgRack, "lb")).toBe("25 · 5"); // 80 kg, in pounds
  });

  it("every set carries its own id, so the strip can edit one without the rest", () => {
    const r = rampFor(ex(), { bar: 45, plates: DEFAULT_PLATES });
    expect(new Set(r.map((s) => s.id)).size).toBe(r.length);
  });
});

describe("platesPerSide", () => {
  it("names the plates, heaviest first", async () => {
    const { platesPerSide } = await import("./ramp");
    expect(platesPerSide(225, 45, DEFAULT_PLATES)).toEqual([45, 45]);
    expect(platesPerSide(135, 45, DEFAULT_PLATES)).toEqual([45]);
    expect(platesPerSide(100, 45, DEFAULT_PLATES)).toEqual([25, 2.5]);
  });

  it("says nothing rather than lying when the rack cannot make it", async () => {
    const { platesPerSide } = await import("./ramp");
    expect(platesPerSide(46, 45, DEFAULT_PLATES)).toBeNull();
    expect(platesPerSide(45, 45, DEFAULT_PLATES)).toBeNull();
    expect(platesPerSide(30, 45, DEFAULT_PLATES)).toBeNull();
  });

  it("honours the athlete's own bar and rack", async () => {
    const { platesPerSide } = await import("./ramp");
    expect(platesPerSide(80, 20, [25, 20, 15, 10, 5, 2.5])).toEqual([25, 5]);
    expect(platesPerSide(225, 45, [45])).toEqual([45, 45]);
    expect(platesPerSide(235, 45, [45])).toBeNull();
  });
});

// THE RAMP AS A SUGGESTION (2026-09-29). It feeds the Now card's Warm-Up side
// and is read against what was LIFTED, never against how many warm-ups exist.
describe("nextRampStep", () => {
  const ramp = rampFor(ex(), { bar: 45, plates: DEFAULT_PLATES }); // 45, 90, 135, 190
  const w = (weight: number, over = {}) => ({ w: weight, warmup: true, ...over });

  it("is the first step when nothing has been warmed up", () => {
    expect(nextRampStep(ramp, [])!.w).toBe(45);
  });

  it("is the first step strictly above the heaviest warm-up logged", () => {
    expect(nextRampStep(ramp, [w(45)])!.w).toBe(90);
    expect(nextRampStep(ramp, [w(100)])!.w).toBe(135);
    expect(nextRampStep(ramp, [w(90)])!.w).toBe(135); // equal is passed, not repeated
  });

  it("does not care how many warm-ups there are or in what order: 180 then 270 passes the whole ramp", () => {
    expect(nextRampStep(ramp, [w(270), w(180)])).toBeNull();
    // ...whereas counting them would have offered the 3rd and 4th steps.
    expect(nextRampStep(ramp, [w(100), w(120)])!.w).toBe(135);
  });

  it("ignores working sets and weightless warm-ups", () => {
    expect(nextRampStep(ramp, [{ w: 225, warmup: false }, { warmup: true }])!.w).toBe(45);
  });

  it("is null for a lift with the ramp off or nothing to ramp", () => {
    expect(nextRampStep([], [])).toBeNull();
  });
});

describe("startsInWarmUp", () => {
  const ramp = rampFor(ex(), { bar: 45, plates: DEFAULT_PLATES });
  it("is true before any working set while a step remains", () => {
    expect(startsInWarmUp(ramp, [])).toBe(true);
    expect(startsInWarmUp(ramp, [{ w: 45, warmup: true }])).toBe(true);
  });
  it("is false once a working set has been logged, however many steps remain", () => {
    expect(startsInWarmUp(ramp, [{ w: 225 }])).toBe(false);
    expect(startsInWarmUp(ramp, [{ w: 45, warmup: true }, { w: 225 }])).toBe(false);
  });
  it("is false when the ramp is exhausted or off", () => {
    expect(startsInWarmUp(ramp, [{ w: 200, warmup: true }])).toBe(false);
    expect(startsInWarmUp([], [])).toBe(false);
  });
  it("a drop is not a working set", () => {
    expect(startsInWarmUp(ramp, [{ w: 200, drop: true }])).toBe(true);
  });
});

describe("warmupSeed", () => {
  const rack = { bar: DEFAULT_BAR, plates: DEFAULT_PLATES };
  const ramp = rampFor(ex(), rack);
  const base = { ramp: [], logged: [], work: 225 as number | null, hasBar: true, rack, unit: "lb", step: 5 };

  it("is the next ramp step, weight and reps", () => {
    expect(warmupSeed({ ...base, ramp })).toEqual({ w: 45, r: 10 });
    expect(warmupSeed({ ...base, ramp, logged: [{ w: 100, r: 8, warmup: true }] })).toEqual({ w: 135, r: 5 });
  });

  it("repeats the last warm-up when the ramp is used up, for one tap to change", () => {
    expect(warmupSeed({ ...base, ramp, logged: [{ w: 180, r: 8, warmup: true }, { w: 270, r: 6, warmup: true }] })).toEqual({ w: 270, r: 6 });
  });

  it("with no ramp, is half the working weight floored to the rack, never under the bar", () => {
    expect(warmupSeed(base)).toEqual({ w: 110, r: 8 });
    expect(warmupSeed({ ...base, work: 65 })).toEqual({ w: 45, r: 8 });
  });

  it("with no working weight at all on a barbell, is the bar", () => {
    expect(warmupSeed({ ...base, work: null })).toEqual({ w: 45, r: 8 });
  });

  it("on a lift with no bar, is half the weight on the field's own step, or just reps when nothing says", () => {
    expect(warmupSeed({ ...base, hasBar: false, work: 50, step: 5 })).toEqual({ w: 25, r: 8 });
    expect(warmupSeed({ ...base, hasBar: false, work: 55, step: 10 })).toEqual({ w: 20, r: 8 });
    expect(warmupSeed({ ...base, hasBar: false, work: null })).toEqual({ r: 8 });
  });

  it("reads the rack in the lift's unit: a kg lifter on a kg bar", () => {
    const kg = { bar: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25], unit: "kg" };
    expect(warmupSeed({ ...base, rack: kg, unit: "kg", work: 100 }).w).toBe(50);
    expect(warmupSeed({ ...base, rack: kg, unit: "kg", work: 30 }).w).toBe(20);
  });
});
