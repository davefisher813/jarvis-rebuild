import { describe, it, expect } from "vitest";
import { holdExpired, holdLine, sizeOf, sizeLine, spanLabel } from "./shape";
import type { ProjectData } from "./types";

const TODAY = "2026-08-24";
const p = (over: Partial<ProjectData> = {}): ProjectData => ({ title: "P", status: "active", ...over });
const est = (map: Record<string, number>) => (c: string) => map[c] ?? 45;

describe("holdLine (pick 20)", () => {
  it("says nothing about a project that is not held", () => {
    expect(holdLine(p(), TODAY)).toBeNull();
    expect(holdLine(p({ status: "done", holdUntil: "2026-09-01" }), TODAY)).toBeNull();
  });
  it("names a hold with no date as exactly that", () => {
    expect(holdLine(p({ status: "on_hold" }), TODAY)).toBe("On hold · No date set");
  });
  it("counts down inside two weeks, and dates beyond", () => {
    expect(holdLine(p({ status: "on_hold", holdUntil: "2026-08-25" }), TODAY)).toBe("On hold until tomorrow");
    expect(holdLine(p({ status: "on_hold", holdUntil: "2026-08-30" }), TODAY)).toBe("On hold 6 more days");
    expect(holdLine(p({ status: "on_hold", holdUntil: "2026-10-01" }), TODAY)).toBe("On hold until Oct 1");
  });
  it("says the hold is over, and how long it has been over", () => {
    expect(holdLine(p({ status: "on_hold", holdUntil: TODAY }), TODAY)).toBe("The hold ends today");
    expect(holdLine(p({ status: "on_hold", holdUntil: "2026-08-23" }), TODAY)).toBe("Hold ended 1 day ago");
    expect(holdLine(p({ status: "on_hold", holdUntil: "2026-08-17" }), TODAY)).toBe("Hold ended 7 days ago");
  });
});

describe("holdExpired", () => {
  it("is true on the day and after, false before, false without a date", () => {
    expect(holdExpired(p({ status: "on_hold", holdUntil: TODAY }), TODAY)).toBe(true);
    expect(holdExpired(p({ status: "on_hold", holdUntil: "2026-08-01" }), TODAY)).toBe(true);
    expect(holdExpired(p({ status: "on_hold", holdUntil: "2026-09-01" }), TODAY)).toBe(false);
    expect(holdExpired(p({ status: "on_hold" }), TODAY)).toBe(false);
  });
  it("is never true for a project that is not held", () => {
    expect(holdExpired(p({ holdUntil: "2026-08-01" }), TODAY)).toBe(false);
  });
});

describe("sizeOf and sizeLine (pick 22)", () => {
  it("sums the learned estimate of every OPEN task", () => {
    const tasks = [
      { done: false, category: "work" },
      { done: false, category: "work" },
      { done: true, category: "work" },
      { done: false, category: "errand" },
    ];
    expect(sizeOf(tasks, est({ work: 60, errand: 15 }))).toEqual({ open: 3, minutes: 135 });
  });
  it("falls back to the default estimate for an uncategorised task", () => {
    expect(sizeOf([{ done: false }], est({}))).toEqual({ open: 1, minutes: 45 });
  });
  it("is null when nothing is open: a finished project has an end, not a size", () => {
    expect(sizeOf([{ done: true, category: "work" }], est({ work: 60 }))).toBeNull();
    expect(sizeOf([], est({}))).toBeNull();
    expect(sizeLine(null)).toBeNull();
  });
  it("fuses its units and never promises the estimate is a commitment", () => {
    expect(sizeLine({ open: 4, minutes: 200 })).toBe("4 Open · About 3h 20m");
    expect(sizeLine({ open: 1, minutes: 45 })).toBe("1 Open · About 45m");
    expect(sizeLine({ open: 2, minutes: 120 })).toBe("2 Open · About 2h");
  });
});

describe("spanLabel", () => {
  it("fuses the unit and never renders a negative", () => {
    expect(spanLabel(0)).toBe("0m");
    expect(spanLabel(-10)).toBe("0m");
    expect(spanLabel(59)).toBe("59m");
    expect(spanLabel(60)).toBe("1h");
    expect(spanLabel(90)).toBe("1h 30m");
  });
});
