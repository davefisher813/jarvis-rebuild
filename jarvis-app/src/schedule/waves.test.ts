import { describe, it, expect } from "vitest";
import { occursOn } from "./calendar";
import { repeatRows, repeatDays, cadenceOf, endsLabel, untilIsValid, untilError, ordinal } from "./repeats";
import { gapsOn, dropInto, duplicateOf, copyDay, overlapsOn, fixOverlap, overlapLine, durationOf } from "./dayEdit";
import type { EventItem, EventData } from "./types";

const ev = (id: string, over: Partial<EventData> = {}): EventItem => ({
  id, data: { title: id, date: "2026-08-20", start: "09:00", category: "work", ...over },
});

describe("N3 · a series can end", () => {
  it("stops after the end date, inclusive", () => {
    const e = ev("clinic", { recurrence: "weekly", until: "2026-11-07" }).data;
    expect(occursOn(e, "2026-11-05")).toBe(true);  // a Thursday in range
    expect(occursOn(e, "2026-11-12")).toBe(false); // past the end
  });

  it("includes the end date itself", () => {
    const e = ev("d", { recurrence: "daily", until: "2026-08-25" }).data;
    expect(occursOn(e, "2026-08-25")).toBe(true);
    expect(occursOn(e, "2026-08-26")).toBe(false);
  });

  it("no end date still means forever, as before", () => {
    const e = ev("d", { recurrence: "daily" }).data;
    expect(occursOn(e, "2030-01-01")).toBe(true);
  });

  it("never hides the first occurrence, whatever the data says", () => {
    const e = ev("d", { recurrence: "weekly", until: "2020-01-01" }).data;
    expect(occursOn(e, "2026-08-20")).toBe(true);
  });

  it("refuses an end before the start, at the edit", () => {
    expect(untilIsValid("2026-08-20", "2026-08-19")).toBe(false);
    expect(untilIsValid("2026-08-20", "2026-08-20")).toBe(true);
    expect(untilIsValid("2026-08-20", "")).toBe(true);
    expect(untilError("2026-08-20", "2026-08-19")).toBe("Ends before it starts");
    expect(untilError("2026-08-20", "2026-09-01")).toBeNull();
  });
});

describe("W1 · the repeats view", () => {
  const items = [
    ev("Clinic", { recurrence: "weekly", until: "2026-11-07", start: "15:30", exdates: ["2026-09-05"] }),
    ev("Standup", { recurrence: "daily", start: "08:30" }),
    ev("One Off", { start: "10:00" }),
  ];

  it("lists only the repeating ones, earliest first", () => {
    expect(repeatRows(items).map((r) => r.title)).toEqual(["Standup", "Clinic"]);
  });

  it("says the cadence the way a person would", () => {
    expect(cadenceOf(ev("x", { recurrence: "daily" }).data)).toBe("Every day");
    expect(cadenceOf(ev("x", { recurrence: "weekly" }).data)).toBe("Every Thursday");
    expect(cadenceOf(ev("x", { recurrence: "monthly" }).data)).toBe("Monthly on the 20th");
    expect(cadenceOf(ev("x").data)).toBe("");
  });

  it("states 'no end date' out loud rather than leaving a blank", () => {
    expect(endsLabel(ev("x", { recurrence: "daily" }).data)).toBe("No end date");
    expect(endsLabel(ev("x", { recurrence: "daily", until: "2026-11-07" }).data)).toBe("Through Nov 7");
  });

  it("flags the endless ones, which are the point of the view", () => {
    const rows = repeatRows(items);
    expect(rows.find((r) => r.title === "Standup")!.endless).toBe(true);
    expect(rows.find((r) => r.title === "Clinic")!.endless).toBe(false);
  });

  it("counts the occurrences skipped one at a time", () => {
    expect(repeatRows(items).find((r) => r.title === "Clinic")!.skipped).toBe(1);
  });

  it("handles the ordinals people actually hit", () => {
    expect([1, 2, 3, 11, 12, 13, 21, 22, 23, 31].map(ordinal))
      .toEqual(["1st", "2nd", "3rd", "11th", "12th", "13th", "21st", "22nd", "23rd", "31st"]);
  });
});

describe("W2 · week marks", () => {
  it("marks the days a repeating thing stands on", () => {
    const items = [ev("Standup", { recurrence: "weekly" })]; // a Thursday
    const week = ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21"];
    expect([...repeatDays(items, week)]).toEqual(["2026-08-20"]);
  });

  it("ignores one-offs: the mark means something STANDING", () => {
    expect(repeatDays([ev("One Off")], ["2026-08-20"]).size).toBe(0);
  });
});

describe("M4 · drop into a gap", () => {
  const items = [
    ev("a", { start: "09:00", end: "10:00" }),
    ev("b", { start: "14:00", end: "15:00" }),
  ];

  it("finds the open stretches of a day", () => {
    const g = gapsOn(items, "2026-08-20", 8 * 60, 18 * 60);
    expect(g).toEqual([{ s: 480, e: 540 }, { s: 600, e: 840 }, { s: 900, e: 1080 }]);
  });

  it("lands where the finger pointed, snapped to the quarter hour", () => {
    const g = gapsOn(items, "2026-08-20", 8 * 60, 18 * 60);
    expect(dropInto(g, 11 * 60 + 7, 60)).toBe("11:00");
  });

  it("pulls back so the event FITS rather than hanging off the end", () => {
    // The gap is 10:00 to 12:00. A 60-minute thing dropped near 11:45 cannot
    // start there without overrunning, so it starts at 11:00 and ends exactly
    // on the gap's edge.
    expect(dropInto([{ s: 600, e: 720 }], 705, 60)).toBe("11:00");
    // And it never starts before the gap does.
    expect(dropInto([{ s: 600, e: 720 }], 100, 60)).toBe("10:00");
  });

  it("falls back to any gap that can hold it", () => {
    const g = [{ s: 480, e: 500 }, { s: 600, e: 840 }];
    expect(dropInto(g, 485, 60)).toBe("10:00");
  });

  it("says no when nothing can hold it", () => {
    expect(dropInto([{ s: 480, e: 500 }], 485, 60)).toBeNull();
  });
});

describe("E2 · duplicate", () => {
  it("a copy is a one-off, never a second member of a series", () => {
    const d = duplicateOf(ev("x", { recurrence: "weekly", until: "2026-11-07", exdates: ["2026-09-05"] }).data);
    expect(d.recurrence).toBe("none");
    expect(d.until).toBeUndefined();
    expect(d.exdates).toBeUndefined();
  });

  it("drops the things that belonged to the original, not the copy", () => {
    const d = duplicateOf(ev("x", { gcalId: "g1", sourceTaskId: "t1", taskIds: ["t2"] }).data);
    expect(d.gcalId).toBeUndefined();
    expect(d.sourceTaskId).toBeUndefined();
    expect(d.taskIds).toBeUndefined();
  });

  it("keeps what makes it the same thing", () => {
    const d = duplicateOf(ev("Gym", { start: "17:30", end: "18:30", location: "Club" }).data, "2026-08-22");
    expect(d).toMatchObject({ title: "Gym", start: "17:30", end: "18:30", location: "Club", date: "2026-08-22" });
  });
});

describe("N7 · copy a day", () => {
  const items = [
    ev("Standup", { recurrence: "daily", start: "08:30" }),
    ev("Call", { start: "10:00" }),
    ev("Gym", { start: "17:30" }),
    ev("Elsewhere", { date: "2026-08-19", start: "11:00" }),
  ];

  it("copies the one-offs, in order", () => {
    expect(copyDay(items, "2026-08-20", "2026-08-27").map((e) => e.title)).toEqual(["Call", "Gym"]);
  });

  it("never copies a repeat: it is already there by itself", () => {
    expect(copyDay(items, "2026-08-20", "2026-08-27").some((e) => e.title === "Standup")).toBe(false);
  });

  it("stamps the target day", () => {
    expect(copyDay(items, "2026-08-20", "2026-08-27").every((e) => e.date === "2026-08-27")).toBe(true);
  });
});

describe("N5 · fix the overlap", () => {
  const items = [
    ev("Call", { start: "10:00", end: "11:00" }),
    ev("Clinic", { start: "10:30", end: "11:30" }),
  ];

  it("finds the collision and how bad it is", () => {
    const o = overlapsOn(items, "2026-08-20");
    expect(o).toHaveLength(1);
    expect(o[0]!.byMin).toBe(30);
  });

  it("moves the LATER one, because the earlier is already underway", () => {
    const fix = fixOverlap(overlapsOn(items, "2026-08-20")[0]!);
    expect(fix).toEqual({ id: "Clinic", start: "11:00", end: "12:00" });
  });

  it("says it in plain words", () => {
    expect(overlapLine(overlapsOn(items, "2026-08-20")[0]!)).toBe("Call runs into Clinic by 30m");
  });

  it("finds nothing when the day is clean", () => {
    expect(overlapsOn([ev("a", { start: "09:00", end: "10:00" }), ev("b", { start: "10:00", end: "11:00" })], "2026-08-20")).toEqual([]);
  });

  it("an event with no end is an hour, not forever", () => {
    expect(durationOf(ev("x", { start: "09:00" }).data)).toBe(60);
  });
});
