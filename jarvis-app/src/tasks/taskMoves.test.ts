import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { scheduleTask, breakDownTask, undoBreakdown } from "./taskMoves";
import { TasksService } from "./TasksService";
import type { AIService } from "../ai/AIService";

// LIFE-F-04 (2026-09-05): Add to Schedule used to take the task's due day
// whatever it was, so an overdue task booked its hour on a day that had
// already happened. These stubs record what day the event was written to.
function writers(due: string | null) {
  const created: { title: string; opts: Record<string, unknown> }[] = [];
  const tasks = {
    task: async () => ({ text: "File the Calder invoice", category: "work", due }),
    createTask: async () => null,
    recreateFrom: async () => null,
    deleteTask: async () => undefined,
  };
  const schedule = {
    eventsOn: async () => [],
    createEvent: async (title: string, opts: Record<string, unknown>) => { created.push({ title, opts }); },
  };
  return { tasks, schedule, created };
}

describe("scheduleTask", () => {
  const today = "2026-09-05";
  // 08:00 local, so the free-slot walk starts at the 09:00 day start.
  const now = new Date(2026, 8, 5, 8, 0, 0);

  it("books an overdue task on today, never on the day it was due", async () => {
    const { tasks, schedule, created } = writers("2026-08-20");
    const res = await scheduleTask("t1", today, tasks, schedule, now);
    expect(res).toEqual({ ok: true, date: today, start: "09:00" });
    expect(created[0]?.opts.date).toBe(today);
  });

  it("keeps a future due day", async () => {
    const { tasks, schedule, created } = writers("2026-09-20");
    const res = await scheduleTask("t1", today, tasks, schedule, now);
    expect(res.date).toBe("2026-09-20");
    expect(created[0]?.opts.date).toBe("2026-09-20");
  });

  it("books a task due today on today", async () => {
    const { tasks, schedule } = writers(today);
    expect((await scheduleTask("t1", today, tasks, schedule, now)).date).toBe(today);
  });

  it("books an undated task on today", async () => {
    const { tasks, schedule } = writers(null);
    expect((await scheduleTask("t1", today, tasks, schedule, now)).date).toBe(today);
  });

  it("reports not-ok when the task is gone", async () => {
    const tasks = { task: async () => null, createTask: async () => null, recreateFrom: async () => null, deleteTask: async () => undefined };
    const schedule = { eventsOn: async () => [], createEvent: async () => undefined };
    expect(await scheduleTask("gone", today, tasks, schedule, now)).toEqual({ ok: false });
  });
});

// LIFE-F-15 (2026-09-05): Undo of a Break It Down rebuilt the original from
// four fields, so it came back without its checklist, its plan, its extra
// areas, its bill or where it came from, and under a new id. The steps the
// split made inherited the primary area only.
describe("breakDownTask and its Undo (LIFE-F-15)", () => {
  const ai = { complete: async () => "Call the contractor\nPick the tiles\nBook the skip" } as unknown as AIService;

  it("the steps carry every area the original wore, and Undo puts the whole task back under its id", async () => {
    const svc = new TasksService(new Store(new InMemoryAdapter()), "u");
    const id = (await svc.createTask("Redo the kitchen", {
      category: "home",
      extraCategories: ["family"],
      due: "2026-09-10",
      recurrence: "weekly",
      steps: [{ text: "measure", done: false }],
      plan: { cue: { kind: "time", what: "08:30" }, then: "open the folder" },
    }))!;
    const original = { id, data: (await svc.task(id))! };

    const res = await breakDownTask(original.data.text, original, "2026-09-05", ai, svc, "");
    expect(res.made.length).toBe(3);
    const firstStep = await svc.task(res.made[0]!);
    expect(firstStep?.category).toBe("home");
    expect(firstStep?.extraCategories).toEqual(["family"]);
    expect(await svc.task(id)).toBeNull();

    await undoBreakdown(res.made, res.original, svc);
    const back = await svc.task(id);
    expect(back?.text).toBe("Redo the kitchen");
    expect(back?.extraCategories).toEqual(["family"]);
    expect(back?.recurrence).toBe("weekly");
    expect(back?.steps?.length).toBe(1);
    expect(back?.plan?.then).toBe("open the folder");
    for (const m of res.made) expect(await svc.task(m)).toBeNull();
  });
});
