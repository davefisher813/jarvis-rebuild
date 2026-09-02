import { describe, it, expect, beforeAll } from "vitest";
import { buildParentIndex, parentForTask } from "./parent";
import { setCategoryRegistry } from "../shared/categories";
import type { TaskItem } from "../tasks/TasksService";
import type { Project } from "../projects/types";
import type { Goal } from "./types";

// THE PARENT LINE (The Row and Health, 2026-09-02): project first, then the
// goal a task moves, then the category, each with its own glyph and colour.
const task = (id: string, data: Partial<TaskItem["data"]>): TaskItem =>
  ({ id, data: { text: id, done: false, createdAt: 0, ...data } as TaskItem["data"] });

describe("parentForTask", () => {
  beforeAll(() => setCategoryRegistry([{ id: "money", name: "Money", color: "yellow" }, { id: "work", name: "Work", color: "sky" }]));
  const projects = [{ id: "p1", data: { title: "Kitchen remodel", status: "active", category: "work", goalId: "g1" } }] as unknown as Project[];
  const goals = [{ id: "g1", data: { title: "Build a six-month runway", state: "on_track", tags: ["money"] } }] as unknown as Goal[];
  const tasks = [
    task("a", { projectId: "p1", category: "work" }),
    task("b", { projectId: "p1", category: "work", done: true }),
    task("c", { category: "money" }),
    task("d", { category: "work" }),
    task("e", {}),
  ];
  // Built inside each test: the registry is set in beforeAll, and the index
  // reads colours at build time.
  const idx = () => buildParentIndex(projects, goals, tasks);

  it("a filed task wears its project, with the project's progress and category colour", () => {
    expect(parentForTask(idx(), tasks[0]!)).toEqual({ kind: "project", name: "Kitchen remodel", tone: "cat-fg-sky", pct: 50 });
  });
  it("a task that moves a goal but has no project wears the goal, in the goal's home colour", () => {
    expect(parentForTask(idx(), tasks[2]!)).toEqual({ kind: "goal", name: "Build a six-month runway", tone: "cat-fg-yellow", pct: null });
  });
  it("a task that moves nothing wears its category", () => {
    expect(parentForTask(idx(), tasks[3]!)).toEqual({ kind: "category", name: "Work", tone: "cat-fg-sky", pct: null });
  });
  it("a task with nothing at all says nothing, so the row can say No category", () => {
    expect(parentForTask(idx(), tasks[4]!)).toBeNull();
  });
});
