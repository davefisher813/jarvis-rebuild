import { describe, it, expect } from "vitest";
import { shiftBlock, blockShiftFits } from "./blockAdjust";
import { DEFAULT_ROUTINE, type RoutineData } from "./types";

const routine = (startMin: number, endMin: number): RoutineData => ({
  ...DEFAULT_ROUTINE,
  protectedBlocks: [{ id: "b1", label: "Gym", startMin, endMin, days: [1, 2, 3, 4, 5] }],
});
const block = (r: RoutineData | null) => (r?.protectedBlocks ?? [])[0];

// SCHED-F-18 (2026-09-05): "Shifts clamp at 23:59 and collapse a late event or
// block to zero length." shiftBlock clamped both ends, so a 23:15-23:45 block
// pushed an hour later became 23:59-23:59. A move that resizes the thing it
// moves is a bug, not a nudge, so it is refused.
describe("shiftBlock refuses a move that runs out of day", () => {
  it("a late block does not move and does not shrink", () => {
    const before = routine(23 * 60 + 15, 23 * 60 + 45);
    expect(shiftBlock(before, "b1", 60)).toBeNull();
    expect(block(before)!.startMin).toBe(23 * 60 + 15);
    expect(block(before)!.endMin).toBe(23 * 60 + 45);
  });

  it("an early block does not wrap backwards past midnight", () => {
    expect(shiftBlock(routine(20, 80), "b1", -30)).toBeNull();
  });

  it("a shift that fits moves both ends and keeps the length", () => {
    const after = shiftBlock(routine(17 * 60, 18 * 60), "b1", 60);
    expect(block(after)!.startMin).toBe(18 * 60);
    expect(block(after)!.endMin).toBe(19 * 60);
  });

  it("[edge] a block that ends exactly at 23:59 is still allowed to get there", () => {
    const after = shiftBlock(routine(22 * 60 + 59, 23 * 60 + 59), "b1", 0);
    expect(block(after)!.endMin).toBe(23 * 60 + 59);
    expect(blockShiftFits(22 * 60 + 59, 23 * 60 + 59, 0)).toBe(true);
    expect(blockShiftFits(22 * 60 + 59, 23 * 60 + 59, 1)).toBe(false);
  });

  it("an unknown block id is still null, as it was", () => {
    expect(shiftBlock(routine(9 * 60, 10 * 60), "nope", 15)).toBeNull();
  });
});
