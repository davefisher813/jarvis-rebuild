import { describe, it, expect } from "vitest";
import { mapBooking, localDate, localTime, insideWindow } from "./bookedEvents";

// A BOOKING BECOMES AN EVENT (Track 3, 2026-09-19). The conversion is where
// the bugs live: an absolute instant has to become a local day and a wall
// clock, and getting it wrong files a real meeting on the wrong day with
// nothing looking broken.

const B = {
  id: "bk-1",
  title: "Intro Call",
  guestName: "Ada Lovelace",
  guestEmail: "ada@example.com",
  startMs: Date.parse("2026-09-22T18:00:00.000Z"),
  endMs: Date.parse("2026-09-22T18:30:00.000Z"),
};

describe("localDate and localTime", () => {
  // The suite runs at TZ=UTC, so these are the UTC readings, and the point of
  // the test is that they are built from the LOCAL parts rather than sliced
  // out of an ISO string.
  it("read the local day and the local wall clock", () => {
    expect(localDate(B.startMs)).toBe("2026-09-22");
    expect(localTime(B.startMs)).toBe("18:00");
  });
  it("pad a single digit month, day, hour and minute", () => {
    const early = Date.parse("2026-01-05T07:05:00.000Z");
    expect(localDate(early)).toBe("2026-01-05");
    expect(localTime(early)).toBe("07:05");
  });
  // A 9 PM meeting read through toISOString is filed under tomorrow for most
  // of the world. This pins that the day comes from the local date parts.
  it("file a late evening on the day it is, not on the UTC day", () => {
    const d = new Date(2026, 8, 22, 21, 30, 0);
    expect(localDate(d.getTime())).toBe("2026-09-22");
    expect(localTime(d.getTime())).toBe("21:30");
  });
});

describe("mapBooking", () => {
  it("names who took the hour, because that is the one thing he needs", () => {
    expect(mapBooking(B)!.title).toBe("Intro Call with Ada Lovelace");
  });
  it("falls back to the meeting's own name when nobody gave one", () => {
    expect(mapBooking({ ...B, guestName: "  " })!.title).toBe("Intro Call");
  });
  it("calls it a meeting when even the type has no name", () => {
    expect(mapBooking({ ...B, title: "", guestName: "" })!.title).toBe("Meeting");
  });
  it("carries the day, the start and the end", () => {
    const m = mapBooking(B)!;
    expect(m.date).toBe("2026-09-22");
    expect(m.start).toBe("18:00");
    expect(m.end).toBe("18:30");
  });
  it("writes the address down, since he has never met this person", () => {
    const m = mapBooking(B)!;
    expect(m.notes).toContain("ada@example.com");
    expect(m.attendees).toEqual([{ email: "ada@example.com", name: "Ada Lovelace" }]);
  });
  it("still makes an event when there is no email to keep", () => {
    const m = mapBooking({ ...B, guestEmail: "" })!;
    expect(m.attendees).toEqual([]);
    expect(m.notes).toBe("Booked through your link");
  });
  it("keeps the booking id, which is the only thing stopping a second copy", () => {
    expect(mapBooking(B)!.bookingId).toBe("bk-1");
  });

  // Null rather than a guess. An event at an invented hour is worse than a
  // missing one, because he plans around it.
  it("is null rather than inventing an hour out of bad times", () => {
    expect(mapBooking({ ...B, startMs: NaN })).toBeNull();
    expect(mapBooking({ ...B, endMs: NaN })).toBeNull();
    expect(mapBooking({ ...B, endMs: B.startMs })).toBeNull();
    expect(mapBooking({ ...B, endMs: B.startMs - 1000 })).toBeNull();
    expect(mapBooking({ ...B, id: "" })).toBeNull();
  });
});

describe("insideWindow", () => {
  it("includes both ends, so a booking on the edge is not silently outside", () => {
    expect(insideWindow("2026-09-18", "2026-09-18", "2026-12-17")).toBe(true);
    expect(insideWindow("2026-12-17", "2026-09-18", "2026-12-17")).toBe(true);
  });
  it("excludes a day the server was never asked about", () => {
    expect(insideWindow("2026-09-17", "2026-09-18", "2026-12-17")).toBe(false);
    expect(insideWindow("2026-12-18", "2026-09-18", "2026-12-17")).toBe(false);
  });
  it("treats a missing date as outside, so nothing is deleted on a blank", () => {
    expect(insideWindow("", "2026-09-18", "2026-12-17")).toBe(false);
  });
});
