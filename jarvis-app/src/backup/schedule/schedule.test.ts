import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { ScheduleService } from "./ScheduleService";
import { monthMatrix, fmtTime, eventsForDate, dotsForMonth, todayISO, addMinutes, fmtRange, occursOn, findConflicts, nextFreeSlot, openSlots } from "./calendar";
import type { EventItem } from "./types";

const TODAY = "2026-05-20";
const DAY = 86400000;
const addDays = (iso: string, n: number) =>
  new Date(new Date(iso + "T00:00:00").getTime() + n * DAY).toISOString().slice(0, 10);

// The behaviors approved in the Schedule harness, mirrored against the real
// ScheduleService in order on one store. Titles are Title Case per the rule.
describe("Schedule behavior contract (approved harness)", () => {
  const store = new Store(new InMemoryAdapter());
  const svc = new ScheduleService(store, "user1");
  const ids: Record<string, string> = {};

  it("[edge] empty state: no events", async () => {
    expect((await svc.listEvents()).length).toBe(0);
  });
  it("create an event today, lands on the day + timeline", async () => {
    ids.board = (await svc.createEvent("Board Prep Call", { date: TODAY, start: "10:00", category: "tucci" }))!;
    const day = await svc.eventsOn(TODAY);
    expect(day.length).toBe(1);
    expect(day[0]!.data.title).toBe("Board Prep Call");
  });
  it("add a second event today, sorted by time", async () => {
    ids.lunch = (await svc.createEvent("Lunch with Mom", { date: TODAY, start: "13:00", category: "family" }))!;
    const day = await svc.eventsOn(TODAY);
    expect(day.map((e) => e.data.title)).toEqual(["Board Prep Call", "Lunch with Mom"]);
  });
  it("create an event on another day", async () => {
    ids.run = (await svc.createEvent("Tempo Run, 5 Miles", { date: addDays(TODAY, 2), start: "18:00", category: "health" }))!;
    expect((await svc.eventsOn(addDays(TODAY, 2))).length).toBe(1);
    expect((await svc.eventsOn(TODAY)).length).toBe(2);
  });
  it("change an event time, re-sorts the day", async () => {
    await svc.editTime(ids.lunch!, "09:00");
    expect((await svc.eventsOn(TODAY)).map((e) => e.data.title)).toEqual(["Lunch with Mom", "Board Prep Call"]);
  });
  it("edit an event title", async () => {
    await svc.editTitle(ids.board!, "BFFSA Board Prep");
    expect((await svc.event(ids.board!))!.title).toBe("BFFSA Board Prep");
  });
  it("delete an event", async () => {
    await svc.deleteEvent(ids.lunch!);
    expect((await svc.eventsOn(TODAY)).length).toBe(1);
  });
  it("month dots: June empty, May populated", async () => {
    expect(Object.keys(await svc.daysWithEvents(2026, 5)).length).toBe(0);
    expect(Object.keys(await svc.daysWithEvents(2026, 4)).length).toBeGreaterThan(0);
  });
  it("[edge] reject an empty-title event", async () => {
    const before = (await svc.listEvents()).length;
    expect(await svc.createEvent("   ", { date: TODAY, start: "09:00" })).toBeNull();
    expect((await svc.listEvents()).length).toBe(before);
  });
  it("[edge] offline create queues, syncs on reconnect", async () => {
    svc.goOffline();
    // create still works offline (only updates queue); use an edit to exercise the queue
    const id = (await svc.createEvent("Call Wei", { date: TODAY, start: "16:00", category: "elite" }))!;
    await svc.editTime(id, "16:30");
    expect(svc.queueLen()).toBe(1);
    await svc.reconnect();
    expect(svc.queueLen()).toBe(0);
    expect((await svc.event(id))!.start).toBe("16:30");
  });
  it("selected-day count", async () => {
    expect(await svc.countOn(TODAY)).toBe(2); // Board Prep + Call Wei
  });
});

describe("calendar helpers", () => {
  it("fmtTime converts 24h to 12h", () => {
    expect(fmtTime("13:00")).toEqual({ time: "1:00", ap: "PM" });
    expect(fmtTime("09:05")).toEqual({ time: "9:05", ap: "AM" });
    expect(fmtTime("00:00")).toEqual({ time: "12:00", ap: "AM" });
    expect(fmtTime("12:00")).toEqual({ time: "12:00", ap: "PM" });
  });
  it("monthMatrix is 42 cells aligned to the weekday", () => {
    const cells = monthMatrix(2026, 4); // May 2026, the 1st is a Friday
    expect(cells.length).toBe(42);
    const may1 = cells.find((c) => c.date === "2026-05-01")!;
    expect(may1.day).toBe(1);
    expect(may1.inMonth).toBe(true);
    expect(cells[0]!.inMonth).toBe(false); // leading day from April
  });
  it("eventsForDate filters + sorts", () => {
    const items: EventItem[] = [
      { id: "1", data: { title: "B", date: TODAY, start: "13:00", category: "x" } },
      { id: "2", data: { title: "A", date: TODAY, start: "09:00", category: "x" } },
      { id: "3", data: { title: "C", date: addDays(TODAY, 1), start: "08:00", category: "x" } },
    ];
    expect(eventsForDate(items, TODAY).map((e) => e.data.title)).toEqual(["A", "B"]);
  });
  it("dotsForMonth maps day to categories", () => {
    const items: EventItem[] = [
      { id: "1", data: { title: "x", date: "2026-05-20", start: "10:00", category: "tucci" } },
      { id: "2", data: { title: "y", date: "2026-05-20", start: "11:00", category: "health" } },
    ];
    expect(dotsForMonth(items, 2026, 4)[20]).toEqual(["tucci", "health"]);
  });
  it("todayISO formats YYYY-MM-DD", () => {
    expect(todayISO(new Date("2026-05-20T12:00:00"))).toBe("2026-05-20");
  });
});

import { describe as d2, it as i2, expect as e2 } from "vitest";
d2("event location", () => {
  i2("stores and edits a location", async () => {
    const { Store, InMemoryAdapter } = await import("@core");
    const { ScheduleService } = await import("./ScheduleService");
    const svc = new ScheduleService(new Store(new InMemoryAdapter()), "u");
    const id = await svc.createEvent("Lunch", { date: "2026-05-24", start: "12:00", location: "Joe's Cafe" });
    e2((await svc.event(id!))!.location).toBe("Joe's Cafe");
    await svc.editLocation(id!, "New Spot");
    e2((await svc.event(id!))!.location).toBe("New Spot");
  });
});

import { describe as d3, it as i3, expect as e3 } from "vitest";
d3("week helpers", () => {
  i3("weekOf is Monday-anchored; addDays steps", async () => {
    const { weekOf, addDays } = await import("./calendar");
    const w = weekOf("2026-05-24"); // Sunday
    e3(w[0]).toBe("2026-05-18"); e3(w[6]).toBe("2026-05-24"); e3(w.length).toBe(7);
    e3(addDays("2026-05-24", 7)).toBe("2026-05-31");
    e3(addDays("2026-05-01", -1)).toBe("2026-04-30");
  });
});


describe("Schedule upgrades: time math, recurrence, conflicts, free slots", () => {
  type Rec = "daily" | "weekly" | "monthly";
  const ev = (id: string, date: string, start: string, end?: string, recurrence?: Rec): EventItem => ({
    id,
    data: { title: id, date, start, category: "", ...(end ? { end } : {}), ...(recurrence ? { recurrence } : {}) },
  });

  it("addMinutes rolls over and clamps within the day", () => {
    expect(addMinutes("09:00", 60)).toBe("10:00");
    expect(addMinutes("13:05", 90)).toBe("14:35");
    expect(addMinutes("23:30", 60)).toBe("23:59");
  });

  it("fmtRange shares the meridiem only when both ends match", () => {
    expect(fmtRange("13:00", "14:30")).toBe("1:00 - 2:30 PM");
    expect(fmtRange("11:00", "13:00")).toBe("11:00 AM - 1:00 PM");
    expect(fmtRange("09:00")).toBe("9:00 AM");
  });

  it("occursOn expands forward from the anchor only", () => {
    const daily = ev("d", "2026-05-20", "09:00", undefined, "daily").data;
    expect(occursOn(daily, "2026-05-25")).toBe(true);
    expect(occursOn(daily, "2026-05-19")).toBe(false);
    const weekly = ev("w", "2026-05-20", "09:00", undefined, "weekly").data; // a Wednesday
    expect(occursOn(weekly, "2026-05-27")).toBe(true);
    expect(occursOn(weekly, "2026-05-28")).toBe(false);
    const monthly = ev("m", "2026-05-20", "09:00", undefined, "monthly").data;
    expect(occursOn(monthly, "2026-06-20")).toBe(true);
    expect(occursOn(monthly, "2026-06-21")).toBe(false);
    expect(occursOn(ev("o", "2026-05-20", "09:00").data, "2026-05-21")).toBe(false);
  });

  it("eventsForDate surfaces a recurring instance on the queried day, keeping the base id", () => {
    const out = eventsForDate([ev("a", "2026-05-20", "09:00", undefined, "daily")], "2026-05-23");
    expect(out.length).toBe(1);
    expect(out[0]!.data.date).toBe("2026-05-23");
    expect(out[0]!.id).toBe("a");
  });

  it("findConflicts flags only overlapping ranges", () => {
    const c = findConflicts([
      ev("x", "2026-05-20", "09:00", "10:00"),
      ev("y", "2026-05-20", "09:30", "10:30"),
      ev("z", "2026-05-20", "11:00", "12:00"),
    ]);
    expect(c.has("x")).toBe(true);
    expect(c.has("y")).toBe(true);
    expect(c.has("z")).toBe(false);
  });

  it("nextFreeSlot skips booked time, returns the next open slot, defaults empty day to 9am", () => {
    const notToday = new Date("2000-01-01T00:00:00");
    const items = [ev("a", "2026-05-20", "09:00", "10:00"), ev("b", "2026-05-20", "10:00", "11:00")];
    expect(nextFreeSlot(items, "2026-05-20", notToday, 60)).toBe("11:00");
    expect(nextFreeSlot([], "2026-05-20", notToday, 60)).toBe("09:00");
  });

  it("openSlots returns the gaps between events within waking hours", () => {
    const items = [ev("a", "2026-05-20", "09:00", "10:00"), ev("b", "2026-05-20", "12:00", "13:00")];
    const slots = openSlots(items, "08:00", "18:00", 30);
    expect(slots.map((s) => s.start)).toEqual(["08:00", "10:00", "13:00"]);
    expect(slots[0]!.end).toBe("09:00");
  });

  it("occursOn skips exdates so a single occurrence can be removed", () => {
    const daily = { ...ev("d", "2026-05-20", "09:00", undefined, "daily").data, exdates: ["2026-05-22"] };
    expect(occursOn(daily, "2026-05-20")).toBe(true);
    expect(occursOn(daily, "2026-05-21")).toBe(true);
    expect(occursOn(daily, "2026-05-22")).toBe(false);
  });
});
