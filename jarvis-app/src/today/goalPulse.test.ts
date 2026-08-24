import { describe, it, expect } from "vitest";
import {
  movesLine, movesCount, movesPillLabel, goalsMovedToday, movedLine,
  openWorkOf, untouchedGoal, untouchedLine,
  isGoalNudgeDismissed, dismissGoalNudge, type DismissStore,
} from "./goalPulse";
import { buildGoalIndex, type GoalReach } from "../bigger/reach";
import type { TaskItem } from "../tasks/TasksService";
import type { Project } from "../projects/types";
import type { Goal } from "../life/types";

function task(id: string, over: Partial<TaskItem["data"]> = {}): TaskItem {
  return { id, data: { text: id, category: "", done: false, ...over } };
}
function proj(id: string, over: Partial<Project["data"]> = {}): Project {
  return { id, data: { title: id, status: "active", ...over } };
}
function goal(id: string, over: Partial<Goal["data"]> = {}): Goal {
  return { id, data: { title: id, state: "on_track", ...over } };
}
function memStore(): DismissStore {
  let v: string | null = null;
  return { read: () => v, write: (x) => { v = x; } };
}

describe("movesLine (pick 31: lineage only when it matters)", () => {
  it("names the goal when the task does not", () => {
    expect(movesLine("Ship the App Store Launch", "Draft the Coach Onboarding Email"))
      .toBe("Moves Ship the App Store Launch");
  });
  it("stays silent when the task already says the whole goal", () => {
    expect(movesLine("Ship the App Store Launch", "Ship the App Store Launch today")).toBeNull();
  });
  it("speaks when the task shares only part of the goal", () => {
    expect(movesLine("Ship the App Store Launch", "Launch checklist")).toBe("Moves Ship the App Store Launch");
  });
  it("is null without a goal", () => {
    expect(movesLine(null, "anything")).toBeNull();
    expect(movesLine("  ", "anything")).toBeNull();
  });
  it("speaks for a goal made only of small words, which cannot be echoed", () => {
    expect(movesLine("Be Kind", "Call mum")).toBe("Moves Be Kind");
  });
});

describe("movesCount (pick 5)", () => {
  const projects = [proj("p1", { goalId: "g1" })];
  const goals = [goal("g1"), goal("g2", { tags: ["health"] })];
  const idx = buildGoalIndex(projects, goals);
  it("counts open tasks that point at a goal, either route", () => {
    const rows = [task("a", { projectId: "p1" }), task("b", { category: "health" }), task("c")];
    expect(movesCount(idx, rows)).toBe(2);
  });
  it("does not count finished work: the hero is about what is left", () => {
    expect(movesCount(idx, [task("a", { projectId: "p1", done: true })])).toBe(0);
  });
  it("is zero with no goals at all", () => {
    expect(movesCount(buildGoalIndex(projects, []), [task("a", { projectId: "p1" })])).toBe(0);
  });
  it("keeps the count grammatical", () => {
    expect(movesPillLabel(1)).toBe("moves a goal");
    expect(movesPillLabel(2)).toBe("move a goal");
  });
});

describe("goalsMovedToday (pick 4)", () => {
  const projects = [proj("p1", { goalId: "g1" })];
  const goals = [goal("g1", { title: "Run a Half" }), goal("g2", { title: "Get Fit", tags: ["health"] })];
  const idx = buildGoalIndex(projects, goals);
  const DAY = 1_000_000;
  const END = DAY + 86400000;

  it("names what today's completions moved", () => {
    const tasks = [task("a", { projectId: "p1" }), task("b", { category: "health" })];
    const samples = [{ id: "a", t: DAY + 10 }, { id: "b", t: DAY + 20 }];
    expect(goalsMovedToday(idx, tasks, samples, DAY, END)).toEqual(["Run a Half", "Get Fit"]);
  });
  it("ignores completions from other days", () => {
    const tasks = [task("a", { projectId: "p1" })];
    expect(goalsMovedToday(idx, tasks, [{ id: "a", t: DAY - 1 }], DAY, END)).toEqual([]);
  });
  it("never repeats a goal two tasks share", () => {
    const tasks = [task("a", { projectId: "p1" }), task("b", { projectId: "p1" })];
    const samples = [{ id: "a", t: DAY + 1 }, { id: "b", t: DAY + 2 }];
    expect(goalsMovedToday(idx, tasks, samples, DAY, END)).toEqual(["Run a Half"]);
  });
  it("says nothing when it saw nothing, and never claims nothing moved", () => {
    expect(movedLine([])).toBeNull();
    expect(goalsMovedToday(idx, [], [], DAY, END)).toEqual([]);
  });
  it("names one, counts many", () => {
    expect(movedLine(["Run a Half"])).toBe("Moved Run a Half");
    expect(movedLine(["Run a Half", "Get Fit"])).toBe("Moved 2 goals");
  });
});

describe("untouchedGoal (pick 3)", () => {
  const projects = [proj("p1", { goalId: "g1" }), proj("p2", { goalId: "g2" })];
  const goals = [goal("g1", { title: "One" }), goal("g2", { title: "Two" })];
  const idx = buildGoalIndex(projects, goals);
  const reach = (open: Record<string, number>) => (id: string): GoalReach => ({
    filedIds: [], taggedIds: [], openTagged: open[id] ?? 0, progress: null,
  });

  it("names the goal nothing on today's plate moves", () => {
    const todays = [task("a", { projectId: "p1" })];
    const g = untouchedGoal(idx, goals, reach({ g1: 3, g2: 5 }), todays, "2026-08-24", memStore());
    expect(g?.id).toBe("g2");
  });
  it("stays silent when today covers every goal", () => {
    const todays = [task("a", { projectId: "p1" }), task("b", { projectId: "p2" })];
    expect(untouchedGoal(idx, goals, reach({ g1: 3, g2: 5 }), todays, "2026-08-24", memStore())).toBeNull();
  });
  it("never nags about a goal with nothing open", () => {
    expect(untouchedGoal(idx, goals, reach({}), [], "2026-08-24", memStore())).toBeNull();
  });
  it("leads with the most invested goal", () => {
    const g = untouchedGoal(idx, goals, reach({ g1: 9, g2: 1 }), [], "2026-08-24", memStore());
    expect(g?.id).toBe("g1");
  });
  it("skips achieved goals", () => {
    const done = [goal("g1", { state: "achieved" }), goal("g2")];
    const g = untouchedGoal(idx, done, reach({ g1: 9, g2: 1 }), [], "2026-08-24", memStore());
    expect(g?.id).toBe("g2");
  });
  it("counts a completed task on today as not covering the goal", () => {
    const todays = [task("a", { projectId: "p1", done: true })];
    const g = untouchedGoal(idx, goals, reach({ g1: 4 }), todays, "2026-08-24", memStore());
    expect(g?.id).toBe("g1");
  });
  it("respects a dismissal for three days, then speaks again", () => {
    const store = memStore();
    dismissGoalNudge("g1", "2026-08-24", store);
    expect(isGoalNudgeDismissed("g1", "2026-08-25", store)).toBe(true);
    expect(isGoalNudgeDismissed("g1", "2026-08-27", store)).toBe(false);
    const g = untouchedGoal(idx, goals, reach({ g1: 9, g2: 1 }), [], "2026-08-25", store);
    expect(g?.id).toBe("g2");
  });
  it("is silent when there are no goals", () => {
    expect(untouchedGoal(buildGoalIndex(projects, []), [], reach({}), [], "2026-08-24", memStore())).toBeNull();
  });
});

describe("openWorkOf", () => {
  it("adds the filed remainder to the tagged open count", () => {
    expect(openWorkOf({ filedIds: [], taggedIds: [], openTagged: 2, progress: { done: 1, total: 4, pct: 25 } })).toBe(5);
  });
  it("is zero for a goal with nothing under it", () => {
    expect(openWorkOf({ filedIds: [], taggedIds: [], openTagged: 0, progress: null })).toBe(0);
  });
});

describe("untouchedLine", () => {
  it("capitalizes behind the number and behind the dot", () => {
    expect(untouchedLine(4)).toBe("4 Open · Nothing today moves it");
  });
});
