// @vitest-environment jsdom
//
// THE GUARD READS A BLOCK BY DATE (2026-10-04). It built its day from the
// dow-only protectedRangesFor, which never sees a block's This Day exception:
// a skipped Breakfast still raised the conflict sheet, and a retimed one
// conflicted at the time it had left. CLAUDE.md: read a block's time for a
// date ONLY through blockForDate / protectedRangesOn.
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useConflictGuard } from "./useConflictGuard";
import { DEFAULT_ROUTINE, type RoutineData } from "../routine/types";

const DATE = "2026-10-08"; // a Thursday

function routineWith(exceptions?: Record<string, { skip?: boolean; startMin?: number; endMin?: number }>): RoutineData {
  return {
    ...DEFAULT_ROUTINE,
    protectedBlocks: [{
      id: "bf", label: "Breakfast", startMin: 9 * 60, endMin: 10 * 60,
      days: [0, 1, 2, 3, 4, 5, 6], kind: "meal", ...(exceptions ? { exceptions } : {}),
    }],
  };
}

describe("useConflictGuard honours a block's This Day exception", () => {
  it("a normal day still conflicts with the block (the control case)", () => {
    const { result } = renderHook(() => useConflictGuard([], routineWith()));
    expect(result.current.lineFor(DATE, "09:30", "10:30")).toBe("Overlaps Breakfast 9:00 to 10:00 AM");
  });

  it("a skipped day no longer blocks the time", () => {
    const { result } = renderHook(() => useConflictGuard([], routineWith({ [DATE]: { skip: true } })));
    expect(result.current.lineFor(DATE, "09:30", "10:30")).toBeNull();
    expect(result.current.itemsFor(DATE)).toEqual([]);
  });

  it("a shifted block conflicts at its new time and not at the old one", () => {
    const { result } = renderHook(() => useConflictGuard([], routineWith({ [DATE]: { startMin: 11 * 60, endMin: 12 * 60 } })));
    expect(result.current.lineFor(DATE, "09:30", "10:30")).toBeNull();
    expect(result.current.lineFor(DATE, "11:15", "11:45")).toBe("Overlaps Breakfast 11:00 AM to 12:00 PM");
  });

  it("the exception is for that date only", () => {
    const { result } = renderHook(() => useConflictGuard([], routineWith({ [DATE]: { skip: true } })));
    expect(result.current.lineFor("2026-10-09", "09:30", "10:30")).toBe("Overlaps Breakfast 9:00 to 10:00 AM");
  });
});
