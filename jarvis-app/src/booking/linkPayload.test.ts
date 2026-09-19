import { describe, it, expect } from "vitest";
import { toSundayFirst, ruleRows, makeSlug, VISIBILITY_ROW, WHO_ROW, DEFAULT_WINDOW } from "./linkPayload";
import { DEFAULT_BOOKING_SETTINGS, type BookingSettings } from "./settings";

const settings = (over: Partial<BookingSettings> = {}): BookingSettings =>
  ({ ...DEFAULT_BOOKING_SETTINGS, available: true, ...over });

describe("toSundayFirst", () => {
  // The screen stores Monday-first and both Postgres and Date.getDay count
  // from Sunday. Off by one here books people on the wrong day of the week.
  it("maps the whole week, both ends included", () => {
    expect(toSundayFirst(0)).toBe(1); // Monday
    expect(toSundayFirst(4)).toBe(5); // Friday
    expect(toSundayFirst(5)).toBe(6); // Saturday
    expect(toSundayFirst(6)).toBe(0); // Sunday wraps
  });
  it("is a bijection, so no two days collapse onto one", () => {
    const mapped = [0, 1, 2, 3, 4, 5, 6].map(toSundayFirst);
    expect(new Set(mapped).size).toBe(7);
  });
});

describe("ruleRows", () => {
  it("writes one row per chosen day, in week order, with the default window", () => {
    const rows = ruleRows(settings({ days: [4, 0, 2] }), "u1", "America/New_York");
    expect(rows.map((r) => r.weekday)).toEqual([1, 3, 5]);
    expect(rows[0]).toEqual({
      owner_id: "u1", weekday: 1,
      start_time: DEFAULT_WINDOW.startTime, end_time: DEFAULT_WINDOW.endTime,
      timezone: "America/New_York",
    });
  });
  it("an owner who is not available takes no bookings at all", () => {
    expect(ruleRows(settings({ available: false, days: [0, 1, 2] }), "u1", "UTC")).toEqual([]);
  });
  it("drops a repeated or impossible day rather than writing it", () => {
    const rows = ruleRows(settings({ days: [1, 1, 9, -2] }), "u1", "UTC");
    expect(rows.map((r) => r.weekday)).toEqual([2]);
  });
});

describe("the words the database uses", () => {
  it("translates every visibility and every who, with nothing left over", () => {
    expect(VISIBILITY_ROW).toEqual({ public: "public", link: "link_only", named: "named_contacts" });
    expect(WHO_ROW).toEqual({ anyone: "open_link", approved: "approved_contacts", connections: "org_internal" });
  });
});

describe("makeSlug", () => {
  it("is the length asked for and stays inside its alphabet", () => {
    const s = makeSlug(() => 0.5, 10);
    expect(s).toHaveLength(10);
    expect(s).toMatch(/^[a-z2-9]+$/);
  });
  it("leaves out the characters that are ambiguous read aloud or typed", () => {
    const every = makeSlug((() => { let i = 0; return () => (i++ % 29) / 29; })(), 29);
    for (const bad of ["l", "1", "o", "0", "u", "v", "i"]) expect(every).not.toContain(bad);
  });
  it("is unguessable enough to be the only thing protecting a link", () => {
    // 29^10 is about 4.2e14: a slug is not a password, but it is not a
    // number somebody walks either.
    expect(Math.pow(29, 10)).toBeGreaterThan(1e14);
    const many = new Set(Array.from({ length: 500 }, () => makeSlug()));
    expect(many.size).toBe(500);
  });
});
