import { describe, it, expect } from "vitest";
import { comingUpFor, gymDoorOn } from "./comingUp";
import type { EventItem } from "../schedule/types";
import { addDays } from "../schedule/calendar";

// BRAIN-F-07 (2026-09-05): the area page compared an event's anchor date to
// today, so nothing that repeats was ever "coming up", and the Health hero
// called the first Health-tagged event of the day "the gym block".

const TODAY = "2026-09-05"; // a Saturday

function ev(id: string, over: Partial<EventItem["data"]> = {}): EventItem {
  return { id, data: { title: id, date: TODAY, start: "09:00", category: "health", ...over } };
}

describe("comingUpFor", () => {
  it("finds a weekly series anchored weeks ago and dates it to its next run", () => {
    const practice = ev("practice", { title: "Practice", date: "2026-08-15", start: "17:00", recurrence: "weekly" });
    const rows = comingUpFor([practice], "health", TODAY);
    expect(rows).toHaveLength(1);
    // 2026-08-15 is a Saturday, so is today.
    expect(rows[0]).toMatchObject({ id: "practice", title: "Practice", date: TODAY, start: "17:00" });
  });

  it("lists a repeating block once, not once per day it lands on", () => {
    const gym = ev("gym", { title: "Gym", date: "2026-07-01", start: "06:00", recurrence: "daily" });
    const dentist = ev("dentist", { title: "Dentist", date: addDays(TODAY, 2), start: "14:30" });
    const rows = comingUpFor([gym, dentist], "health", TODAY);
    expect(rows.map((r) => r.id)).toEqual(["gym", "dentist"]);
  });

  it("keeps the old behaviour for one-off events: today counts, yesterday does not", () => {
    const past = ev("past", { date: addDays(TODAY, -1) });
    const now = ev("now", { date: TODAY });
    const soon = ev("soon", { date: addDays(TODAY, 3) });
    expect(comingUpFor([past, now, soon], "health", TODAY).map((r) => r.id)).toEqual(["now", "soon"]);
  });

  it("stays inside the category and inside the window", () => {
    const other = ev("other", { category: "work", date: addDays(TODAY, 1) });
    const faraway = ev("faraway", { date: addDays(TODAY, 30) });
    expect(comingUpFor([other, faraway], "health", TODAY)).toEqual([]);
  });

  it("caps the list and takes the earliest", () => {
    const rows = comingUpFor([1, 2, 3, 4, 5].map((n) => ev("e" + n, { date: addDays(TODAY, n) })), "health", TODAY);
    expect(rows.map((r) => r.id)).toEqual(["e1", "e2", "e3", "e4"]);
  });
});

describe("gymDoorOn", () => {
  it("finds the recurring block marked gym, whatever it is anchored on", () => {
    const gym = ev("gym", { title: "Gym", date: "2026-07-01", start: "06:00", recurrence: "daily", gym: true });
    expect(gymDoorOn([gym], TODAY)?.id).toBe("gym");
  });

  it("never takes an unmarked health event as the gym block", () => {
    const dentist = ev("dentist", { title: "Dentist", start: "14:30" });
    expect(gymDoorOn([dentist], TODAY)).toBeNull();
  });

  it("ignores a marked block that does not land today", () => {
    const gym = ev("gym", { start: "06:00", date: "2026-09-01", gym: true });
    expect(gymDoorOn([gym], TODAY)).toBeNull();
  });

  it("takes the earliest of two marked blocks, from any category", () => {
    const evening = ev("evening", { start: "18:00", gym: true, category: "work" });
    const morning = ev("morning", { start: "06:00", gym: true, category: "" });
    expect(gymDoorOn([evening, morning], TODAY)?.id).toBe("morning");
  });
});
