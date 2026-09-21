import { describe, it, expect } from "vitest";
import { openSlots, windowsFor, type Rule, busyFromOverrides } from "./slots";

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

describe("his own hours count as taken", () => {
  // A blocked row that names a window is an hour he already has a meeting in,
  // not a day off. The three readings of two columns are what let this exist
  // without a migration into a live project.
  const ZONE = "America/New_York";

  it("turns a blocked window into an interval, in the owner's own clock", () => {
    const busy = busyFromOverrides([{ date: "2026-06-15", blocked: true, startTime: "14:00", endTime: "15:00" }], ZONE);
    expect(busy).toHaveLength(1);
    expect(new Date(busy[0]!.startMs).toISOString()).toBe("2026-06-15T18:00:00.000Z");
    expect(new Date(busy[0]!.endMs).toISOString()).toBe("2026-06-15T19:00:00.000Z");
  });

  // Same wall clock, different instant in December. A zone is not an offset,
  // which is the rule the rest of this file already lives by.
  it("resolves the same wall clock to a different instant across the year", () => {
    const june = busyFromOverrides([{ date: "2026-06-15", blocked: true, startTime: "09:00", endTime: "10:00" }], ZONE);
    const dec = busyFromOverrides([{ date: "2026-12-15", blocked: true, startTime: "09:00", endTime: "10:00" }], ZONE);
    expect(new Date(june[0]!.startMs).toISOString()).toBe("2026-06-15T13:00:00.000Z");
    expect(new Date(dec[0]!.startMs).toISOString()).toBe("2026-12-15T14:00:00.000Z");
  });

  it("ignores a row that is a day off rather than an hour", () => {
    expect(busyFromOverrides([{ date: "2026-06-15", blocked: true }], ZONE)).toEqual([]);
  });
  it("ignores a row that narrows the day instead of blocking part of it", () => {
    expect(busyFromOverrides([{ date: "2026-06-15", blocked: false, startTime: "09:00", endTime: "12:00" }], ZONE)).toEqual([]);
  });
  it("ignores a window that is not a window", () => {
    expect(busyFromOverrides([{ date: "2026-06-15", blocked: true, startTime: "15:00", endTime: "14:00" }], ZONE)).toEqual([]);
    expect(busyFromOverrides([{ date: "2026-06-15", blocked: true, startTime: "14:00", endTime: "14:00" }], ZONE)).toEqual([]);
  });

  // THE BUG THIS ALL CLOSES. Before this, the grid offered the hour he was
  // already sitting in a meeting for.
  it("stops the grid offering an hour he has already spoken for", () => {
    const rules = [{ weekday: 1, startTime: "09:00", endTime: "12:00", timezone: "UTC" }];
    const q = {
      rules, fromDate: "2026-06-15", days: 1, durationMin: 60,
      nowMs: Date.parse("2026-06-01T00:00:00Z"),
    };
    const open = openSlots(q);
    expect(open.map((s) => new Date(s.startMs).toISOString())).toEqual([
      "2026-06-15T09:00:00.000Z", "2026-06-15T10:00:00.000Z", "2026-06-15T11:00:00.000Z",
    ]);
    const withHis = openSlots({
      ...q,
      committed: busyFromOverrides([{ date: "2026-06-15", blocked: true, startTime: "10:00", endTime: "11:00" }], "UTC"),
    });
    expect(withHis.map((s) => new Date(s.startMs).toISOString())).toEqual([
      "2026-06-15T09:00:00.000Z", "2026-06-15T11:00:00.000Z",
    ]);
  });

  it("a blocked window leaves the rest of the day open, unlike a day off", () => {
    const rules = [{ weekday: 1, startTime: "09:00", endTime: "12:00", timezone: "UTC" }];
    const q = { rules, fromDate: "2026-06-15", days: 1, durationMin: 60, nowMs: Date.parse("2026-06-01T00:00:00Z") };
    const over = [{ date: "2026-06-15", blocked: true, startTime: "10:00", endTime: "11:00" }];
    expect(openSlots({ ...q, overrides: over, committed: busyFromOverrides(over, "UTC") })).toHaveLength(2);
    // The same row without a window is the whole day gone.
    expect(openSlots({ ...q, overrides: [{ date: "2026-06-15", blocked: true }] })).toHaveLength(0);
  });

  // HIS OWN MEETINGS ARE NOT BOOKINGS. maxPerDay is how many bookings he will
  // take in a day; folded into one list, a cap of one plus one of his own
  // meetings would close a day nobody had booked.
  it("does not let his own hours eat the daily booking cap", () => {
    const rules = [{ weekday: 1, startTime: "09:00", endTime: "12:00", timezone: "UTC" }];
    const q = {
      rules, fromDate: "2026-06-15", days: 1, durationMin: 60, maxPerDay: 1,
      nowMs: Date.parse("2026-06-01T00:00:00Z"),
      committed: busyFromOverrides([{ date: "2026-06-15", blocked: true, startTime: "10:00", endTime: "11:00" }], "UTC"),
    };
    // One of his own meetings, no bookings yet: the day is still open.
    expect(openSlots(q).length).toBeGreaterThan(0);
    // One real booking, and the cap closes it.
    expect(openSlots({
      ...q,
      busy: [{ startMs: Date.parse("2026-06-15T09:00:00Z"), endMs: Date.parse("2026-06-15T10:00:00Z") }],
    })).toHaveLength(0);
  });
});
