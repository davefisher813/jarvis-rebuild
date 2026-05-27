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
  it("lists mail as display rows", async () => {
    const api = apiWith([], [
      { id: "m1", snippet: "hey", payload: { headers: [{ name: "Subject", value: "Hi" }, { name: "From", value: "A <a@b.com>" }] } },
    ]);
    expect(await listMail(api)).toEqual([{ id: "m1", from: "A", subject: "Hi", snippet: "hey" }]);
  });
});
