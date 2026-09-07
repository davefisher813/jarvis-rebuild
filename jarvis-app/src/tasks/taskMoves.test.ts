import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { scheduleTask, breakDownTask, undoBreakdown } from "./taskMoves";
import { TasksService } from "./TasksService";
import { ScheduleService } from "../schedule/ScheduleService";
import { anytimeTasksForDay } from "../schedule/anytime";
import { moveEventToAnytime } from "../schedule/eventMoves";
import { liveBlocks } from "../dayloop/dayLoop";
import { sourceLine } from "../shared/provenance";
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

// TRACE-01 (2026-09-07, Dave: "there is no trace of events or steps (for
// tasks) anywhere in the app"). Add to Schedule wrote a block with no
// sourceTaskId, which is the only field the app reads to know a task already
// has a time. These are the three things he was looking at, end to end
// through the real services rather than against the stub above.
describe("Add to Schedule links the block back to its task (TRACE-01)", () => {
  const today = "2026-09-07";
  const now = new Date(2026, 8, 7, 8, 0, 0);

  async function scheduled() {
    const store = new Store(new InMemoryAdapter());
    const tasks = new TasksService(store, "u");
    const schedule = new ScheduleService(store, "u");
    const id = (await tasks.createTask("File the Calder invoice", { category: "work" }))!;
    const res = await scheduleTask(id, today, tasks, schedule, now);
    const events = await schedule.eventsOn(today);
    return { tasks, schedule, id, res, events };
  }

  it("the block carries the task id and says where it came from", async () => {
    const { id, events } = await scheduled();
    expect(events.length).toBe(1);
    expect(events[0]!.data.sourceTaskId).toBe(id);
    expect(sourceLine(events[0]!.data.source)).toContain("From a task");
  });

  // anytime.ts:6-8 states the invariant: a task has a time once a block
  // carries its id. Without the link the same task rendered twice on one
  // screen, as a block in the day and as an unscheduled row above it.
  it("the task leaves the Anytime strip for that day", async () => {
    const { tasks, id, events } = await scheduled();
    const open = await tasks.listTasks();
    const strip = anytimeTasksForDay(open, events, today).map((t) => t.id);
    expect(strip).not.toContain(id);
  });

  // The Day Loop's own reader of the same field. A standing proposal for work
  // the day already holds is a notice repeating a question that was answered.
  it("Plan My Day and the Day Loop stop offering it", async () => {
    const { tasks, id, events } = await scheduled();
    const open = await tasks.listTasks();
    const live = liveBlocks(
      [{ taskId: id, text: "File the Calder invoice", category: "work", start: "13:00", end: "14:00" }],
      events,
      open,
    );
    expect(live).toEqual([]);
    // The same set the two planners build inline (ScheduleFlow.tsx:325,
    // TodayFlow.tsx:1027): the ids the day already holds.
    const planned = new Set(events.map((e) => e.data.sourceTaskId).filter(Boolean));
    expect(planned.has(id)).toBe(true);
  });

  // eventMoves.ts:47-51 only skips creating a task when the link is there,
  // and its comment names this exact bug as the reason that branch exists.
  it("Move to Anytime on that block does not mint a duplicate task", async () => {
    const { tasks, schedule, events } = await scheduled();
    const before = (await tasks.listTasks()).length;
    const res = await moveEventToAnytime(events[0]!.id, schedule, tasks);
    expect(res.madeTaskId).toBeUndefined();
    expect((await tasks.listTasks()).length).toBe(before);
  });
});
