import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { ScheduleService } from "./ScheduleService";
import { pushEventTomorrow, undoPushEventTomorrow, moveEvent } from "./eventAdjust";

const svc = () => new ScheduleService(new Store(new InMemoryAdapter()), "u");

// SCHED-F-05 (2026-09-05): "Fix Overlap's Tomorrow on a repeating event moves
// the whole series to a new weekday." pushEventTomorrow called moveDay on the
// record, which is the series anchor, so every future Tuesday "Team sync"
// became a Wednesday and the toast said "Moved to tomorrow". It makes the
// same exdate-and-copy split moveEvent makes.
describe("pushEventTomorrow", () => {
  it("a one-off moves a day, and Undo puts it back", async () => {
    const s = svc();
    const id = (await s.createEvent("Dentist", { date: "2026-09-22", start: "09:00", end: "09:45" }))!;
    const out = await pushEventTomorrow(id, "2026-09-22", s);
    expect(out.repeating).toBe(false);
    expect((await s.event(id))!.date).toBe("2026-09-23");
    await undoPushEventTomorrow(id, out, s);
    expect((await s.event(id))!.date).toBe("2026-09-22");
  });

  it("a weekly series keeps its weekday: the viewed day is skipped and copied to the next day", async () => {
    const s = svc();
    const id = (await s.createEvent("Team Sync", { date: "2026-09-01", start: "10:00", end: "10:30", recurrence: "weekly" }))!;
    const out = await pushEventTomorrow(id, "2026-09-22", s);
    expect(out.repeating).toBe(true);
    const series = (await s.event(id))!;
    // The anchor never moved, so every other Tuesday is untouched.
    expect(series.date).toBe("2026-09-01");
    expect(series.exdates).toEqual(["2026-09-22"]);
    expect((await s.eventsOn("2026-09-29")).map((e) => e.data.title)).toEqual(["Team Sync"]);
    // The pushed occurrence stands alone on the Wednesday.
    const copy = (await s.event(out.copyId!))!;
    expect(copy.date).toBe("2026-09-23");
    expect(copy.start).toBe("10:00");
    expect(copy.recurrence).toBeUndefined();
    expect((await s.eventsOn("2026-09-22")).length).toBe(0);
  });

  it("Undo takes the copy away and puts the occurrence back", async () => {
    const s = svc();
    const id = (await s.createEvent("Team Sync", { date: "2026-09-01", start: "10:00", recurrence: "weekly" }))!;
    const out = await pushEventTomorrow(id, "2026-09-22", s);
    await undoPushEventTomorrow(id, out, s);
    expect(await s.event(out.copyId!)).toBeNull();
    expect((await s.eventsOn("2026-09-22")).map((e) => e.data.title)).toEqual(["Team Sync"]);
    expect((await s.event(id))!.exdates).toBeUndefined();
  });

  it("the pushed copy of a Training Door series still opens the gym", async () => {
    const s = svc();
    const id = (await s.createEvent("Lift", { date: "2026-09-01", start: "17:30", end: "18:30", recurrence: "daily" }))!;
    await s.editGymDoor(id, true);
    const out = await pushEventTomorrow(id, "2026-09-22", s);
    expect((await s.event(out.copyId!))!.gym).toBe(true);
  });

  it("[edge] an event that is gone is refused, and Undo does nothing", async () => {
    const s = svc();
    const out = await pushEventTomorrow("nope", "2026-09-22", s);
    expect(out.ok).toBe(false);
    await undoPushEventTomorrow("nope", out, s);
    expect((await s.listEvents()).length).toBe(0);
  });
});

// THE ONE-OCCURRENCE COPY KEEPS THE MEETING (2026-10-04). Moving or pushing a
// single day of a repeating event leaves a standalone copy; it carried the
// door (SCHED-F-09) and nothing else, so one Tuesday of a weekly Zoom lost its
// link, notes, travel time and project at the moment it was moved.
describe("a repeating move or push leaves a copy that is still the same meeting", () => {
  const series = {
    date: "2026-10-06", start: "10:00", end: "11:00", location: "Rink 2", recurrence: "weekly" as const,
    gym: true, url: "https://zoom.example/j/9", notes: "Bring the chart", travelMin: 25, bufferMin: 10, projectId: "proj-1",
  };
  const kept = { gym: true, url: "https://zoom.example/j/9", notes: "Bring the chart", travelMin: 25, bufferMin: 10, projectId: "proj-1" };

  it("moveEvent: the copy at the new time carries link, notes, travel, buffer and project", async () => {
    const s = svc();
    const id = (await s.createEvent("Standup", series))!;
    const out = await moveEvent(id, "11:00", "2026-10-13", s);
    expect(out.repeating).toBe(true);
    expect((await s.event(out.copyId!))!).toMatchObject({ date: "2026-10-13", start: "11:00", end: "12:00", ...kept });
  });

  it("pushEventTomorrow: the copy on the next day carries them too", async () => {
    const s = svc();
    const id = (await s.createEvent("Standup", series))!;
    const out = await pushEventTomorrow(id, "2026-10-13", s);
    expect(out.repeating).toBe(true);
    expect((await s.event(out.copyId!))!).toMatchObject({ date: "2026-10-14", start: "10:00", end: "11:00", ...kept });
  });
});
