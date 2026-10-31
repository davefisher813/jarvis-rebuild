import { describe, it, expect } from "vitest";
import { normalizeSpoken, partOfDayTime } from "../paste/spoken";
import { classifyLine } from "../paste/deterministic";
import { readQuestion } from "./intent";
import { readSpokenSet } from "./spokenSet";
import { STARTER_EXERCISES } from "../gym/starterLibrary";

// THE SPEECH BOX BATTERY (the 2026-10-28 live test, JARVIS-The-Record). Eleven hard cases were run in the app and six failed:
// both workout sets and both questions became Notes, a reminder landed on the wrong day repeating every day, and a correction
// made a second item. Each failure is pinned here by the words that failed, so it cannot come back. The correction case is
// pinned in paste/correction.test.ts (2026-10-27).

const TODAY = "2026-10-28"; // a Wednesday, the day of the test
const NAMES = STARTER_EXERCISES.map((e) => e.name);

describe("speech is read as written", () => {
  it("a.m. and p.m. with their dots, said numbers, and dollars", () => {
    expect(normalizeSpoken("Dinner with Marco Thursday 7 p.m.")).toBe("Dinner with Marco Thursday 7 pm");
    expect(normalizeSpoken("call at seven thirty pm")).toBe("call at 7:30pm");
    expect(normalizeSpoken("spent 42 dollars on gas")).toBe("spent $42 on gas");
    expect(normalizeSpoken("meet at 7 30 pm")).toBe("meet at 7:30 pm");
  });

  it("never invents a value: a bare seven stays seven", () => {
    expect(normalizeSpoken("meet Marco at seven")).toBe("meet Marco at seven");
    expect(normalizeSpoken("I read a.m. radio")).toBe("I read a.m. radio");
  });

  it("the part of the day a reminder names", () => {
    expect(partOfDayTime("remind me tomorrow morning", "07:30")).toEqual({ hhmm: "07:30", text: "morning" });
    expect(partOfDayTime("remind me this evening")?.hhmm).toBe("18:00");
    expect(partOfDayTime("remind me to call")).toBeNull();
  });
});

describe("the eleven cases, by the words that were said", () => {
  it("Dave's own line: Dinner with Marco Thursday 7 p.m. is an Event, never a Note", () => {
    for (const said of ["Dinner with Marco Thursday 7:00 PM", "Dinner with Marco Thursday 7 p.m.", "dinner with marco thursday at seven pm"]) {
      expect(classifyLine(said, TODAY)).toMatchObject({ kind: "event", title: "Dinner with Marco", date: "2026-10-29", start: "19:00", confident: true });
    }
  });

  it("1. a workout set is a set", () => {
    expect(readSpokenSet("Log a set. Deadlift, 405 pounds, 5 reps.", NAMES)).toEqual({ name: "Deadlift", known: true, w: 405, r: 5, sets: 1, unit: "lb" });
  });

  it("2. three sets of ten at a weight is three sets, and keeps the equipment word", () => {
    expect(readSpokenSet("I did 3 sets of 10 kettlebell swings at 53 pounds.", NAMES)).toEqual({ name: "Kettlebell Swing", known: false, w: 53, r: 10, sets: 3, unit: "lb" });
  });

  it("3. an event is an event", () => {
    expect(classifyLine("Lunch with Henry Friday at noon.", TODAY)).toMatchObject({ kind: "event", date: "2026-10-30", start: "12:00" });
  });

  it("4. remind me tomorrow morning is tomorrow, once", () => {
    const e = classifyLine("Remind me to email the landlord tomorrow morning", TODAY, { morning: "08:00" });
    expect(e).toMatchObject({ kind: "task", title: "Email the Landlord", reminder: { time: "08:00", repeat: { kind: "once" }, startDate: "2026-10-29" } });
  });

  it("5 and 6. a question is asked, never saved", () => {
    expect(readQuestion("What is on my schedule tomorrow?")).toBe(true);
    expect(readQuestion("What time is my call with Shane Sullivan?")).toBe(true);
    // A transcript drops the question mark; the words still ask.
    expect(readQuestion("what is on my schedule tomorrow")).toBe(true);
    expect(readQuestion("do I have anything on Friday")).toBe(true);
  });

  it("7 to 9. a fact, a decision and a note still land where they did", () => {
    expect(classifyLine("We are going with the first floor for the event.", TODAY).kind).toBe("decision");
    expect(classifyLine("Note to self. The new cage netting quote seemed high.", TODAY).kind).not.toBe("event");
  });

  it("10. the Josh Rudd trap: a name attaches nobody", () => {
    const e = classifyLine("Set up a call with Josh Rudd", TODAY, { people: [{ id: "josh-b", name: "Josh (Bucknell)" }] });
    expect(e.personId).toBeUndefined();
  });
});

describe("what is NOT a question, and NOT a set", () => {
  it("a request phrased as a question is a request", () => {
    expect(readQuestion("Can you remind me to call Mom at 5pm?")).toBe(false);
    expect(readQuestion("remind me to call the bank")).toBe(false);
  });

  it("an imperative that starts like a question stays a capture", () => {
    expect(readQuestion("Do the laundry tomorrow")).toBe(false);
    expect(readQuestion("When I get home call Mom")).toBe(false);
    expect(readQuestion("Call Marco about the field")).toBe(false);
  });

  it("a lift named without a set's words is talk about the lift", () => {
    expect(readSpokenSet("Look up a better deadlift program", NAMES)).toBeNull();
    expect(readSpokenSet("Bench press day felt great", NAMES)).toBeNull();
  });

  it("a set's words with no lift named is not filed as a set", () => {
    expect(readSpokenSet("Most Recent Set: 540 Lbs X 3 Reps", NAMES)).toBeNull();
  });

  it("the shapes people say at the rack", () => {
    expect(readSpokenSet("bench press 225 for 8", NAMES)).toMatchObject({ name: "Bench Press", w: 225, r: 8, sets: 1 });
    expect(readSpokenSet("log back squat 100 kilos 5 reps", NAMES)).toMatchObject({ name: "Back Squat", w: 100, r: 5, unit: "kg" });
    expect(readSpokenSet("2 sets of 12 pull-ups", NAMES)).toMatchObject({ name: "Pull-Up", r: 12, sets: 2 });
    expect(readSpokenSet("2 sets of 50 lb curls for 10", NAMES)).toMatchObject({ name: "Curl", w: 50, r: 10, sets: 2 });
  });
});
