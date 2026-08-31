import { describe, it, expect } from "vitest";
import { newSetId, blankEntry, uniformStrip, duplicateEntry, bumpStrip, newExercise } from "./strip";

describe("newSetId", () => {
  it("never repeats, even called back to back", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newSetId()));
    expect(ids.size).toBe(50);
  });
});

describe("blankEntry", () => {
  it("is an id and nothing else", () => {
    const e = blankEntry();
    expect(typeof e.id).toBe("string");
    expect(e.w).toBeUndefined();
    expect(e.r).toBeUndefined();
    expect(e.done).toBeUndefined();
    expect(e.skipped).toBeUndefined();
  });
});

describe("uniformStrip: the convenience input (catalog Q6)", () => {
  it("expands a count and a target into that many identical, independently-id'd chips", () => {
    const strip = uniformStrip(3, { w: 135, r: 8 });
    expect(strip).toHaveLength(3);
    expect(strip.every((s) => s.w === 135 && s.r === 8)).toBe(true);
    const ids = new Set(strip.map((s) => s.id));
    expect(ids.size).toBe(3); // three real chips, not one object repeated
  });

  it("never produces a zero-length strip, even asked for 0 or a negative count", () => {
    expect(uniformStrip(0)).toHaveLength(1);
    expect(uniformStrip(-5)).toHaveLength(1);
  });

  it("rounds a fractional count", () => {
    expect(uniformStrip(2.6)).toHaveLength(3);
  });

  it("defaults to a blank target", () => {
    const strip = uniformStrip(2);
    expect(strip.every((s) => s.w === undefined && s.r === undefined)).toBe(true);
  });
});

describe("duplicateEntry", () => {
  it("copies every field but mints a fresh id", () => {
    const original = { id: "orig", w: 135, r: 8, done: undefined };
    const copy = duplicateEntry(original);
    expect(copy.id).not.toBe("orig");
    expect(copy.w).toBe(135);
    expect(copy.r).toBe(8);
  });
});

describe("bumpStrip: Duplicate Week & Bump (catalog §4.1)", () => {
  it("adds the bump to every field the kind actually uses", () => {
    const sets = uniformStrip(3, { w: 135, r: 8 });
    const bumped = bumpStrip("weight_reps", sets, { w: 5 });
    expect(bumped.every((s) => s.w === 140 && s.r === 8)).toBe(true);
    // fresh ids are not required by bumpStrip itself (caller mints those before
    // calling it, per GymFlow's Duplicate & Bump), but the values must move.
  });

  it("bumps reps independently of weight", () => {
    const sets = uniformStrip(2, { w: 100, r: 5 });
    const bumped = bumpStrip("weight_reps", sets, { r: 2 });
    expect(bumped.every((s) => s.w === 100 && s.r === 7)).toBe(true);
  });

  it("ignores a bump field the kind does not use", () => {
    // "reps" kind has no weight field; a stray w bump must not appear.
    const sets = uniformStrip(2, { r: 10 });
    const bumped = bumpStrip("reps", sets, { w: 50, r: 1 });
    expect(bumped.every((s) => s.w === undefined && s.r === 11)).toBe(true);
  });

  it("never bumps a skipped entry -- there is nothing there to bump", () => {
    const sets = [{ id: "s1", w: 100, r: 5 }, { id: "s2", w: 100, r: 5, skipped: true }];
    const bumped = bumpStrip("weight_reps", sets, { w: 10 });
    expect(bumped[0]).toMatchObject({ w: 110, r: 5 });
    expect(bumped[1]).toEqual(sets[1]); // untouched, same object shape
  });

  it("never bumps a field below zero", () => {
    const sets = uniformStrip(1, { w: 5 });
    const bumped = bumpStrip("weight_reps", sets, { w: -50 });
    expect(bumped[0]!.w).toBe(0);
  });

  it("a done-kind strip has no bumpable fields, so bump is a no-op on values", () => {
    const sets = uniformStrip(2, {});
    const bumped = bumpStrip("done", sets, { w: 10, r: 1 });
    expect(bumped.every((s) => s.w === undefined && s.r === undefined)).toBe(true);
  });
});

describe("newExercise", () => {
  it("starts with exactly one blank planned set", () => {
    const ex = newExercise("e1", "Bench", "weight_reps");
    expect(ex.id).toBe("e1");
    expect(ex.name).toBe("Bench");
    expect(ex.sets).toHaveLength(1);
    expect(ex.sets[0]!.w).toBeUndefined();
  });

  it("accepts overrides like unit", () => {
    const ex = newExercise("e1", "Bench", "weight_reps", { unit: "kg" });
    expect(ex.unit).toBe("kg");
  });
});

// EMPTY IS LEGAL, the storage half (Dave 2026-08-31). The convenience input
// expands only real numbers: a zero stepper means "didn't say", and minting
// it into every chip is how "0 lb × 8" got stored in the first place.
describe("uniformStrip never mints a zero", () => {
  it("drops zero fields from the target and keeps the real ones", () => {
    const strip = uniformStrip(3, { w: 0, r: 8 });
    expect(strip).toHaveLength(3);
    for (const s of strip) {
      expect(s.r).toBe(8);
      expect("w" in s).toBe(false);
    }
  });

  it("keeps a genuine weight untouched", () => {
    const s = uniformStrip(2, { w: 115, r: 8 })[0]!;
    expect(s.w).toBe(115);
    expect(s.r).toBe(8);
  });

  it("carries the done mark through without inventing numbers", () => {
    const s = uniformStrip(2, { done: true, w: 0 })[0]!;
    expect(s.done).toBe(true);
    expect("w" in s).toBe(false);
  });
});
