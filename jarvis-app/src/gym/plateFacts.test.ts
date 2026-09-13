import { describe, it, expect } from "vitest";
import { nearestBuildable, plateFacts, DEFAULT_PLATES } from "./ramp";

// H-29 (Health Push B, 2026-09-12): a number the rack cannot build says so
// and names the nearest it can.
const rack = { bar: 45, plates: DEFAULT_PLATES, unit: "lb" };

describe("nearestBuildable", () => {
  it("finds the nearest total the rack can load, lower on a tie", () => {
    expect(nearestBuildable(137, 45, DEFAULT_PLATES)).toBe(135);
    expect(nearestBuildable(138, 45, DEFAULT_PLATES)).toBe(140);
    expect(nearestBuildable(235, 45, [45])).toBe(225);
  });
  it("is null with no plates at all", () => {
    expect(nearestBuildable(137, 45, [])).toBeNull();
  });
});

describe("plateFacts", () => {
  it("says the plates per side when the rack can build it", () => {
    expect(plateFacts(135, rack)).toEqual({ kind: "plates", per: [45] });
  });
  it("says not buildable and the nearest when it cannot", () => {
    expect(plateFacts(137, rack)).toEqual({ kind: "none", at: 137, nearest: 135 });
  });
  it("says nothing about an empty bar", () => {
    expect(plateFacts(45, rack)).toBeNull();
    expect(plateFacts(20, rack)).toBeNull();
  });
  it("speaks the exercise's unit, whatever the rack's is", () => {
    const kgRack = { bar: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25], unit: "kg" };
    const f = plateFacts(100, kgRack, "kg");
    expect(f).toEqual({ kind: "plates", per: [25, 15] });
  });
});
