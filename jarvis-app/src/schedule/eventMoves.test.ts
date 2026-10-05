import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { ScheduleService } from "./ScheduleService";
import { commitRetime, undoRetime, nudgeStart, duplicateEvent } from "./eventMoves";

const svc = () => new ScheduleService(new Store(new InMemoryAdapter()), "u");

// SCHEDULE AUDIT 2026-10-01, item 4. Every "put this event at a new time" goes
// through commitRetime, so a check that needs the new time hooks in once.
describe("commitRetime", () => {
  it("moves the start and keeps the length when no end is given", async () => {
    const s = svc();
    const id = (await s.createEvent("Dentist", { date: "2026-10-02", start: "09:00", end: "09:45" }))!;
    const out = await commitRetime(id, { start: "10:30" }, "2026-10-02", s);
    expect(out.ok).toBe(true);
    const e = (await s.event(id))!;
    expect([e.start, e.end]).toEqual(["10:30", "11:15"]);
  });

  it("moves the start AND sets the length in one commit, and one Undo puts both back", async () => {
    const s = svc();
    const id = (await s.createEvent("Dentist", { date: "2026-10-02", start: "09:00", end: "09:45" }))!;
    const out = await commitRetime(id, { start: "10:00", end: "11:30" }, "2026-10-02", s);
    const e = (await s.event(id))!;
    expect([e.start, e.end]).toEqual(["10:00", "11:30"]);
    await undoRetime(id, "2026-10-02", out, s);
    const back = (await s.event(id))!;
    expect([back.start, back.end]).toEqual(["09:00", "09:45"]);
  });

  it("an event with no end can be given one, and Undo takes it away again", async () => {
    const s = svc();
    const id = (await s.createEvent("Call", { date: "2026-10-02", start: "09:00" }))!;
    const out = await commitRetime(id, { start: "09:15", end: "10:00" }, "2026-10-02", s);
    expect((await s.event(id))!.end).toBe("10:00");
    await undoRetime(id, "2026-10-02", out, s);
    const back = (await s.event(id))!;
    expect(back.start).toBe("09:00");
    expect(back.end || "").toBe("");
  });

  it("a repeating event moves ONE occurrence, with the new length on the copy", async () => {
    const s = svc();
    const id = (await s.createEvent("Standup", { date: "2026-09-01", start: "09:00", end: "09:15", recurrence: "daily" }))!;
    const out = await commitRetime(id, { start: "13:00", end: "13:30" }, "2026-10-02", s);
    expect(out.repeating).toBe(true);
    const series = (await s.event(id))!;
    expect(series.start).toBe("09:00");
    expect(series.exdates).toEqual(["2026-10-02"]);
    const copy = (await s.event(out.copyId!))!;
    expect([copy.date, copy.start, copy.end]).toEqual(["2026-10-02", "13:00", "13:30"]);
    await undoRetime(id, "2026-10-02", out, s);
    expect(await s.event(out.copyId!)).toBeNull();
  });

  it("[edge] an event that is gone is refused", async () => {
    const out = await commitRetime("nope", { start: "10:00" }, "2026-10-02", svc());
    expect(out.ok).toBe(false);
  });
});

describe("nudgeStart", () => {
  it("shifts by the delta", () => {
    expect(nudgeStart("10:00", 15, 30)).toBe("10:15");
    expect(nudgeStart("10:00", -30, 30)).toBe("09:30");
  });
  it("refuses rather than clamps at either edge of the day", () => {
    expect(nudgeStart("00:10", -15, 30)).toBeNull();
    expect(nudgeStart("23:30", 30, 20)).toBeNull();
    expect(nudgeStart("23:00", 30, null)).toBe("23:30");
  });
  it("counts the block's length: it must still fit before midnight", () => {
    expect(nudgeStart("22:00", 30, 120)).toBeNull();
    expect(nudgeStart("21:00", 30, 120)).toBe("21:30");
  });
});

// A COPY KEEPS WHAT MAKES IT THE SAME THING (2026-10-04). Duplicate listed
// five fields by hand and toasted "Duplicated", so the copy of a meeting had
// no Join link, notes, travel time or project, and of a door block no door.
describe("duplicateEvent keeps the meeting, the trip, the project and the door", () => {
  it("carries gym, url, notes, travel, buffer and project, and still drops the repeat and the keys", async () => {
    const s = svc();
    const id = (await s.createEvent("Clinic Review", {
      date: "2026-10-05", start: "09:00", end: "10:00", location: "Rink 2", recurrence: "weekly", until: "2026-12-01",
      gym: true, url: "https://zoom.example/j/9", notes: "Bring the chart", travelMin: 25, bufferMin: 10, projectId: "proj-1",
      clientId: "client-key-1", bookingId: "booking-1",
    }))!;
    const all = await s.listEvents();
    const made = await duplicateEvent(id, all, "2026-10-06", s);
    expect(made.ok).toBe(true);
    const copy = (await s.event(made.madeId!))!;
    expect(copy).toMatchObject({
      date: "2026-10-06", start: "09:00", end: "10:00", location: "Rink 2",
      gym: true, url: "https://zoom.example/j/9", notes: "Bring the chart", travelMin: 25, bufferMin: 10, projectId: "proj-1",
    });
    // A copy is a one-off with no claim on the original's keys.
    expect(copy.recurrence).toBeUndefined();
    expect(copy.until).toBeUndefined();
    expect(copy.clientId).toBeUndefined();
    expect(copy.bookingId).toBeUndefined();
  });
});
