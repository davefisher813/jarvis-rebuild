import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path/posix";
import { withLiveGroups, groupForToday, ungroupToday, isLiveGroup } from "./liveGroups";
import type { Exercise } from "./types";

const ex = (id: string, groupId?: string): Exercise =>
  ({ id, exerciseKey: id, name: id, kind: "weight_reps", unit: "lb", sets: [], ...(groupId ? { groupId } : {}) } as Exercise);
const day = [ex("a"), ex("b"), ex("c")];

// Dave, 2026-09-21, picking "ask me each time": a superset made mid-workout
// can be for today only. Grouping has always been a program construct and the
// live screen reads its pairs off the day, so without this the "just today"
// answer would have been a button that lies.
describe("a pair made for today only", () => {
  it("leaves the day untouched when the session made none", () => {
    expect(withLiveGroups(day)).toBe(day);
    expect(withLiveGroups(day, {})).toBe(day);
  });

  it("lays today's group over the day, for every reader at once", () => {
    const out = withLiveGroups(day, { a: "g1", b: "g1" });
    expect(out.map((e) => e.groupId)).toEqual(["g1", "g1", undefined]);
  });

  it("never writes to the program's own list", () => {
    withLiveGroups(day, { a: "g1", b: "g1" });
    expect(day.map((e) => e.groupId), "the day is the program's").toEqual([undefined, undefined, undefined]);
  });

  it("does not override a pair the program already states", () => {
    // A program pair the session did not touch keeps its own id.
    const withProgram = [ex("a", "prog1"), ex("b", "prog1"), ex("c")];
    const out = withLiveGroups(withProgram, { c: "g9" });
    expect(out.map((e) => e.groupId)).toEqual(["prog1", "prog1", "g9"]);
  });
});

describe("making and unmaking one", () => {
  let n = 0;
  const nid = () => `g${++n}`;

  it("pairs two lifts under one new id", () => {
    n = 0;
    expect(groupForToday(undefined, ["a", "b"], nid)).toEqual({ a: "g1", b: "g1" });
  });

  it("grows an existing pair instead of splitting it", () => {
    n = 0;
    const first = groupForToday(undefined, ["a", "b"], nid);
    expect(groupForToday(first, ["a", "c"], nid), "c joins a and b").toEqual({ a: "g1", b: "g1", c: "g1" });
  });

  it("refuses a group of one, which is not a pair", () => {
    n = 0;
    expect(groupForToday(undefined, ["a"], nid)).toEqual({});
  });

  it("releases every member, which is the exact inverse", () => {
    n = 0;
    const made = groupForToday(undefined, ["a", "b", "c"], nid);
    expect(ungroupToday(made, "b")).toEqual({});
  });

  it("leaves other groups alone when one is released", () => {
    const made = { a: "g1", b: "g1", c: "g2", d: "g2" };
    expect(ungroupToday(made, "a")).toEqual({ c: "g2", d: "g2" });
  });

  it("never mutates what it was given", () => {
    const before = { a: "g1", b: "g1" };
    groupForToday(before, ["c", "d"], () => "g2");
    ungroupToday(before, "a");
    expect(before).toEqual({ a: "g1", b: "g1" });
  });
});

// The choice, and the two writes behind it.
describe("ask me each time", () => {
  const read = (f: string) => readFileSync(join(process.cwd().replace(/\\/g, "/"), "src", f), "utf8");

  it("offers both answers, named for what they actually do", () => {
    const flow = read("gym/GymFlow.tsx");
    expect(flow).toContain('label: "Just This Workout"');
    expect(flow, "the other one says WHICH day it will change").toContain('label: "Every " + workoutTitle(day?.name ?? "Session")');
  });

  it("just-today writes the session and never the program", () => {
    const flow = read("gym/GymFlow.tsx");
    const today = flow.slice(flow.indexOf('label: "Just This Workout"'), flow.indexOf('label: "Every "'));
    expect(today, "the live session is the only thing it touches").toContain("patchLive((l) => ({ ...l, groups: groupForToday(");
    expect(today, "and it does not call the program writer").not.toContain("groupAction(");
    expect(today, "with an Undo that restores the exact map it replaced").toContain("actionLabel: \"Undo\"");
  });

  it("every-session is the program writer that already existed", () => {
    const flow = read("gym/GymFlow.tsx");
    const every = flow.slice(flow.indexOf('label: "Every "'));
    expect(every.slice(0, 400)).toContain("void groupAction(pick.weekId, pick.dayId, pick.exId, pick.ids)");
  });

  it("the session lays its own pairs over the day for every reader at once", () => {
    const sess = read("gym/SessionScreen.tsx");
    expect(sess).toContain("const dayEx = withLiveGroups(dayExercises, live.groups);");
    // Each group question is asked of the overlaid list, not the raw day.
    for (const call of ["groupLabels(dayEx)", "groupOf(exercise, dayEx)", "fillerFor(exercise, dayEx)",
                        "roundRestFor(exercise, dayEx)", "nextInGroup(exercise, dayEx"]) {
      expect(sess, call).toContain(call);
    }
  });

  it("the session renders its own pickers, because it returns before the shell", () => {
    // The button worked and the state was set and nothing appeared: this
    // branch returns early, before the shell that carries pickerEl()
    // everywhere else. Found by driving it, not by a type or a test.
    const flow = read("gym/GymFlow.tsx");
    const sessionBranch = flow.slice(flow.indexOf("onClose={() => setAdjustOpen(false)}"));
    expect(sessionBranch.slice(0, 900)).toContain("{pickerEl()}");
    expect(sessionBranch.slice(0, 900)).toContain("{supersetChoiceEl()}");
  });
});

// THE WAY BACK OUT (2026-09-21). ungroupToday existed, was tested, and was
// wired to nothing: a superset made from a live session could only be taken
// back inside the five seconds its toast was up. These cover the half that
// was missing -- breaking a pair the PROGRAM owns, for today only.
describe("ungroupToday: a program pair, broken for today only", () => {
  const day: Exercise[] = [
    { id: "a", name: "Bench", kind: "weight_reps", sets: [], groupId: "gp" },
    { id: "b", name: "Row", kind: "weight_reps", sets: [], groupId: "gp" },
    { id: "c", name: "Curl", kind: "weight_reps", sets: [] },
  ];

  it("marks every member of the program's group as ungrouped today", () => {
    const next = ungroupToday(undefined, "a", day);
    expect(next).toEqual({ a: "", b: "" });
    // And the day the session reads is genuinely unpaired.
    const laid = withLiveGroups(day, next);
    expect(laid.map((e) => e.groupId)).toEqual([undefined, undefined, undefined]);
  });

  it("leaves the program itself untouched", () => {
    ungroupToday(undefined, "a", day);
    expect(day.map((e) => e.groupId)).toEqual(["gp", "gp", undefined]);
  });

  it("still releases a pair made today, without needing the day", () => {
    const made = groupForToday(undefined, ["a", "c"], () => "gt");
    expect(ungroupToday(made, "a")).toEqual({});
  });

  it("re-pairing after breaking a program pair overwrites the mark", () => {
    const broken = ungroupToday(undefined, "a", day);
    const repaired = groupForToday(broken, ["a", "c"], () => "gt");
    expect(repaired.a).toBe("gt");
    expect(repaired.c).toBe("gt");
    // b stays explicitly unpaired for today: it was not in the new pick.
    expect(repaired.b).toBe("");
    expect(withLiveGroups(day, repaired).find((e) => e.id === "b")?.groupId).toBeUndefined();
  });

  it("isLiveGroup tells the two cases apart, which is what the receipt says", () => {
    const made = groupForToday(undefined, ["a", "c"], () => "gt");
    expect(isLiveGroup(made, "a")).toBe(true);
    expect(isLiveGroup(undefined, "a")).toBe(false);
    expect(isLiveGroup(ungroupToday(undefined, "a", day), "a")).toBe(false);
  });
});
