import { describe, it, expect } from "vitest";
import { meetingPrep, personOfEvent, PREP_WINDOW_MIN, type PrepEvent, type PrepPerson } from "./meetingPrep";

// UP-MIND-24. Walking into a call knowing the two open items and the last
// thing you wrote is the thing an assistant does. Facts only: this line
// states what is open and when you last wrote, and never advises.

const people: PrepPerson[] = [
  { id: "p1", name: "Marco Silva", email: "marco@example.com" },
  { id: "p2", name: "Nadia Brandt", email: "nadia@example.com" },
];

// The guest list rides on the event as address plus optional display name
// (UP-CORE-10's shape, which this reads rather than a second one). Only the
// address is ever matched on, so these carry nothing else.
const guests = (...emails: string[]) => emails.map((email) => ({ email }));

const ev = (over: Partial<PrepEvent> = {}): PrepEvent =>
  ({ id: "e1", title: "Sync", date: "2026-08-15", start: "10:00", ...over });

describe("who a meeting is with", () => {
  it("takes the attendee address over anything in the title", () => {
    expect(personOfEvent(ev({ title: "Sync", attendees: guests("MARCO@example.com") }), people)?.id).toBe("p1");
  });

  it("falls back to the title when there are no attendees", () => {
    expect(personOfEvent(ev({ title: "Call with Marco Silva" }), people)?.id).toBe("p1");
  });

  it("names nobody when the title could be two people", () => {
    const two = [...people, { id: "p9", name: "Marco Diaz" }];
    expect(personOfEvent(ev({ title: "Call with Marco" }), two)).toBeNull();
  });

  it("names nobody rather than guessing at a stranger", () => {
    expect(personOfEvent(ev({ attendees: guests("someone@nowhere.com") }), people)).toBeNull();
  });
});

describe("the line", () => {
  const tasks = [
    { id: "t1", text: "Send the roster", personId: "p1" },
    { id: "t2", text: "Buy milk" },
    { id: "t3", text: "Old one", personId: "p1", done: true },
  ];
  const now = Date.parse("2026-08-15T09:00:00Z");

  it("names them, counts what is open, and says when you last wrote", () => {
    const p = meetingPrep(
      [ev({ attendees: guests("marco@example.com") })], people, tasks, "2026-08-15", 9 * 60,
      () => now - 21 * 86400000, now,
    )!;
    expect(p.line).toBe("Marco Silva · 1 Open with them · Last mail 3 weeks ago");
    expect(p.open.map((o) => o.id)).toEqual(["t1"]);
  });

  it("leaves out what it does not know rather than saying it does not know", () => {
    const p = meetingPrep(
      [ev({ attendees: guests("nadia@example.com") })], people, tasks, "2026-08-15", 9 * 60,
      () => null, now,
    )!;
    expect(p.line).toBe("Nadia Brandt");
  });

  it("says nothing about a meeting past the window, or one already started", () => {
    const far = ev({ start: "23:00", attendees: guests("marco@example.com") });
    expect(meetingPrep([far], people, tasks, "2026-08-15", 9 * 60)).toBeNull();
    const gone = ev({ start: "08:00", attendees: guests("marco@example.com") });
    expect(meetingPrep([gone], people, tasks, "2026-08-15", 9 * 60)).toBeNull();
    expect(PREP_WINDOW_MIN).toBe(180);
  });

  it("says nothing at all about a meeting with nobody it knows", () => {
    expect(meetingPrep([ev()], people, tasks, "2026-08-15", 9 * 60)).toBeNull();
  });

  it("takes the soonest qualifying meeting", () => {
    const first = ev({ id: "a", start: "11:00", attendees: guests("nadia@example.com") });
    const second = ev({ id: "b", start: "10:00", attendees: guests("marco@example.com") });
    expect(meetingPrep([first, second], people, tasks, "2026-08-15", 9 * 60)!.eventId).toBe("b");
  });
});
