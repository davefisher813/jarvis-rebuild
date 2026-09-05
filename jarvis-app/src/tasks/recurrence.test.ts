import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { TasksService } from "./TasksService";
import { nextDue } from "./grouping";
import { partition } from "./filters";
import type { TaskItem } from "./TasksService";

describe("recurrence", () => {
  it("computes the next occurrence per cadence", () => {
    expect(nextDue("2026-05-27", "daily")).toBe("2026-05-28");
    expect(nextDue("2026-05-27", "weekly")).toBe("2026-06-03");
    expect(nextDue("2026-05-27", "monthly")).toBe("2026-06-27");
    // weekdays: Friday 2026-05-29 -> skips weekend to Monday 2026-06-01
    expect(nextDue("2026-05-29", "weekdays")).toBe("2026-06-01");
  });

  it("completing a recurring task rolls it forward instead of finishing", async () => {
    const svc = new TasksService(new Store(new InMemoryAdapter()), "u");
    const id = (await svc.createTask("Stretch", { due: "2026-05-27", recurrence: "daily" }))!;
    await svc.toggleDone(id);
    const t = await svc.task(id);
    expect(t?.done).toBe(false);
    expect(t?.due).toBe("2026-05-28");
  });

  // LIFE-F-02 (2026-09-05): the audit's run. Tick a weekly task due today,
  // then Undo. Through a second toggleDone it landed two weeks out with a run
  // of 2; restoreCompletion puts the snapshot back.
  it("Undo after ticking a recurring task restores due and the run, never rolls again", async () => {
    const svc = new TasksService(new Store(new InMemoryAdapter()), "u");
    const id = (await svc.createTask("Water plants", { due: "2026-09-05", recurrence: "weekly" }))!;
    const before = (await svc.task(id))!;
    await svc.toggleDone(id);
    const ticked = (await svc.task(id))!;
    expect(ticked.due).toBe("2026-09-12");
    expect(ticked.runLen).toBe(1);
    await svc.restoreCompletion(id, before);
    const after = (await svc.task(id))!;
    expect(after.done).toBe(false);
    expect(after.due).toBe("2026-09-05");
    expect(after.runLen ?? 0).toBe(0);
    expect(after.lastDone ?? null).toBeNull();
  });

  it("Undo on a plain task puts done back to false and drops the bill receipt", async () => {
    const svc = new TasksService(new Store(new InMemoryAdapter()), "u");
    const id = (await svc.createTask("Deposit", { due: "2026-09-05", bill: { amount: 40 } }))!;
    const before = (await svc.task(id))!;
    await svc.toggleDone(id);
    expect((await svc.task(id))!.done).toBe(true);
    await svc.restoreCompletion(id, before);
    const after = (await svc.task(id))!;
    expect(after.done).toBe(false);
    expect(after.lastDone ?? null).toBeNull();
  });

  it("a non-recurring task still completes normally", async () => {
    const svc = new TasksService(new Store(new InMemoryAdapter()), "u");
    const id = (await svc.createTask("One off", { due: "2026-05-27" }))!;
    await svc.toggleDone(id);
    expect((await svc.task(id))?.done).toBe(true);
  });

  it("setRecurrence can clear a recurrence", async () => {
    const svc = new TasksService(new Store(new InMemoryAdapter()), "u");
    const id = (await svc.createTask("Habit", { recurrence: "daily" }))!;
    await svc.setRecurrence(id, null);
    expect((await svc.task(id))?.recurrence).toBeFalsy();
  });

  it("the daily filter collects daily-recurring open tasks", () => {
    const items: TaskItem[] = [
      { id: "1", data: { text: "Meds", category: "", done: false, recurrence: "daily" } },
      { id: "2", data: { text: "Weekly review", category: "", done: false, recurrence: "weekly" } },
      { id: "3", data: { text: "Done daily", category: "", done: true, recurrence: "daily" } },
    ];
    const p = partition(items, "2026-05-27");
    expect(p.daily.map((i) => i.id)).toEqual(["1"]);
  });
});
