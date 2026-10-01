import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { ScheduleService } from "./ScheduleService";
import { createEventFromDraft } from "./eventCreate";
import type { EventDraft } from "./screens/EventSheet";

const svc = () => new ScheduleService(new Store(new InMemoryAdapter()), "u");
const draft = (over: Partial<EventDraft> = {}): EventDraft => ({
  title: "Coffee With Sam", date: "2026-10-01", start: "15:00", end: "15:45", category: "", location: "", recurrence: "none", ...over,
});

// SCHEDULE AUDIT 2026-10-01, item 8: Today's New Event writes through the same
// field list the Schedule tab's "+" does.
describe("createEventFromDraft", () => {
  it("creates the event on the draft's date with its times", async () => {
    const s = svc();
    const id = await createEventFromDraft(draft(), s);
    expect(id).toBeTruthy();
    const e = (await s.event(id!))!;
    expect([e.title, e.date, e.start, e.end]).toEqual(["Coffee With Sam", "2026-10-01", "15:00", "15:45"]);
  });

  it("carries the repeat, the place, the meeting link and the Training Door", async () => {
    const s = svc();
    const id = (await createEventFromDraft(draft({
      title: "Lift", recurrence: "weekly", until: "2026-12-01", location: "Gym", url: "https://zoom.us/j/1", notes: "bring belt", gym: true,
    }), s))!;
    const e = (await s.event(id))!;
    expect(e.recurrence).toBe("weekly");
    expect(e.until).toBe("2026-12-01");
    expect(e.location).toBe("Gym");
    expect(e.url).toBe("https://zoom.us/j/1");
    expect(e.gym).toBe(true);
  });

  it("an empty end is no end", async () => {
    const s = svc();
    const id = (await createEventFromDraft(draft({ end: "" }), s))!;
    expect((await s.event(id))!.end || "").toBe("");
  });
});
