import { Store, InMemoryAdapter } from "@core";
import { describe, it, expect } from "vitest";
import { ScheduleService } from "../../schedule/ScheduleService";
import { importCalendar, listMail } from "./sync";
import { makeFakeGoogleApi } from "./fakeApi";
import type { GCalEvent, GmailMeta } from "./map";

function apiWith(events: GCalEvent[], messages: GmailMeta[] = []) {
  return makeFakeGoogleApi({ listUpcomingEvents: async () => events, listRecentMessages: async () => messages });
}

describe("google sync", () => {
  it("imports events into the engine and dedupes on re-run", async () => {
    const schedule = new ScheduleService(new Store(new InMemoryAdapter()), "u");
    const api = apiWith([
      { id: "g1", summary: "Standup", start: { dateTime: "2026-06-01T09:00:00Z" } },
      { id: "g2", summary: "Review", start: { dateTime: "2026-06-02T14:00:00Z" } },
    ]);
    expect(await importCalendar(api, schedule)).toBe(2);
    expect(await importCalendar(api, schedule)).toBe(0); // re-run creates nothing
    const all = await schedule.listEvents();
    expect(all.length).toBe(2);
    expect(all.some((e) => e.data.gcalId === "g1")).toBe(true);
  });
  it("skips unmappable events", async () => {
    const schedule = new ScheduleService(new Store(new InMemoryAdapter()), "u");
    const api = apiWith([{ id: "", start: { dateTime: "2026-06-01T09:00:00Z" } }, { id: "g9" }]);
    expect(await importCalendar(api, schedule)).toBe(0);
  });
  it("sweeps duplicate gcalId copies, keeping the first (self-healing)", async () => {
    // The bug this heals: a cold listEvents() read let repeated connects
    // import the same brief a dozen times, all flagged Overlaps.
    const schedule = new ScheduleService(new Store(new InMemoryAdapter()), "u");
    for (let i = 0; i < 12; i++) {
      await schedule.createEvent("Jarvis AM Brief", { date: "2026-08-04", start: "00:00", gcalId: "brief_1" });
    }
    await schedule.createEvent("Dentist", { date: "2026-08-05", start: "09:00", gcalId: "g_dent" });
    await schedule.createEvent("Manual thing", { date: "2026-08-05", start: "10:00" }); // no gcalId: untouched
    const api = apiWith([{ id: "g_dent", summary: "Dentist", start: { dateTime: "2026-08-05T09:00:00Z" } }]);
    expect(await importCalendar(api, schedule)).toBe(0); // nothing new
    const all = await schedule.listEvents();
    expect(all.filter((e) => e.data.gcalId === "brief_1").length).toBe(1);
    expect(all.filter((e) => e.data.title === "Manual thing").length).toBe(1);
    expect(all.length).toBe(3);
  });

  it("sweeps same-slot copies under DIFFERENT gcal ids, and refuses to re-import into an occupied slot", async () => {
    // The case the id-only sweep missed: 26 separate Google events, all
    // "Jarvis AM Brief" at the same date+time, each with its own id.
    const schedule = new ScheduleService(new Store(new InMemoryAdapter()), "u");
    for (let i = 0; i < 5; i++) {
      await schedule.createEvent("Jarvis AM Brief", { date: "2026-08-04", start: "00:00", gcalId: "brief_" + i });
    }
    // Same title, different day: legitimate, must survive.
    await schedule.createEvent("Jarvis AM Brief", { date: "2026-08-05", start: "00:00", gcalId: "brief_next" });
    const api = apiWith([
      { id: "brief_99", summary: "Jarvis AM Brief", start: { dateTime: "2026-08-04T00:00:00" } }, // occupied slot: skipped
      { id: "g_new", summary: "Dentist", start: { dateTime: "2026-08-06T09:00:00" } },            // genuinely new: imported
    ]);
    expect(await importCalendar(api, schedule)).toBe(1);
    const all = await schedule.listEvents();
    expect(all.filter((e) => e.data.title === "Jarvis AM Brief" && e.data.date === "2026-08-04").length).toBe(1);
    expect(all.filter((e) => e.data.title === "Jarvis AM Brief" && e.data.date === "2026-08-05").length).toBe(1);
    expect(all.filter((e) => e.data.title === "Dentist").length).toBe(1);
  });

  it("the slot sweep never touches user-created events, even identical ones", async () => {
    const schedule = new ScheduleService(new Store(new InMemoryAdapter()), "u");
    await schedule.createEvent("Standup", { date: "2026-08-04", start: "09:00" }); // user's own
    await schedule.createEvent("Standup", { date: "2026-08-04", start: "09:00" }); // user's own duplicate: their business
    expect(await importCalendar(apiWith([]), schedule)).toBe(0);
    expect((await schedule.listEvents()).length).toBe(2);
  });

  it("cold-read guard: after a past import, an empty store is re-read before re-importing", async () => {
    const store = new Store(new InMemoryAdapter());
    const schedule = new ScheduleService(store, "u");
    const api = apiWith([{ id: "g1", summary: "Standup", start: { dateTime: "2026-06-01T09:00:00Z" } }]);
    let mark: string | null = null;
    const storage = { getItem: () => mark, setItem: (_k: string, v: string) => { mark = v; } };
    expect(await importCalendar(api, schedule, 25, storage)).toBe(1);
    expect(mark).toBe("1"); // marker set after a real import

    // Simulate the cold read: listEvents empty at first, real after a beat.
    const real = schedule.listEvents.bind(schedule);
    let cold = 2;
    const coldSchedule = Object.assign(Object.create(Object.getPrototypeOf(schedule)) as ScheduleService, schedule, {
      listEvents: async () => (cold-- > 0 ? [] : real()),
    });
    const waits: number[] = [];
    expect(await importCalendar(api, coldSchedule, 25, storage, async (ms) => { waits.push(ms); })).toBe(0);
    expect(waits.length).toBe(2); // it waited out the cold reads instead of duplicating
    expect((await schedule.listEvents()).length).toBe(1);
  });

  it("without the marker, an empty store imports immediately (first connect is not slowed)", async () => {
    const schedule = new ScheduleService(new Store(new InMemoryAdapter()), "u");
    const api = apiWith([{ id: "g1", summary: "Standup", start: { dateTime: "2026-06-01T09:00:00Z" } }]);
    const waits: number[] = [];
    const storage = { getItem: () => null, setItem: () => {} };
    expect(await importCalendar(api, schedule, 25, storage, async (ms) => { waits.push(ms); })).toBe(1);
    expect(waits.length).toBe(0);
  });

  it("lists mail as display rows", async () => {
    const api = apiWith([], [
      { id: "m1", snippet: "hey", payload: { headers: [{ name: "Subject", value: "Hi" }, { name: "From", value: "A <a@b.com>" }] } },
    ]);
    expect(await listMail(api)).toEqual([{ id: "m1", from: "A", subject: "Hi", snippet: "hey" }]);
  });
});
