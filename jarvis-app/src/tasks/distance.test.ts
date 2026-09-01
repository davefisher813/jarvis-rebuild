import { describe, expect, it } from "vitest";
import { distanceFor } from "./grouping";
import type { TaskData } from "../notes/types";

const task = (due: string | null, extra: Partial<TaskData> = {}): TaskData =>
  ({ text: "x", category: "c", done: false, due, ...extra } as TaskData);

const TODAY = "2026-09-01";

describe("distanceFor: the urgency chip says the distance", () => {
  it("nothing due tomorrow or later gets a chip", () => {
    expect(distanceFor(task("2026-09-02"), TODAY)).toBeNull();
    expect(distanceFor(task("2026-10-01"), TODAY)).toBeNull();
    expect(distanceFor(task(null), TODAY)).toBeNull();
  });
  it("done tasks never carry a chip", () => {
    expect(distanceFor(task("2026-08-01", { done: true }), TODAY)).toBeNull();
  });
  it("due today reads TODAY, amber", () => {
    expect(distanceFor(task(TODAY), TODAY)).toEqual({ label: "TODAY", kind: "today" });
  });
  it("walks the ladder: days, then weeks, then the cap", () => {
    expect(distanceFor(task("2026-08-31"), TODAY)?.label).toBe("1 DAY LATE");
    expect(distanceFor(task("2026-08-30"), TODAY)?.label).toBe("2 DAYS LATE");
    expect(distanceFor(task("2026-08-26"), TODAY)?.label).toBe("6 DAYS LATE");
    expect(distanceFor(task("2026-08-25"), TODAY)?.label).toBe("1 WEEK LATE");
    expect(distanceFor(task("2026-08-18"), TODAY)?.label).toBe("2 WEEKS LATE");
    expect(distanceFor(task("2026-08-03"), TODAY)?.label).toBe("4 WEEKS LATE");
    expect(distanceFor(task("2026-08-02"), TODAY)?.label).toBe("OVER A MONTH");
    expect(distanceFor(task("2025-01-01"), TODAY)?.label).toBe("OVER A MONTH");
  });
  it("every late label is red, never longer than its own cap", () => {
    for (const d of ["2026-08-31", "2026-08-20", "2026-06-01"]) {
      const r = distanceFor(task(d), TODAY);
      expect(r?.kind).toBe("late");
      expect(r!.label.length).toBeLessThanOrEqual("OVER A MONTH".length);
    }
  });
  it("a missed daily is simply TODAY, never late", () => {
    expect(distanceFor(task("2026-08-20", { recurrence: "daily" }), TODAY)).toEqual({ label: "TODAY", kind: "today" });
  });
});
