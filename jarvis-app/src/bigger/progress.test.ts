import { describe, it, expect } from "vitest";
import { projectProgress, goalProgress, isStalled, rankProjects, progressLabel, lastActivity, STALE_DAYS } from "./progress";
import type { TaskItem } from "../tasks/TasksService";
import type { Project } from "../projects/types";

const NOW = new Date("2026-08-02T12:00:00Z").getTime();
const daysAgo = (n: number) => NOW - n * 86400000;

function task(id: string, projectId?: string, done = false): TaskItem {
  return { id, data: { text: id, category: "", done, ...(projectId ? { projectId } : {}) } };
}
function proj(id: string, over: Partial<Project["data"]> = {}): Project {
  return { id, data: { title: id, status: "active", ...over } };
}

describe("projectProgress", () => {
  it("counts only its own tasks", () => {
    const tasks = [task("a", "p1", true), task("b", "p1"), task("c", "p2", true), task("d")];
    expect(projectProgress(tasks, "p1")).toEqual({ done: 1, total: 2, pct: 50 });
  });
  it("returns null with no tasks, never a fake zero", () => {
    expect(projectProgress([task("x")], "p1")).toBeNull();
    expect(progressLabel(null, false)).toBe("No tasks yet");
  });
});

describe("goalProgress", () => {
  const projects = [proj("p1", { goalId: "g1" }), proj("p2", { goalId: "g1" }), proj("p3", { goalId: "g2" })];
  it("rolls up every task under every project on the goal", () => {
    const tasks = [task("a", "p1", true), task("b", "p2", true), task("c", "p2"), task("d", "p3")];
    expect(goalProgress(tasks, projects, "g1")).toEqual({ done: 2, total: 3, pct: 67 });
  });
  it("is null when the goal has no projects, or none of them have tasks", () => {
    expect(goalProgress([], projects, "nope")).toBeNull();
    expect(goalProgress([task("z")], projects, "g1")).toBeNull();
  });
});

describe("isStalled", () => {
  const tasks = [task("a", "p1", true), task("b", "p1")];
  it("fires only with evidence of real neglect", () => {
    const old = [{ id: "a", t: daysAgo(STALE_DAYS + 5) }];
    expect(isStalled(tasks, old, "p1", NOW)).toBe(true);
  });
  it("stays quiet on recent activity", () => {
    expect(isStalled(tasks, [{ id: "a", t: daysAgo(3) }], "p1", NOW)).toBe(false);
  });
  it("stays quiet when we have no evidence at all (silence is not neglect)", () => {
    expect(isStalled(tasks, [], "p1", NOW)).toBe(false);
    expect(isStalled(tasks, [{ id: "other", t: daysAgo(99) }], "p1", NOW)).toBe(false);
  });
  it("finished work is never stalled", () => {
    const allDone = [task("a", "p1", true)];
    expect(isStalled(allDone, [{ id: "a", t: daysAgo(99) }], "p1", NOW)).toBe(false);
  });
  it("ignores samples with no task id", () => {
    expect(lastActivity([{ t: daysAgo(1) }], ["a"])).toBeNull();
  });
});

describe("rankProjects", () => {
  it("puts recently touched first and sinks finished projects", () => {
    const projects = [proj("cold"), proj("hot"), proj("finished", { status: "done" })];
    const tasks = [task("t1", "cold"), task("t2", "hot")];
    const samples = [{ id: "t1", t: daysAgo(30) }, { id: "t2", t: daysAgo(1) }];
    expect(rankProjects(projects, tasks, samples, NOW).map((r) => r.project.id)).toEqual(["hot", "cold", "finished"]);
  });
});

describe("progressLabel", () => {
  it("speaks plainly and flags a stall only when told to", () => {
    expect(progressLabel({ done: 3, total: 7, pct: 43 }, false)).toBe("3 of 7 done");
    expect(progressLabel({ done: 3, total: 7, pct: 43 }, true)).toBe("3 of 7 done · Stalled");
    expect(progressLabel({ done: 4, total: 4, pct: 100 }, false)).toBe("All 4 done");
  });
});
