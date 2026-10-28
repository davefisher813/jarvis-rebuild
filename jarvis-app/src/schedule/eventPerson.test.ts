import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { ScheduleService } from "./ScheduleService";
import { createEventFromDraft } from "./eventCreate";
import { carriedFields } from "./dayEdit";
import { openWith } from "../people/mentions";
import { personOfEvent } from "../today/meetingPrep";
import type { EventDraft } from "./screens/EventSheet";

// WHO AN EVENT IS WITH (Dave, 2026-10-27): chosen on the sheet, stored on the event, taken off with None. Never read from the title.
const svc = () => new ScheduleService(new Store(new InMemoryAdapter()), "u");
const draft = (over: Partial<EventDraft> = {}): EventDraft => ({
  title: "Catch Up", date: "2026-10-30", start: "15:00", end: "15:45", category: "", location: "", recurrence: "none", ...over,
});

describe("an event's person", () => {
  it("is written at creation from the draft, and only when one was chosen", async () => {
    const s = svc();
    const withP = (await s.event((await createEventFromDraft(draft({ personId: "josh-r" }), s))!))!;
    expect(withP.personId).toBe("josh-r");
    const without = (await s.event((await createEventFromDraft(draft({ personId: "" }), s))!))!;
    expect(without.personId).toBeUndefined();
  });

  it("is changed by editPerson, and taken off by null", async () => {
    const s = svc();
    const id = (await createEventFromDraft(draft({ personId: "josh-b" }), s))!;
    expect(await s.editPerson(id, "josh-r")).toBe(true);
    expect((await s.event(id))!.personId).toBe("josh-r");
    expect(await s.editPerson(id, null)).toBe(true);
    expect((await s.event(id))!.personId).toBeUndefined();
  });

  it("rides a copy of the event", async () => {
    const s = svc();
    const id = (await createEventFromDraft(draft({ personId: "josh-r" }), s))!;
    expect(carriedFields((await s.event(id))!)).toMatchObject({ personId: "josh-r" });
  });

  it("puts the event on that person's card whatever its title says, and not on another's", () => {
    const events = [{ id: "e1", title: "Dinner", date: "2026-10-30", personId: "josh-r" }];
    expect(openWith({ id: "josh-r", name: "Josh Rudd" }, [], events, "2026-10-28").map((m) => m.id)).toEqual(["e1"]);
    expect(openWith({ id: "josh-b", name: "Josh (Bucknell)" }, [], events, "2026-10-28")).toEqual([]);
  });

  it("is the person a meeting prep names, ahead of any reading of the guests or the title", () => {
    const people = [{ id: "josh-b", name: "Josh (Bucknell)" }, { id: "josh-r", name: "Josh Rudd" }];
    const e = { id: "e1", title: "Call with Josh", date: "2026-10-30", start: "15:00", personId: "josh-r" };
    expect(personOfEvent(e, people)?.id).toBe("josh-r");
    // With no chosen person the old reading stands, and two Joshes name nobody.
    expect(personOfEvent({ ...e, personId: undefined }, people)).toBeNull();
  });
});
