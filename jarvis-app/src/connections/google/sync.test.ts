import { Store, InMemoryAdapter } from "@core";
import { describe, it, expect, vi } from "vitest";
import { ScheduleService } from "../../schedule/ScheduleService";
import { importCalendar } from "./sync";
import { makeFakeGoogleApi } from "./fakeApi";
import type { GCalEvent, GmailMeta } from "./map";

// Phase 0 D3 (2026-10-10): memory_v1 decides whether the import stamps its
// origin. One switch the two cases below flip; every other flag answers as
// the build does.
const flags = vi.hoisted(() => ({ memoryOn: false }));
vi.mock("../../substrate/flags", async (orig) => {
  const real = await orig<typeof import("../../substrate/flags")>();
  return { ...real, flagOn: (f: Parameters<typeof real.flagOn>[0]) => (f === "memory_v1" ? flags.memoryOn : real.flagOn(f)) };
});

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
    expect((await importCalendar(api, schedule)).created).toBe(2);
    expect((await importCalendar(api, schedule)).created).toBe(0); // re-run creates nothing
    const all = await schedule.listEvents();
    expect(all.length).toBe(2);
    expect(all.some((e) => e.data.gcalId === "g1")).toBe(true);
  });
  it("skips unmappable events", async () => {
    const schedule = new ScheduleService(new Store(new InMemoryAdapter()), "u");
    const api = apiWith([{ id: "", start: { dateTime: "2026-06-01T09:00:00Z" } }, { id: "g9" }]);
    expect((await importCalendar(api, schedule)).created).toBe(0);
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
    expect((await importCalendar(api, schedule)).created).toBe(0); // nothing new
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
    expect((await importCalendar(api, schedule)).created).toBe(1);
    const all = await schedule.listEvents();
    expect(all.filter((e) => e.data.title === "Jarvis AM Brief" && e.data.date === "2026-08-04").length).toBe(1);
    expect(all.filter((e) => e.data.title === "Jarvis AM Brief" && e.data.date === "2026-08-05").length).toBe(1);
    expect(all.filter((e) => e.data.title === "Dentist").length).toBe(1);
  });

  it("the slot sweep never touches user-created events, even identical ones", async () => {
    const schedule = new ScheduleService(new Store(new InMemoryAdapter()), "u");
    await schedule.createEvent("Standup", { date: "2026-08-04", start: "09:00" }); // user's own
    await schedule.createEvent("Standup", { date: "2026-08-04", start: "09:00" }); // user's own duplicate: their business
    expect((await importCalendar(apiWith([]), schedule)).created).toBe(0);
    expect((await schedule.listEvents()).length).toBe(2);
  });

  it("cold-read guard: after a past import, an empty store is re-read before re-importing", async () => {
    const store = new Store(new InMemoryAdapter());
    const schedule = new ScheduleService(store, "u");
    const api = apiWith([{ id: "g1", summary: "Standup", start: { dateTime: "2026-06-01T09:00:00Z" } }]);
    let mark: string | null = null;
    const storage = { getItem: () => mark, setItem: (_k: string, v: string) => { mark = v; } };
    expect((await importCalendar(api, schedule, 25, storage)).created).toBe(1);
    expect(mark).toBe("1"); // marker set after a real import

    // Simulate the cold read: listEvents empty at first, real after a beat.
    const real = schedule.listEvents.bind(schedule);
    let cold = 2;
    const coldSchedule = Object.assign(Object.create(Object.getPrototypeOf(schedule)) as ScheduleService, schedule, {
      listEvents: async () => (cold-- > 0 ? [] : real()),
    });
    const waits: number[] = [];
    expect((await importCalendar(api, coldSchedule, 25, storage, async (ms) => { waits.push(ms); })).created).toBe(0);
    expect(waits.length).toBe(2); // it waited out the cold reads instead of duplicating
    expect((await schedule.listEvents()).length).toBe(1);
  });

  it("without the marker, an empty store imports immediately (first connect is not slowed)", async () => {
    const schedule = new ScheduleService(new Store(new InMemoryAdapter()), "u");
    const api = apiWith([{ id: "g1", summary: "Standup", start: { dateTime: "2026-06-01T09:00:00Z" } }]);
    const waits: number[] = [];
    const storage = { getItem: () => null, setItem: () => {} };
    expect((await importCalendar(api, schedule, 25, storage, async (ms) => { waits.push(ms); })).created).toBe(1);
    expect(waits.length).toBe(0);
  });
});

// PLUMB-F-07 (2026-09-05): the importer was create-only. A meeting moved in
// Google stayed where it was here, with Leave By and reminders firing for the
// wrong day; a cancelled meeting stayed on the schedule; and only the next 25
// upcoming events ever arrived.
describe("google sync keeps up with changes", () => {
  // Ten in the morning, so "earlier today" and "later today" are both real.
  const NOW = new Date(2026, 8, 5, 10, 0, 0);
  const hash = (t: string, d: string, s: string, e = "", l = "") => JSON.stringify([t, d, s, e, l]);
  const run = (api: ReturnType<typeof apiWith>, schedule: ScheduleService) =>
    importCalendar(api, schedule, 250, { getItem: () => null, setItem: () => {} }, async () => {}, NOW);

  function rig() {
    return new ScheduleService(new Store(new InMemoryAdapter()), "u");
  }

  it("a meeting moved in Google moves here, and keeps the category he filed it under", async () => {
    const schedule = rig();
    await schedule.createEvent("Standup", {
      date: "2026-09-08", start: "15:00", category: "cat-work",
      gcalId: "g1", gcalHash: hash("Standup", "2026-09-08", "15:00"),
    });
    const api = apiWith([{ id: "g1", summary: "Standup", start: { dateTime: "2026-09-10T16:00:00" } }]);
    const s = await run(api, schedule);
    expect(s).toEqual({ created: 0, updated: 1, removed: 0 });
    const all = await schedule.listEvents();
    expect(all.length).toBe(1);
    expect(all[0]!.data.date).toBe("2026-09-10");
    expect(all[0]!.data.start).toBe("16:00");
    expect(all[0]!.data.category).toBe("cat-work"); // his filing, not Google's business
  });

  it("a field he changed here is never clobbered, while the rest still follows Google", async () => {
    const schedule = rig();
    // Google said "Standup"; he renamed it here. The record still says Standup.
    await schedule.createEvent("Standup with Coach", {
      date: "2026-09-08", start: "15:00",
      gcalId: "g1", gcalHash: hash("Standup", "2026-09-08", "15:00"),
    });
    const api = apiWith([{ id: "g1", summary: "Standup", start: { dateTime: "2026-09-10T16:00:00" } }]);
    await run(api, schedule);
    const e = (await schedule.listEvents())[0]!;
    expect(e.data.title).toBe("Standup with Coach");
    expect(e.data.date).toBe("2026-09-10");
    // And it stays his, import after import.
    await run(api, schedule);
    expect((await schedule.listEvents())[0]!.data.title).toBe("Standup with Coach");
  });

  it("an event Google calls off leaves the schedule", async () => {
    const schedule = rig();
    await schedule.createEvent("Review", { date: "2026-09-09", start: "11:00", gcalId: "g1", gcalHash: hash("Review", "2026-09-09", "11:00") });
    await schedule.createEvent("Standup", { date: "2026-09-09", start: "09:00", gcalId: "g2", gcalHash: hash("Standup", "2026-09-09", "09:00") });
    const api = apiWith([
      { id: "g1", status: "cancelled" },
      { id: "g2", summary: "Standup", start: { dateTime: "2026-09-09T09:00:00" } },
    ]);
    const s = await run(api, schedule);
    expect(s.removed).toBe(1);
    expect((await schedule.listEvents()).map((e) => e.data.gcalId)).toEqual(["g2"]);
  });

  it("an event that vanished from the window it covers is removed", async () => {
    const schedule = rig();
    await schedule.createEvent("Review", { date: "2026-09-09", start: "11:00", gcalId: "g1", gcalHash: hash("Review", "2026-09-09", "11:00") });
    await schedule.createEvent("Standup", { date: "2026-09-09", start: "09:00", gcalId: "g2", gcalHash: hash("Standup", "2026-09-09", "09:00") });
    const api = apiWith([{ id: "g2", summary: "Standup", start: { dateTime: "2026-09-09T09:00:00" } }]);
    expect((await run(api, schedule)).removed).toBe(1);
    expect((await schedule.listEvents()).map((e) => e.data.gcalId)).toEqual(["g2"]);
  });

  it("what the window cannot vouch for is left alone: earlier today, last month, next year", async () => {
    const schedule = rig();
    await schedule.createEvent("This morning", { date: "2026-09-05", start: "08:00", gcalId: "g_am" });
    await schedule.createEvent("Last month", { date: "2026-08-04", start: "09:00", gcalId: "g_old" });
    await schedule.createEvent("Next year", { date: "2027-03-01", start: "09:00", gcalId: "g_far" });
    const api = apiWith([{ id: "g2", summary: "Standup", start: { dateTime: "2026-09-09T09:00:00" } }]);
    expect((await run(api, schedule)).removed).toBe(0);
    expect((await schedule.listEvents()).length).toBe(4); // three kept, plus the new one
  });

  it("an empty answer from Google removes nothing: absence proves nothing when nothing came back", async () => {
    const schedule = rig();
    await schedule.createEvent("Review", { date: "2026-09-09", start: "11:00", gcalId: "g1", gcalHash: hash("Review", "2026-09-09", "11:00") });
    expect((await run(apiWith([]), schedule)).removed).toBe(0);
    expect((await schedule.listEvents()).length).toBe(1);
  });

  it("a feed that came back full stops vouching at the last day it returned", async () => {
    const schedule = rig();
    await schedule.createEvent("Beyond the page", { date: "2026-09-20", start: "09:00", gcalId: "g_beyond", gcalHash: hash("Beyond the page", "2026-09-20", "09:00") });
    const api = apiWith([
      { id: "g_a", summary: "A", start: { dateTime: "2026-09-06T09:00:00" } },
      { id: "g_b", summary: "B", start: { dateTime: "2026-09-20T08:00:00" } },
    ]);
    // max 2, and the feed returned 2: it was almost certainly truncated.
    const s = await importCalendar(api, schedule, 2, { getItem: () => null, setItem: () => {} }, async () => {}, NOW);
    expect(s.removed).toBe(0);
    expect(s.created).toBe(2);
  });

  it("the duplicate sweep keeps the copy he worked on, not whichever came first", async () => {
    const schedule = rig();
    const bare = await schedule.createEvent("Practice", { date: "2026-09-09", start: "16:00", gcalId: "g1" });
    const filed = await schedule.createEvent("Practice", { date: "2026-09-09", start: "16:00", gcalId: "g1", category: "cat-squad" });
    expect(bare).not.toBe(filed);
    const api = apiWith([{ id: "g1", summary: "Practice", start: { dateTime: "2026-09-09T16:00:00" } }]);
    await run(api, schedule);
    const all = await schedule.listEvents();
    expect(all.length).toBe(1);
    expect(all[0]!.id).toBe(filed);
    expect(all[0]!.data.category).toBe("cat-squad");
  });

  it("asks Google for a real window and for more than a couple of dozen events", async () => {
    const schedule = rig();
    const seen: { max: number; opts?: { timeMaxISO?: string; showDeleted?: boolean } }[] = [];
    const api = makeFakeGoogleApi({
      listUpcomingEvents: async (max, opts) => { seen.push({ max, opts }); return []; },
    });
    await importCalendar(api, schedule, undefined, { getItem: () => null, setItem: () => {} }, async () => {}, NOW);
    expect(seen[0]!.max).toBeGreaterThan(25);
    expect(seen[0]!.opts?.showDeleted).toBe(true);
    // Sixty days out, so a meeting two months away is inside what it covers.
    expect(seen[0]!.opts?.timeMaxISO?.slice(0, 10)).toBe(new Date(2026, 10, 4, 10, 0, 0).toISOString().slice(0, 10));
  });
});

// Phase 0 D3 (2026-10-10): an imported event says where it came from. The
// create wrote gcalId and no source, so "From Google Calendar" (provenance.ts)
// was never earned and every imported event read as hand drawn. Behind
// memory_v1, because 105 live events would start rendering the line.
describe("google sync stamps its origin behind memory_v1", () => {
  const brief = (): GCalEvent => ({ id: "g1", summary: "Standup", start: { dateTime: "2026-06-01T09:00:00Z" } });

  it("flag on: a created event carries madeBy google_calendar with the gcal id as its ref", async () => {
    flags.memoryOn = true;
    try {
      const schedule = new ScheduleService(new Store(new InMemoryAdapter()), "u");
      expect((await importCalendar(apiWith([brief()]), schedule)).created).toBe(1);
      const [e] = await schedule.listEvents();
      expect(e!.data.source).toMatchObject({ type: "google_calendar", ref: "g1" });
      expect(typeof e!.data.source!.ts).toBe("number");
    } finally {
      flags.memoryOn = false;
    }
  });

  it("flag off: the create is byte for byte what it was, no source", async () => {
    flags.memoryOn = false;
    const schedule = new ScheduleService(new Store(new InMemoryAdapter()), "u");
    expect((await importCalendar(apiWith([brief()]), schedule)).created).toBe(1);
    const [e] = await schedule.listEvents();
    expect(e!.data.gcalId).toBe("g1");
    expect("source" in e!.data).toBe(false);
  });

  it("flag on: an update to an event imported before the flag leaves it unstamped, since only the create path stamps", async () => {
    const schedule = new ScheduleService(new Store(new InMemoryAdapter()), "u");
    await importCalendar(apiWith([brief()]), schedule);
    flags.memoryOn = true;
    try {
      await importCalendar(apiWith([{ ...brief(), summary: "Standup Moved" }]), schedule);
      const [e] = await schedule.listEvents();
      expect(e!.data.title).toBe("Standup Moved");
      expect("source" in e!.data).toBe(false);
    } finally {
      flags.memoryOn = false;
    }
  });
});
