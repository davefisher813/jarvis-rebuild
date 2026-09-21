import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path/posix";
import { dayUnderPlan, estimateDay } from "./fit";
import type { ProgramDay, Exercise, SetEntry } from "./types";
import type { RackConfig } from "./ramp";

const set = (id: string, w: number, r: number): SetEntry => ({ id, w, r } as SetEntry);
const ex = (id: string, name: string, extra: Partial<Exercise> = {}): Exercise =>
  ({ id, exerciseKey: id, name, kind: "weight_reps", unit: "lb",
     sets: [set(id + "a", 135, 8), set(id + "b", 135, 8), set(id + "c", 135, 8)], ...extra } as Exercise);

const day: ProgramDay = {
  id: "d1", name: "Push Day",
  exercises: [ex("e1", "Bench"), ex("e2", "Incline Bench"), ex("e3", "Overhead Press"), ex("e4", "Lateral Raise")],
} as ProgramDay;
const rack = {} as RackConfig;

// Dave, 2026-09-21: "the user should be able to essentially just populate
// workout days with workout options then select what they want to do that
// day. It's kind of that way on accident right now."
//
// On accident: the start sheet asked how long you had and offered to trim
// accessory sets, and never asked WHICH lifts. You got the whole day in
// order, and the only way to choose was Skip or Swap with the session already
// running.
describe("the day is a menu, not a script", () => {
  it("runs the whole day when nothing is picked, which is every caller that never asks", () => {
    expect(dayUnderPlan(day).exercises).toHaveLength(4);
    expect(dayUnderPlan(day, {}).exercises).toHaveLength(4);
    expect(dayUnderPlan(day, { skip: [] }).exercises).toHaveLength(4);
  });

  it("drops exactly what was unticked, and keeps the day's order", () => {
    const left = dayUnderPlan(day, { skip: ["e3", "e4"] }).exercises.map((e) => e.name);
    expect(left).toEqual(["Bench", "Incline Bench"]);
  });

  it("never edits the program it was asked about (LAW 17)", () => {
    const before = day.exercises.length;
    dayUnderPlan(day, { skip: ["e1"] });
    expect(day.exercises).toHaveLength(before);
    expect(day.exercises.map((e) => e.id)).toContain("e1");
  });

  it("prices the session it is actually going to run", () => {
    // The whole point of putting the list ON the fit sheet: the minutes and
    // the exercises are one decision, so they cannot disagree.
    const all = estimateDay(day, [], rack).min;
    const half = estimateDay(day, [], rack, { skip: ["e3", "e4"] }).min;
    expect(half, "two of four lifts costs less than four").toBeLessThan(all);
    expect(estimateDay(day, [], rack, { skip: [] }).min).toBe(all);
  });

  it("counts only the lifts it is running, so the honesty line stays true", () => {
    expect(estimateDay(day, [], rack).liftCount).toBe(4);
    expect(estimateDay(day, [], rack, { skip: ["e2", "e3"] }).liftCount).toBe(2);
  });

  it("leaves a day with no picks identical, object for object", () => {
    // dayUnderPlan is on the hot path of every estimate; an empty plan must
    // not allocate a new day on every keystroke.
    expect(dayUnderPlan(day, { budgetMin: 45 })).toBe(day);
  });
});

// The two doors on a program day, and the sheet's own guard.
describe("populating a day, and the one thing the sheet will not let you do", () => {
  const read = (f: string) => readFileSync(join(process.cwd().replace(/\\/g, "/"), "src", f), "utf8");

  it("picking from lifts you already have leads; authoring is the escape hatch", () => {
    // Both doors were already here and the fast one was SECOND, so building a
    // day meant meeting an eleven-field authoring sheet once per exercise.
    const flow = read("gym/GymFlow.tsx");
    const lifts = flow.indexOf("Add from Your Lifts</button>");
    const author = flow.indexOf("New Exercise</button>");
    expect(lifts, "the picker is rendered").toBeGreaterThan(-1);
    expect(author, "so is the authoring door").toBeGreaterThan(-1);
    expect(lifts, "and the picker comes first").toBeLessThan(author);
    // Renamed, because beside a picker "Add Exercise" described them both.
    // Scoped to the program day's own pair: "Log a Past Workout" has its own
    // Add Exercise for a lift you forgot to log, and there it is the right
    // word -- there is no day being populated and nothing to pick from.
    const pair = flow.slice(lifts - 1200, author + 40);
    expect(pair).not.toContain(">Add Exercise</button>");
    expect(flow, "the past-workout editor keeps its own").toContain(">Add Exercise</button>");
  });

  it("the picker still hides on an empty library, where it would open onto nothing", () => {
    expect(read("gym/GymFlow.tsx")).toContain("{library.length > 0 && (");
  });

  it("the last lift cannot be unticked, because that is a workout you did not do", () => {
    const sheet = read("gym/FitSheet.tsx");
    expect(sheet).toContain("else if (doable.some((e) => e.id !== id && !skip.has(e.id))) skip.add(id);");
  });

  it("a filler is not offered as a choice, because it rides inside a partner's rest", () => {
    expect(read("gym/FitSheet.tsx")).toContain("const doable = day.exercises.filter((e) => !e.filler);");
  });

  it("the session is built from the same list the sheet priced", () => {
    expect(read("gym/GymFlow.tsx")).toContain("dayUnderPlan(day, opts.fit ?? {}).exercises.map(");
  });
});
