import { describe, it, expect } from "vitest";
import {
  goalTags, liveGoals, reachOf, reachLine, buildGoalIndex,
  goalIdsForTask, movesGoal, goalTitleForTask, countMovingGoals, projectsOfGoal, byDue,
} from "./reach";
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

describe("goalTags", () => {
  it("is always an array, and drops blanks", () => {
    expect(goalTags(goal("g"))).toEqual([]);
    expect(goalTags(goal("g", { tags: ["health", " ", "", "work "] }))).toEqual(["health", "work"]);
  });
});

describe("liveGoals", () => {
  it("drops achieved goals, because nothing moves a finished goal", () => {
    const all = [goal("a"), goal("b", { state: "achieved" }), goal("c", { state: "at_risk" })];
    expect(liveGoals(all).map((g) => g.id)).toEqual(["a", "c"]);
  });
});

describe("reachOf", () => {
  const projects = [proj("p1", { goalId: "g1" }), proj("p2", { goalId: "g2" })];

  it("reaches filed work through the project chain", () => {
    const g = goal("g1");
    const tasks = [task("a", { projectId: "p1", done: true }), task("b", { projectId: "p1" }), task("c", { projectId: "p2" })];
    const r = reachOf(tasks, projects, g);
    expect(r.filedIds).toEqual(["a", "b"]);
    expect(r.progress).toEqual({ done: 1, total: 2, pct: 50 });
  });

  it("reaches tagged work with no filing at all", () => {
    const g = goal("g1", { tags: ["health"] });
    const tasks = [task("a", { category: "health" }), task("b", { category: "work" })];
    const r = reachOf(tasks, projects, g);
    expect(r.taggedIds).toEqual(["a"]);
    expect(r.openTagged).toBe(1);
  });

  it("reads an extra category, not only the primary", () => {
    const g = goal("g1", { tags: ["health"] });
    const tasks = [task("a", { category: "work", extraCategories: ["health"] })];
    expect(reachOf(tasks, projects, g).taggedIds).toEqual(["a"]);
  });

  it("counts a task once when it is BOTH filed and tagged, on the filed side", () => {
    const g = goal("g1", { tags: ["health"] });
    const tasks = [task("a", { projectId: "p1", category: "health" })];
    const r = reachOf(tasks, projects, g);
    expect(r.filedIds).toEqual(["a"]);
    expect(r.taggedIds).toEqual([]);
  });

  it("NEVER lets a tag move done/total: that is the whole honesty of pick C", () => {
    // Every health task in history is closed. A tagged goal must not read 100%.
    const g = goal("g1", { tags: ["health"] });
    const tasks = [task("a", { category: "health", done: true }), task("b", { category: "health", done: true })];
    const r = reachOf(tasks, projects, g);
    expect(r.progress).toBeNull();
    expect(r.openTagged).toBe(0);
  });

  it("is empty for a goal with no projects and no tags", () => {
    const r = reachOf([task("a", { category: "health" })], projects, goal("gX"));
    expect(r).toEqual({ filedIds: [], taggedIds: [], openTagged: 0, progress: null });
  });
});

describe("reachLine", () => {
  const projects = [proj("p1", { goalId: "g1" })];
  it("speaks in fractions when there is a real denominator", () => {
    const tasks = [task("a", { projectId: "p1", done: true }), task("b", { projectId: "p1" })];
    expect(reachLine(reachOf(tasks, projects, goal("g1")))).toBe("1 of 2 Done");
  });
  it("adds the tagged open count beside filed work", () => {
    const tasks = [task("a", { projectId: "p1", done: true }), task("b", { category: "health" })];
    expect(reachLine(reachOf(tasks, projects, goal("g1", { tags: ["health"] })))).toBe("1 of 1 Done · 1 tagged open");
  });
  it("speaks in open counts when tags are all there is", () => {
    const tasks = [task("b", { category: "health" }), task("c", { category: "health" })];
    expect(reachLine(reachOf(tasks, projects, goal("g9", { tags: ["health"] })))).toBe("2 Open in your tags");
  });
  it("says the tagged work is done rather than inventing a percentage", () => {
    const tasks = [task("b", { category: "health", done: true })];
    expect(reachLine(reachOf(tasks, projects, goal("g9", { tags: ["health"] })))).toBe("Tagged work all done");
  });
  it("admits emptiness", () => {
    expect(reachLine(reachOf([], projects, goal("g9")))).toBe("Nothing under it yet");
  });
});

describe("the upward index", () => {
  const projects = [proj("p1", { goalId: "g1" }), proj("p2", { goalId: "gone" })];
  const goals = [goal("g1", { title: "Run a Half" }), goal("g2", { title: "Get Fit", tags: ["health"] })];
  const idx = buildGoalIndex(projects, goals);

  it("points a filed task at its goal", () => {
    expect(goalIdsForTask(idx, task("a", { projectId: "p1" }))).toEqual(["g1"]);
  });
  it("points a tagged task at its goal with no project", () => {
    expect(goalIdsForTask(idx, task("a", { category: "health" }))).toEqual(["g2"]);
  });
  it("ignores a project filed under a goal that is not in the index", () => {
    expect(goalIdsForTask(idx, task("a", { projectId: "p2" }))).toEqual([]);
  });
  it("returns both routes without duplicating a goal", () => {
    const both = [proj("p3", { goalId: "g2" })];
    const i2 = buildGoalIndex(both, goals);
    expect(goalIdsForTask(i2, task("a", { projectId: "p3", category: "health" }))).toEqual(["g2"]);
  });
  it("says plainly when a task moves nothing", () => {
    expect(movesGoal(idx, task("a", { category: "errands" }))).toBe(false);
    expect(goalTitleForTask(idx, task("a", { category: "errands" }))).toBeNull();
  });
  it("names ONE goal, the filed one, never a list", () => {
    const t = task("a", { projectId: "p1", category: "health" });
    expect(goalIdsForTask(idx, t)).toEqual(["g1", "g2"]);
    expect(goalTitleForTask(idx, t)).toBe("Run a Half");
  });
  it("counts how many of today's tasks move something", () => {
    const rows = [task("a", { projectId: "p1" }), task("b", { category: "health" }), task("c")];
    expect(countMovingGoals(idx, rows)).toBe(2);
  });
  it("costs nothing when there are no goals", () => {
    const empty = buildGoalIndex(projects, []);
    expect(countMovingGoals(empty, [task("a", { projectId: "p1" })])).toBe(0);
  });
});

describe("projectsOfGoal", () => {
  it("returns only the projects filed under it", () => {
    const projects = [proj("p1", { goalId: "g1" }), proj("p2"), proj("p3", { goalId: "g2" })];
    expect(projectsOfGoal(projects, "g1").map((p) => p.id)).toEqual(["p1"]);
  });
});

describe("byDue", () => {
  it("leads with the earliest due date and sinks the undated", () => {
    const rows = [{ id: "a" }, { id: "b", due: "2026-09-01" }, { id: "c", due: "2026-08-25" }, { id: "d", due: null }];
    expect(byDue(rows).map((r) => r.id)).toEqual(["c", "b", "a", "d"]);
  });
  it("keeps original order on a tie", () => {
    const rows = [{ id: "a", due: "2026-08-25" }, { id: "b", due: "2026-08-25" }];
    expect(byDue(rows).map((r) => r.id)).toEqual(["a", "b"]);
  });
});
