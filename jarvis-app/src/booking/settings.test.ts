import { describe, it, expect } from "vitest";
import { readBookingSettings, updateBookingSettings, writeBookingSettings, DEFAULT_BOOKING_SETTINGS } from "./settings";
import type { Storage2 } from "../gym/liveSession";

// Track 3 (2026-09-14): Your Times, stored locally until the booking tables
// have a project to live in.
function mem(): Storage2 {
  const m = new Map<string, string>();
  return { read: (k) => m.get(k) ?? null, write: (k, v) => { m.set(k, v); }, remove: (k) => { m.delete(k); } };
}

describe("booking settings", () => {
  it("defaults to off, weekdays, thirty minutes, anyone with the link, link only", () => {
    expect(readBookingSettings(mem())).toEqual(DEFAULT_BOOKING_SETTINGS);
  });
  it("round-trips, and a patch keeps what it did not name", () => {
    const s = mem();
    writeBookingSettings({ ...DEFAULT_BOOKING_SETTINGS, available: true, days: [5, 6] }, s);
    updateBookingSettings({ durationMin: 45 }, s);
    expect(readBookingSettings(s)).toMatchObject({ available: true, days: [5, 6], durationMin: 45, who: "anyone" });
  });
  it("drops a day, a duration or a word it does not know", () => {
    const s = mem();
    s.write("jarvis.booking.settings.v1", JSON.stringify({ days: [1, 9, 1], durationMin: 20, who: "aliens", visibility: "loud" }));
    expect(readBookingSettings(s)).toEqual({ ...DEFAULT_BOOKING_SETTINGS, days: [1] });
  });
  it("reads the defaults off broken storage", () => {
    const s = mem();
    s.write("jarvis.booking.settings.v1", "{nope");
    expect(readBookingSettings(s)).toEqual(DEFAULT_BOOKING_SETTINGS);
  });
});
