import { describe, it, expect } from "vitest";
import { holdersIn, holderFor, holderKey, spanOf, type HoldRange } from "./nesting";

const deepWork: HoldRange = { s: 13 * 60, e: 15 * 60, label: "Deep Work", kind: "focus" };
const lunch: HoldRange = { s: 12 * 60, e: 13 * 60, label: "Lunch", kind: "meal" };
const sprint: HoldRange = { s: 13 * 60, e: 13 * 60 + 30, label: "Sprint", kind: "focus" };

describe("which blocks hold", () => {
  it("keeps focus blocks and drops the ones that protect FROM work", () => {
    expect(holdersIn([deepWork, lunch]).map((h) => h.label)).toEqual(["Deep Work"]);
  });

  it("falls back to the label for blocks made before kinds existed", () => {
    expect(holdersIn([{ s: 0, e: 60, label: "Deep Work" }]).length).toBe(1);
    expect(holdersIn([{ s: 0, e: 60, label: "Breakfast" }]).length).toBe(0);
  });
});

describe("holderFor", () => {
  const hs = [deepWork];

  // The exact case from Dave's screenshot.
  it("puts a task placed at the block's own start inside it", () => {
    expect(holderFor(hs, ...spanOf("13:00", "13:55"))?.label).toBe("Deep Work");
  });

  it("holds a task wholly inside", () => {
    expect(holderFor(hs, ...spanOf("13:30", "14:00"))?.label).toBe("Deep Work");
  });

  it("holds one that ends exactly on the boundary", () => {
    expect(holderFor(hs, ...spanOf("14:00", "15:00"))?.label).toBe("Deep Work");
  });

  it("does NOT hold one that overruns the block", () => {
    // Hiding this inside the block would hide the overrun.
    expect(holderFor(hs, ...spanOf("14:30", "15:30"))).toBeNull();
  });

  it("does NOT hold one that starts before the block", () => {
    expect(holderFor(hs, ...spanOf("12:30", "14:00"))).toBeNull();
  });

  it("does not hold anything outside it", () => {
    expect(holderFor(hs, ...spanOf("09:00", "10:00"))).toBeNull();
  });

  it("gives the work to the innermost holder when blocks nest", () => {
    expect(holderFor([deepWork, sprint], ...spanOf("13:00", "13:30"))?.label).toBe("Sprint");
    expect(holderFor([deepWork, sprint], ...spanOf("14:00", "14:30"))?.label).toBe("Deep Work");
  });

  it("defaults a missing end to an hour, the way the rest of the app does", () => {
    expect(holderFor(hs, ...spanOf("13:00"))?.label).toBe("Deep Work");
    expect(holderFor(hs, ...spanOf("14:30"))).toBeNull(); // 14:30 + 1h overruns
  });
});

describe("holderKey", () => {
  it("separates two blocks that share a label", () => {
    expect(holderKey(deepWork)).not.toBe(holderKey({ ...deepWork, s: 9 * 60 }));
  });
});
