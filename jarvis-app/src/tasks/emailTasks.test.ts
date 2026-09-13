import { describe, it, expect } from "vitest";
import { partition, FILTERS, FILTER_LABEL } from "./filters";
import { isFromEmail } from "./emailTasks";
import type { TaskItem } from "./TasksService";

// Dave 2026-09-13: tasks made from email wait under From Email by default,
// and join the ordinary lists only when he says so.
const TODAY = "2026-09-13";
const task = (id: string, data: Partial<TaskItem["data"]>): TaskItem => ({ id, data: { text: id, done: false, ...data } } as TaskItem);

describe("tasks made from email", () => {
  const items = [
    task("typed", { due: TODAY }),
    task("mailed", { due: TODAY, source: { type: "email", ref: "t1", ts: 1 } }),
    task("threaded", { due: "2026-09-10", fromThread: "t2" }),
    task("mailedDone", { due: TODAY, done: true, source: { type: "email", ref: "t3", ts: 1 } }),
  ];

  it("knows which tasks the mail flow made", () => {
    expect(isFromEmail(items[0]!.data)).toBe(false);
    expect(isFromEmail(items[1]!.data)).toBe(true);
    expect(isFromEmail(items[2]!.data)).toBe(true);
  });

  it("offers From Email in the dropdown", () => {
    expect(FILTERS).toContain("email");
    expect(FILTER_LABEL.email).toBe("From Email");
  });

  it("by default keeps them out of every ordinary list and under From Email", () => {
    const p = partition(items, TODAY, false);
    expect(p.email.map((t) => t.id)).toEqual(["threaded", "mailed"]);
    expect(p.today.map((t) => t.id)).toEqual(["typed"]);
    expect(p.overdue).toEqual([]);
    expect(p.all.map((t) => t.id)).toEqual(["typed"]);
    // A finished one is finished, wherever it came from.
    expect(p.done.map((t) => t.id)).toEqual(["mailedDone"]);
  });

  it("with the switch on, they join the lists and stay under From Email too", () => {
    const p = partition(items, TODAY, true);
    expect(p.email.map((t) => t.id)).toEqual(["threaded", "mailed"]);
    expect(p.today.map((t) => t.id).sort()).toEqual(["mailed", "typed"]);
    expect(p.overdue.map((t) => t.id)).toEqual(["threaded"]);
  });
});
