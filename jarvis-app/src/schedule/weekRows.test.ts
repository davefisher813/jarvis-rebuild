import { describe, it, expect } from "vitest";
import { weekRowsFor } from "./weekRows";
import { DEFAULT_ROUTINE } from "../routine/types";
import type { EventItem } from "./types";

// THE WEEK (D2). Seven rows from the same window and open-slot rule the
// Day view uses.
const ev = (id: string, date: string, start: string, end: string, category = "work"): EventItem =>
  ({ id, data: { title: id, date, start, end, category } } as unknown as EventItem);

describe("weekRowsFor", () => {
  const dates = ["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"];
  const events = [ev("Standup", "2026-09-02", "08:30", "09:00"), ev("Deep Work", "2026-09-02", "13:00", "14:30"), ev("Field Day", "2026-09-05", "10:00", "13:00", "family")];

  it("places every block by time on its day and counts what is left of the window", () => {
    const rows = weekRowsFor(dates, events, DEFAULT_ROUTINE);
    expect(rows).toHaveLength(7);
    expect(rows.map((r) => r.dow)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const wed = rows[2]!;
    expect(wed.blocks.map((b) => [b.title, b.s, b.e])).toEqual([["Standup", 510, 540], ["Deep Work", 780, 870]]);
    expect(wed.count).toBe(2);
    const whole = wed.windowE - wed.windowS;
    expect(wed.openMin).toBe(whole - 30 - 90);
    expect(rows[6]!.blocks).toEqual([]);
    expect(rows[6]!.openMin).toBe(rows[6]!.windowE - rows[6]!.windowS);
  });

  it("today counts its open time from now, a day ahead from its wake", () => {
    const rows = weekRowsFor(dates, events, DEFAULT_ROUTINE, { date: "2026-09-02", nowMin: 12 * 60 });
    const wed = rows[2]!;
    // From noon: the window's end minus noon, minus Deep Work.
    expect(wed.openMin).toBe(wed.windowE - 12 * 60 - 90);
    const thu = rows[3]!;
    expect(thu.openMin).toBe(thu.windowE - thu.windowS);
  });

  it("a day whose window has passed is not open at all", () => {
    const rows = weekRowsFor(dates, [], DEFAULT_ROUTINE, { date: "2026-09-02", nowMin: 23 * 60 + 59 });
    expect(rows[2]!.openMin).toBe(0);
  });
});
