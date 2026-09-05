import { describe, it, expect } from "vitest";
import { rampFor, DEFAULT_PLATES } from "./ramp";
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
