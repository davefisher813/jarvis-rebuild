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

// D7 + D1 (Training Catalog V2, approved 2026-08-31).
describe("duplicateEntry never copies a log stamp", () => {
  it("a duplicated chip is a new event: no `at` rides along", () => {
    const src = { id: "s1", w: 135, r: 8, at: 999 };
    const copy = duplicateEntry(src);
    expect(copy.w).toBe(135);
    expect("at" in copy).toBe(false);
    expect(copy.id).not.toBe("s1");
  });
});

describe("entryFrom: tap-to-match builds a clean loggable entry (D2)", () => {
  it("carries only the numbers, fresh id, no moved/at/skipped", async () => {
    const { entryFrom } = await import("./strip");
    const e = entryFrom({ w: 250, r: 3, skipped: false });
    expect(e.w).toBe(250);
    expect(e.r).toBe(3);
    expect(e.id).toBeTruthy();
    expect("at" in e).toBe(false);
    expect("moved" in e).toBe(false);
    expect("skipped" in e).toBe(false);
  });
  it("carries the bare done mark through", async () => {
    const { entryFrom } = await import("./strip");
    expect(entryFrom({ done: true }).done).toBe(true);
  });
});

describe("resizeStrip: the count stepper edits the strip in place (D1)", () => {
  it("growing duplicates the last chip's numbers with fresh ids", async () => {
    const { resizeStrip } = await import("./strip");
    const sets = uniformStrip(2, { w: 135, r: 8 });
    const out = resizeStrip(sets, 4);
    expect(out).toHaveLength(4);
    expect(out[0]).toBe(sets[0]); // survivors untouched, same object
    expect(out[3]!.w).toBe(135);
    expect(new Set(out.map((s) => s.id)).size).toBe(4);
  });
  it("shrinking drops from the end and keeps the head intact", async () => {
    const { resizeStrip } = await import("./strip");
    const sets = uniformStrip(3, { w: 135, r: 8 });
    const out = resizeStrip(sets, 1);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(sets[0]);
  });
  it("never goes below one chip", async () => {
    const { resizeStrip } = await import("./strip");
    expect(resizeStrip(uniformStrip(2), 0)).toHaveLength(1);
  });
});

describe("applyToAll: Edit All Sets writes one field across the strip (D1)", () => {
  it("sets the field on every live chip", async () => {
    const { applyToAll } = await import("./strip");
    const sets = uniformStrip(3, { w: 135, r: 8 });
    const out = applyToAll("weight_reps", sets, "w", 145);
    for (const s of out) expect(s.w).toBe(145);
    for (const s of out) expect(s.r).toBe(8);
  });
  it("zero means didn't-say: the field comes OFF, never a stored zero", async () => {
    const { applyToAll } = await import("./strip");
    const out = applyToAll("weight_reps", uniformStrip(2, { w: 135, r: 8 }), "w", 0);
    for (const s of out) expect("w" in s).toBe(false);
  });
  it("skipped chips are left alone, same as bumpStrip", async () => {
    const { applyToAll } = await import("./strip");
    const sets = [...uniformStrip(1, { w: 100, r: 5 }), { id: "sk", skipped: true as const }];
    const out = applyToAll("weight_reps", sets, "w", 200);
    expect(out[0]!.w).toBe(200);
    expect("w" in out[1]!).toBe(false);
  });
  it("a field the kind does not use is refused, not stored", async () => {
    const { applyToAll } = await import("./strip");
    const sets = uniformStrip(2, { r: 10 });
    const out = applyToAll("reps", sets, "w", 45);
    for (const s of out) expect("w" in s).toBe(false);
  });
});
