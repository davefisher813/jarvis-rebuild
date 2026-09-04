import { describe, it, expect } from "vitest";
import {
  daysOfMonth, eventMinutes, minutesByCategory, hoursRows, hoursLabel,
  unscheduledGoalAreas, HOURS_MIN_TOTAL, HOURS_TOP_N,
} from "./hours";
import type { EventItem } from "../schedule/types";

// WHERE THE HOURS WENT (handoff item 13, option A). The arithmetic is the
// easy part. What is pinned here is the four refusals: no target, no judgment,
// silence on a thin month, and ids rather than titles.

const ev = (id: string, over: Partial<EventItem["data"]> = {}): EventItem => ({
  id,
  data: { title: "t-" + id, date: "2026-08-03", start: "09:00", end: "10:00", category: "work", ...over },
});

describe("the month's days", () => {
  it("walks a whole month and stops at its edge", () => {
    expect(daysOfMonth("2026-08")).toHaveLength(31);
    expect(daysOfMonth("2026-09")).toHaveLength(30);
    expect(daysOfMonth("2026-02")).toHaveLength(28);
    expect(daysOfMonth("2026-08")[0]).toBe("2026-08-01");
    expect(daysOfMonth("2026-08")[30]).toBe("2026-08-31");
  });

  it("survives a daylight-saving boundary inside the month", () => {
    // November has the clocks-back day in the Americas. A fixed 86,400,000 ms
    // step repeats a day here; setDate does not.
    const nov = daysOfMonth("2026-11");
    expect(nov).toHaveLength(30);
    expect(new Set(nov).size).toBe(30);
  });

  it("says nothing about nonsense", () => {
    expect(daysOfMonth("banana")).toEqual([]);
  });
});

describe("one event's length", () => {
  it("is zero when the event has no end, rather than a guessed hour", () => {
    expect(eventMinutes(ev("a", { end: undefined }))).toBe(0);
  });

  it("is zero for something too short to be time spent", () => {
    expect(eventMinutes(ev("a", { start: "09:00", end: "09:02" }))).toBe(0);
  });

  it("caps an all-day marker so one row cannot swallow the month", () => {
    expect(eventMinutes(ev("a", { start: "00:00", end: "23:59" }))).toBe(12 * 60);
  });

  it("is the plain span otherwise", () => {
    expect(eventMinutes(ev("a", { start: "09:00", end: "10:30" }))).toBe(90);
  });
});

describe("minutes per area", () => {
  it("counts every occurrence of a repeating event, not just the first", () => {
    const weekly = ev("w", { date: "2026-08-03", recurrence: "weekly", start: "18:00", end: "19:30" });
    const out = minutesByCategory("2026-08", [weekly]);
    // Mondays in August 2026: the 3rd, 10th, 17th, 24th, 31st.
    expect(out.work).toBe(5 * 90);
  });

  it("stops a series at its end date", () => {
    const weekly = ev("w", { date: "2026-08-03", recurrence: "weekly", until: "2026-08-17", start: "18:00", end: "19:30" });
    expect(minutesByCategory("2026-08", [weekly]).work).toBe(3 * 90);
  });

  it("respects a removed occurrence", () => {
    const weekly = ev("w", { date: "2026-08-03", recurrence: "weekly", exdates: ["2026-08-10"], start: "18:00", end: "19:30" });
    expect(minutesByCategory("2026-08", [weekly]).work).toBe(4 * 90);
  });

  it("ignores an event outside the month entirely", () => {
    expect(minutesByCategory("2026-08", [ev("a", { date: "2026-07-04" })])).toEqual({});
  });

  it("keeps uncategorised time rather than dropping it", () => {
    // Dropping it would make the named areas add up to more of the month than
    // they earned, which is a lie told by omission.
    const out = minutesByCategory("2026-08", [ev("a", { category: "" })]);
    expect(out[""]).toBe(60);
  });
});

describe("the rows the report draws", () => {
  it("says nothing at all on a month the calendar was barely used", () => {
    // Silence over guessing. Four events is not a picture of a life.
    expect(hoursRows({ work: HOURS_MIN_TOTAL - 1 })).toEqual([]);
    expect(hoursRows({ work: HOURS_MIN_TOTAL })).toHaveLength(1);
  });

  it("orders biggest first and gives each a share of the month", () => {
    const rows = hoursRows({ work: 600, family: 300, gym: 100 });
    expect(rows.map((r) => r.category)).toEqual(["work", "family", "gym"]);
    expect(rows.map((r) => r.pct)).toEqual([60, 30, 10]);
  });

  it("folds everything past the cap into one remainder, so the shares still add up", () => {
    const many: Record<string, number> = {};
    for (let i = 0; i < HOURS_TOP_N + 3; i++) many["c" + i] = 200 - i;
    const rows = hoursRows(many);
    expect(rows).toHaveLength(HOURS_TOP_N + 1);
    expect(rows[rows.length - 1]!.category).toBe("");
    expect(rows.reduce((a, r) => a + r.pct, 0)).toBeGreaterThanOrEqual(99);
  });

  it("never carries a target, an ideal split or a verdict", () => {
    // The whole section is two numbers per area. There is no third number for
    // it to fall short of, and this test is what stops one being added.
    const rows = hoursRows({ work: 600, family: 300 });
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(["category", "minutes", "pct"]);
  });
});

describe("the label", () => {
  it("reads in hours and minutes, never a decimal hour", () => {
    expect(hoursLabel(45)).toBe("45m");
    expect(hoursLabel(60)).toBe("1h");
    expect(hoursLabel(1110)).toBe("18h 30m");
    expect(hoursLabel(0)).toBe("0m");
  });
});

describe("held against what they said mattered", () => {
  it("names a goal area with nothing on the calendar", () => {
    expect(unscheduledGoalAreas({ work: 600 }, ["work", "family"])).toEqual(["family"]);
  });

  it("does not name an area that got even a little time", () => {
    // "You did somewhat less than you might have" is a judgment. Only a real
    // absence is a fact.
    expect(unscheduledGoalAreas({ family: 30 }, ["family"])).toEqual([]);
  });

  it("names each area once", () => {
    expect(unscheduledGoalAreas({}, ["family", "family", "gym"])).toEqual(["family", "gym"]);
  });

  it("ignores an empty tag", () => {
    expect(unscheduledGoalAreas({}, ["", "gym"])).toEqual(["gym"]);
  });
});
