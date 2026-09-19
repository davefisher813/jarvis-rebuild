import { describe, it, expect } from "vitest";
import { openSlots, windowsFor, type Rule } from "./slots";

// OPEN SLOTS (Track 3, 2026-09-19). Booking is the one place in the app
// where being wrong has a stranger sitting on a call nobody is on, so the
// arithmetic is pinned here rather than trusted.

const NY = "America/New_York";
// 2026-06-15 is a Monday; 2026-06-20 a Saturday.
const MON = "2026-06-15";
const SAT = "2026-06-20";
const rule = (weekday: number, startTime = "09:00", endTime = "12:00", timezone = NY): Rule =>
  ({ weekday, startTime, endTime, timezone });
// Monday 09:00 New York in June is 13:00 UTC.
const at = (iso: string) => new Date(iso).getTime();
const MON9 = at("2026-06-15T13:00:00Z");
const clock = (ms: number) => new Date(ms).toISOString().slice(11, 16);

const base = { rules: [rule(1)], fromDate: MON, days: 1, durationMin: 30, nowMs: at("2026-06-01T00:00:00Z") };

describe("openSlots", () => {
  it("slices the window onto the duration's own grid", () => {
    const s = openSlots(base);
    expect(s).toHaveLength(6);
    expect(s[0]!.startMs).toBe(MON9);
    expect(s.map((x) => clock(x.startMs))).toEqual(["13:00", "13:30", "14:00", "14:30", "15:00", "15:30"]);
    expect(s[5]!.endMs).toBe(at("2026-06-15T16:00:00Z"));
  });

  it("offers nothing on a weekday it has no rule for", () => {
    expect(openSlots({ ...base, fromDate: SAT })).toEqual([]);
  });

  it("never offers a slot that would run past the window", () => {
    // 09:00 to 10:20 holds two 40s and leaves the tail alone.
    const s = openSlots({ ...base, rules: [rule(1, "09:00", "10:20")], durationMin: 40 });
    expect(s.map((x) => clock(x.startMs))).toEqual(["13:00", "13:40"]);
  });

  // A ZONE IS NOT AN OFFSET. The same wall clock is a different instant in
  // winter, and a grid built on a fixed offset is wrong for half the year.
  it("resolves the wall clock through the zone, in both halves of the year", () => {
    const summer = openSlots(base)[0]!;
    const winter = openSlots({ ...base, fromDate: "2026-12-14", nowMs: at("2026-12-01T00:00:00Z") })[0]!;
    expect(clock(summer.startMs)).toBe("13:00");
    expect(clock(winter.startMs)).toBe("14:00");
  });

  it("respects the minimum notice, counted from now", () => {
    // Standing at Monday 13:00 UTC with two hours of notice, the 13:00 and
    // 13:30 starts are gone and 15:00 is the first one left.
    const s = openSlots({ ...base, nowMs: MON9, minNoticeHours: 2 });
    expect(clock(s[0]!.startMs)).toBe("15:00");
  });

  // A BUFFER IS NOT PART OF THE MEETING: it widens what counts as a clash
  // and never widens the slot that is offered.
  it("keeps a booked slot and its buffers clear, and still offers 30 as 30", () => {
    const busy = [{ startMs: at("2026-06-15T14:00:00Z"), endMs: at("2026-06-15T14:30:00Z") }];
    const plain = openSlots({ ...base, busy });
    expect(plain.map((x) => clock(x.startMs))).toEqual(["13:00", "13:30", "14:30", "15:00", "15:30"]);
    const buffered = openSlots({ ...base, busy, bufferBeforeMin: 15, bufferAfterMin: 15 });
    expect(buffered.map((x) => clock(x.startMs))).toEqual(["13:00", "15:00", "15:30"]);
    expect(buffered[0]!.endMs - buffered[0]!.startMs).toBe(30 * 60_000);
  });

  it("a day already at its cap offers nothing, even where the hours are free", () => {
    const busy = [{ startMs: at("2026-06-15T20:00:00Z"), endMs: at("2026-06-15T20:30:00Z") }];
    expect(openSlots({ ...base, busy, maxPerDay: 1 })).toEqual([]);
    expect(openSlots({ ...base, busy, maxPerDay: 2 }).length).toBe(6);
  });

  it("walks the window forward and keeps the whole run in time order", () => {
    const s = openSlots({ ...base, rules: [rule(1), rule(2, "14:00", "15:00")], days: 3 });
    const days = [...new Set(s.map((x) => x.date))];
    expect(days).toEqual(["2026-06-15", "2026-06-16"]);
    expect(s.map((x) => x.startMs)).toEqual([...s.map((x) => x.startMs)].sort((a, b) => a - b));
  });

  it("offers a touching pair of windows once, not twice", () => {
    const s = openSlots({ ...base, rules: [rule(1, "09:00", "10:00"), rule(1, "09:00", "09:30")] });
    expect(s.map((x) => clock(x.startMs))).toEqual(["13:00", "13:30"]);
  });

  it("refuses nonsense rather than guessing", () => {
    expect(openSlots({ ...base, durationMin: 0 })).toEqual([]);
    expect(openSlots({ ...base, days: 0 })).toEqual([]);
    expect(openSlots({ ...base, rules: [] })).toEqual([]);
    // A window that ends before it starts is not a window.
    expect(openSlots({ ...base, rules: [rule(1, "12:00", "09:00")] })).toEqual([]);
  });
});

describe("windowsFor", () => {
  it("a blocked date is closed, whatever the weekly rule says", () => {
    expect(windowsFor(MON, [rule(1)], [{ date: MON, blocked: true }])).toEqual([]);
  });
  it("an override with hours replaces the day rather than adding to it", () => {
    const w = windowsFor(MON, [rule(1)], [{ date: MON, blocked: false, startTime: "15:00", endTime: "17:00" }]);
    expect(w).toHaveLength(1);
    expect(w[0]!.startTime).toBe("15:00");
    expect(w[0]!.timezone).toBe(NY);
  });
  it("an override on another date leaves this one alone", () => {
    expect(windowsFor(MON, [rule(1)], [{ date: SAT, blocked: true }])).toHaveLength(1);
  });
});
