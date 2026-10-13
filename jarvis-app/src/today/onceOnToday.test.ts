// ISSUE 112 (ruling 18, Dave 2026-10-13): a task or an event that came from an email is on Today exactly once, as a
// normal one. These are the pure rules: the seal by id, and the one pair that has two ids (the same appointment made by
// the Google import and by an email). The page-level proof is TodayFlow.email.test.tsx.
import { describe, it, expect } from "vitest";
import { eventsOnceOnToday, onceById } from "./onceOnToday";
import type { EventItem } from "../schedule/types";

const DAY = "2026-10-13";
const mail = { type: "email" as const, ref: "thread-1", ts: 1 };
const ev = (id: string, d: Partial<EventItem["data"]> = {}): EventItem => ({ id, data: { title: id, date: DAY, start: "11:30", end: "12:00", category: "", ...d } as EventItem["data"] });
const ids = (list: readonly { id: string }[]) => list.map((e) => e.id);

describe("onceById: the first of each id, in the order given", () => {
  it("keeps the first of a repeated id and the order of the rest", () => {
    const a = { id: "a", n: 1 }, b = { id: "b", n: 2 }, again = { id: "a", n: 3 };
    expect(onceById([a, b, again])).toEqual([a, b]);
    expect(onceById([b, a, again])).toEqual([b, a]);
    expect(onceById([])).toEqual([]);
  });
  it("draws an id once even when two lists were joined", () => {
    const today = [ev("e1"), ev("e2")];
    const alsoToday = [ev("e2"), ev("e3")];
    expect(ids(onceById([...today, ...alsoToday]))).toEqual(["e1", "e2", "e3"]);
  });
});

describe("eventsOnceOnToday: one appointment through two doors is drawn once", () => {
  it("a Google copy and an email-approved copy with alike titles at one start: the approved email copy remains", () => {
    const google = ev("g", { title: "Phone Interview with Equinox", gcalId: "gcal-1" });
    const approved = ev("m", { title: "Phone Interview", clientId: "emailcap_1", source: mail });
    expect(ids(eventsOnceOnToday([google, approved]))).toEqual(["m"]);
    expect(ids(eventsOnceOnToday([approved, google]))).toEqual(["m"]);
  });

  it("a tie on the person's own work keeps the approved copy, and it is the same answer however the list is ordered", () => {
    const google = ev("g", { title: "Phone Interview with Equinox", gcalId: "gcal-1", category: "work" });
    const approved = ev("m", { title: "Phone Interview", clientId: "emailcap_1", source: mail, category: "work" });
    expect(ids(eventsOnceOnToday([google, approved]))).toEqual(["m"]);
    expect(ids(eventsOnceOnToday([approved, google]))).toEqual(["m"]);
  });

  it("when the Google copy carries more of the person's work (an area, attached tasks) it survives and the email copy is the hidden twin", () => {
    const google = ev("g", { title: "Phone Interview with Equinox", gcalId: "gcal-1", category: "work", taskIds: ["t1"] });
    const approved = ev("m", { title: "Phone Interview", clientId: "emailcap_1", source: mail });
    expect(ids(eventsOnceOnToday([google, approved]))).toEqual(["g"]);
    expect(ids(eventsOnceOnToday([approved, google]))).toEqual(["g"]);
  });

  it("an event made from an email by its emailIds, and one from a public booking or Apple Calendar, pair the same way", () => {
    const byIds = ev("m", { title: "Parent Teacher Conference", emailIds: ["msg-1"] });
    const booked = ev("b", { title: "Parent Teacher Conference Slot", bookingId: "bk-1" });
    expect(ids(eventsOnceOnToday([booked, byIds]))).toEqual(["m"]);
    const apple = ev("a", { title: "Parent Teacher Conference Slot", source: { type: "apple_calendar", ts: 1 } });
    expect(ids(eventsOnceOnToday([apple, byIds]))).toEqual(["m"]);
  });

  it("never collapses two Google events, two email events, a hand-made event, or two events with different starts", () => {
    expect(eventsOnceOnToday([ev("g1", { title: "Team Standup", gcalId: "a" }), ev("g2", { title: "Team Standup Prep", gcalId: "b" })]).length).toBe(2);
    expect(eventsOnceOnToday([ev("m1", { title: "Team Standup", source: mail, clientId: "c1" }), ev("m2", { title: "Team Standup Prep", source: mail, clientId: "c2" })]).length).toBe(2);
    // A hand-typed event is nobody's twin, however alike: a deliberate copy is the person's to keep.
    expect(eventsOnceOnToday([ev("h", { title: "Phone Interview with Equinox" }), ev("m", { title: "Phone Interview", source: mail, clientId: "c" })]).length).toBe(2);
    expect(eventsOnceOnToday([ev("h", { title: "Phone Interview with Equinox" }), ev("g", { title: "Phone Interview", gcalId: "x" })]).length).toBe(2);
    // The same words an hour apart are two interviews.
    expect(eventsOnceOnToday([ev("g", { title: "Phone Interview with Equinox", gcalId: "x" }), ev("m", { title: "Phone Interview", source: mail, start: "12:30" })]).length).toBe(2);
  });

  it("never collapses a recurring series, an event with no start, or the same words on different days", () => {
    const weekly = ev("g", { title: "Phone Interview with Equinox", gcalId: "x", recurrence: "weekly" });
    expect(eventsOnceOnToday([weekly, ev("m", { title: "Phone Interview", source: mail })]).length).toBe(2);
    const approvedWeekly = ev("m2", { title: "Phone Interview", source: mail, recurrence: "weekly" });
    expect(eventsOnceOnToday([ev("g2", { title: "Phone Interview with Equinox", gcalId: "x" }), approvedWeekly]).length).toBe(2);
    expect(eventsOnceOnToday([ev("g3", { title: "Phone Interview with Equinox", gcalId: "x", start: "" }), ev("m3", { title: "Phone Interview", source: mail, start: "" })]).length).toBe(2);
    expect(eventsOnceOnToday([ev("g4", { title: "Phone Interview with Equinox", gcalId: "x" }), ev("m4", { title: "Phone Interview", source: mail, date: "2026-10-14" })]).length).toBe(2);
  });

  it("never collapses titles that are only alike by a short word: the shorter side must be eight characters", () => {
    const google = ev("g", { title: "Standup Prep Team", gcalId: "x" });
    const approved = ev("m", { title: "Standup", source: mail, clientId: "c" });
    expect(ids(eventsOnceOnToday([google, approved]))).toEqual(["g", "m"]);
    expect(ids(eventsOnceOnToday([ev("g2", { title: "Dentist", gcalId: "y" }), ev("m2", { title: "Dentist Appointment", source: mail, clientId: "c2" })]))).toEqual(["g2", "m2"]);
  });

  it("an event that is both an email's and a calendar import's is neither side of a pair, so it is never hidden", () => {
    const hybrid = ev("h", { title: "Phone Interview with Equinox", gcalId: "x", source: mail });
    const approved = ev("m", { title: "Phone Interview", source: mail, clientId: "c" });
    const google = ev("g", { title: "Phone Interview with Equinox", gcalId: "y" });
    expect(ids(eventsOnceOnToday([hybrid, approved]))).toEqual(["h", "m"]);
    expect(ids(eventsOnceOnToday([hybrid, google]))).toEqual(["h", "g"]);
  });

  it("the same id twice is one, and a pair hides exactly one copy", () => {
    const a = ev("a", { title: "Dentist Appointment" });
    expect(eventsOnceOnToday([a, a, a]).length).toBe(1);
    const google = ev("g", { title: "Phone Interview with Equinox", gcalId: "x" });
    const approved = ev("m", { title: "Phone Interview", source: mail, clientId: "c" });
    expect(eventsOnceOnToday([google, approved, google, approved]).length).toBe(1);
  });

  it("the survivors keep the order they came in", () => {
    const google = ev("g", { title: "Phone Interview with Equinox", gcalId: "x" });
    const approved = ev("m", { title: "Phone Interview", source: mail, clientId: "c" });
    const early = ev("early", { title: "Breakfast", start: "08:00" });
    const late = ev("late", { title: "Dinner", start: "19:00" });
    expect(ids(eventsOnceOnToday([early, google, late, approved]))).toEqual(["early", "late", "m"]);
    expect(ids(eventsOnceOnToday([late, approved, early, google]))).toEqual(["late", "m", "early"]);
  });

  it("a list with nothing to collapse comes back whole", () => {
    const list = [ev("a", { start: "08:00" }), ev("b", { start: "09:00" }), ev("c", { start: "10:00" })];
    expect(eventsOnceOnToday(list)).toEqual(list);
    expect(eventsOnceOnToday([])).toEqual([]);
  });
});
