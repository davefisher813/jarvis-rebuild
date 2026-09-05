import { describe, it, expect, vi } from "vitest";
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

  // LIFE-F-03 (2026-09-05): the clock is pinned to the task's own due day, so
  // this stays an ON-TIME roll whatever day the suite runs. Read against a
  // later today it was really testing a stale task, and a stale task rolls
  // past today now.
  // LIFE-F-05 (2026-09-05): setMonth overflowed into the next month when the
  // target was shorter, so Aug 31 became Oct 1 and September never happened.
  it("a monthly anchored late in the month clamps instead of skipping one", () => {
    expect(nextDue("2026-08-31", "monthly")).toBe("2026-09-30");
    expect(nextDue("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(nextDue("2026-02-28", "monthly")).toBe("2026-03-28");
    expect(nextDue("2026-03-31", "monthly")).toBe("2026-04-30");
    expect(nextDue("2028-01-31", "monthly")).toBe("2028-02-29"); // leap February
    expect(nextDue("2026-12-31", "monthly")).toBe("2027-01-31"); // and over a year end
  });

  it("completing a recurring task rolls it forward instead of finishing", async () => {
    vi.useFakeTimers({ now: new Date(2026, 4, 27, 9, 0, 0), toFake: ["Date"] });
    try {
      const svc = new TasksService(new Store(new InMemoryAdapter()), "u");
      const id = (await svc.createTask("Stretch", { due: "2026-05-27", recurrence: "daily" }))!;
      await svc.toggleDone(id);
      const t = await svc.task(id);
      expect(t?.done).toBe(false);
      expect(t?.due).toBe("2026-05-28");
    } finally {
      vi.useRealTimers();
    }
  });

  // LIFE-F-02 (2026-09-05): the audit's run. Tick a weekly task due today,
  // then Undo. Through a second toggleDone it landed two weeks out with a run
  // of 2; restoreCompletion puts the snapshot back.
  it("Undo after ticking a recurring task restores due and the run, never rolls again", async () => {
    vi.useFakeTimers({ now: new Date(2026, 8, 5, 9, 0, 0), toFake: ["Date"] });
    try {
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
    } finally {
      vi.useRealTimers();
    }
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

  // LIFE-F-03 (2026-09-05): a stale recurring task used to roll exactly one
  // period from its stored due, so it landed in the past again and stayed on
  // Today. One tick now clears it, and the weekday anchor survives.
  it("completing a stale recurring task rolls it past today in one tick", async () => {
    vi.useFakeTimers({ now: new Date(2026, 8, 5, 9, 0, 0), toFake: ["Date"] });
    try {
      const svc = new TasksService(new Store(new InMemoryAdapter()), "u");
      // 2026-08-15 is a Saturday, three weeks and a day before 2026-09-05.
      const weekly = (await svc.createTask("Water plants", { due: "2026-08-15", recurrence: "weekly" }))!;
      await svc.toggleDone(weekly);
      expect((await svc.task(weekly))?.due).toBe("2026-09-12"); // still a Saturday
      const daily = (await svc.createTask("Stretch", { due: "2026-08-31", recurrence: "daily" }))!;
      await svc.toggleDone(daily);
      expect((await svc.task(daily))?.due).toBe("2026-09-06");
    } finally {
      vi.useRealTimers();
    }
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
