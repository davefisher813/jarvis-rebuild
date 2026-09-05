import { describe, it, expect } from "vitest";
import { weekStartISO, weekReceipt, receiptLine, afterHoursLine } from "./receipts";
import type { CompletionSample } from "../shared/timeSense";

// The This Week receipt: derived only, silent when nothing happened.

const TODAY = "2026-08-05"; // a Wednesday
const ms = (iso: string) => new Date(iso + "T10:00:00").getTime();
const sample = (iso: string, cat: string): CompletionSample => ({ t: ms(iso), h: 10, dow: 3, cat });

describe("weekStartISO", () => {
  it("weeks start Monday and hard-reset", () => {
    expect(weekStartISO("2026-08-05")).toBe("2026-08-03"); // Wed -> Mon
    expect(weekStartISO("2026-08-03")).toBe("2026-08-03"); // Mon is its own start
    expect(weekStartISO("2026-08-09")).toBe("2026-08-03"); // Sun still last Mon
    expect(weekStartISO("2026-08-10")).toBe("2026-08-10"); // next Mon resets
  });

  // SHELL-F-07 (2026-09-05): beyond UTC+12 (Auckland in summer, Kiribati all
  // year) local noon is still the previous day in UTC, so reading the shifted
  // date back through toISOString() started the week on Sunday. Kiritimati is
  // UTC+14 in every season, so the case does not depend on the calendar.
  it("still starts Monday fourteen hours ahead of Greenwich", () => {
    const prevTz = process.env.TZ;
    process.env.TZ = "Pacific/Kiritimati";
    try {
      expect(weekStartISO("2026-01-12")).toBe("2026-01-12"); // Mon is its own start
      expect(weekStartISO("2026-01-14")).toBe("2026-01-12"); // Wed -> Mon
      expect(weekStartISO("2026-01-18")).toBe("2026-01-12"); // Sun still last Mon
    } finally {
      process.env.TZ = prevTz;
    }
  });
});

describe("weekReceipt", () => {
  const samples = [
    sample("2026-08-04", "c1"),
    sample("2026-08-04", "c1"),
    sample("2026-08-02", "c1"), // LAST week: hard reset, not counted
    sample("2026-08-04", "other"),
  ];
  const events = [
    { date: "2026-08-03", start: "10:00", category: "c1" },
    { date: "2026-08-04", start: "19:30", category: "c1" }, // after hours
    { date: "2026-08-04", start: "08:00", category: "c1" }, // before hours
    { date: "2026-07-30", start: "10:00", category: "c1" }, // last week
    { date: "2026-08-04", start: "20:00", category: "other" },
  ];

  it("counts this week's completions and events for the one category", () => {
    const r = weekReceipt("c1", samples, events, TODAY, null);
    expect(r.done).toBe(2);
    expect(r.events).toBe(3);
    expect(r.afterHours).toBe(0); // work hours off: no after-hours claim
  });

  it("after-hours only counts when work hours are on, on both edges", () => {
    const r = weekReceipt("c1", samples, events, TODAY, { startMin: 9 * 60, endMin: 17 * 60 });
    expect(r.afterHours).toBe(2); // 7:30 PM and 8:00 AM
  });

  it("says nothing when nothing happened", () => {
    const r = weekReceipt("empty", samples, events, TODAY, null);
    expect(receiptLine(r)).toBeNull();
  });
});

describe("lines", () => {
  it("omits zero parts and handles singulars", () => {
    expect(receiptLine({ done: 5, events: 3, afterHours: 0 })).toBe("5 Things done · 3 Events");
    expect(receiptLine({ done: 1, events: 0, afterHours: 0 })).toBe("1 Thing done");
    expect(receiptLine({ done: 0, events: 1, afterHours: 0 })).toBe("1 Event");
    expect(afterHoursLine({ done: 0, events: 2, afterHours: 1 })).toBe("1 Event after work hours");
    expect(afterHoursLine({ done: 0, events: 2, afterHours: 0 })).toBeNull();
  });
});
