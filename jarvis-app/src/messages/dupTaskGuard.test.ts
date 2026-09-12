import { describe, it, expect } from "vitest";
import { existingTaskFor, taskTitleOf, findTaskForThread } from "./dupTaskGuard";
import type { TaskItem } from "../tasks/TasksService";

const task = (id: string, data: Partial<TaskItem["data"]>): TaskItem =>
  ({ id, data: { text: "T " + id, category: "life", done: false, ...data } as TaskItem["data"] });

// E-30 (Push H): one task per thread, checked on every manual path.
describe("dupTaskGuard", () => {
  it("finds an open task by fromThread or by an email source ref, never by title", () => {
    const list = [
      task("a", { fromThread: "t1" }),
      task("b", { source: { type: "email", ref: "t2", ts: 1 } }),
      task("c", { text: "Reply to t3" }),
    ];
    expect(existingTaskFor("t1", list)?.id).toBe("a");
    expect(existingTaskFor("t2", list)?.id).toBe("b");
    expect(existingTaskFor("t3", list)).toBeNull();
    expect(existingTaskFor("", list)).toBeNull();
  });
  it("a done task does not count", () => {
    expect(existingTaskFor("t1", [task("a", { fromThread: "t1", done: true })])).toBeNull();
  });
  it("names the task, and a listing failure reads as none", async () => {
    expect(taskTitleOf(task("a", { text: "  Pay Wei  " }))).toBe("Pay Wei");
    expect(taskTitleOf(task("a", { text: "" }))).toBe("that one");
    expect(await findTaskForThread({ listTasks: async () => { throw new Error("down"); } }, "t1")).toBeNull();
    expect((await findTaskForThread({ listTasks: async () => [task("a", { fromThread: "t1" })] }, "t1"))?.id).toBe("a");
  });
});
