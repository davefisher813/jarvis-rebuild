import { describe, it, expect } from "vitest";
import { inheritFromThread } from "./threadTasks";
import type { TaskItem } from "../tasks/TasksService";

function task(id: string, over: Partial<TaskItem["data"]> = {}): TaskItem {
  return { id, data: { text: id, category: "", done: false, ...over } };
}

describe("inheritFromThread (pick 26)", () => {
  it("inherits nothing from a thread with no history, and says so by staying empty", () => {
    expect(inheritFromThread([], "t1")).toEqual({});
    expect(inheritFromThread([task("a", { fromThread: "t2", projectId: "p1" })], "t1")).toEqual({});
  });
  it("joins the project a sibling from the same thread was filed under", () => {
    const tasks = [task("a", { fromThread: "t1", projectId: "p1", category: "work" })];
    expect(inheritFromThread(tasks, "t1")).toEqual({ projectId: "p1", category: "work" });
  });
  it("takes the NEWEST filed sibling, because the work may have moved", () => {
    const tasks = [
      task("a", { fromThread: "t1", projectId: "old" }),
      task("b", { fromThread: "t1", projectId: "new" }),
    ];
    expect(inheritFromThread(tasks, "t1")).toEqual({ projectId: "new" });
  });
  it("keeps a category as lineage when no sibling has a project", () => {
    const tasks = [task("a", { fromThread: "t1", category: "money" })];
    expect(inheritFromThread(tasks, "t1")).toEqual({ category: "money" });
  });
  it("never guesses from a title, a sender, or a category alone", () => {
    // A task with the same category but a DIFFERENT thread teaches nothing.
    const tasks = [task("a", { fromThread: "other", category: "work", projectId: "p9" })];
    expect(inheritFromThread(tasks, "t1")).toEqual({});
  });
  it("is empty for an empty thread id", () => {
    expect(inheritFromThread([task("a", { fromThread: "", projectId: "p1" })], "")).toEqual({});
  });
});
