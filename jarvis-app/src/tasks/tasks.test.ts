import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { TasksService } from "./TasksService";
import { NotesService } from "../notes/NotesService";
import { STEPS, TODAY, addDays, type Ctx } from "./tasksSpec";
import { groupFor, urgencyFor, todayISO } from "./grouping";
import type { TaskData } from "../notes/types";

describe("Tasks behavior contract (approved harness)", () => {
  const store = new Store(new InMemoryAdapter());
  const tasks = new TasksService(store, "user1");
  const notes = new NotesService(store, "user1");
  const ctx: Ctx = { ids: {} };

  for (const step of STEPS) {
    it(`[${step.kind}] ${step.label}`, async () => {
      const r = await step.run(tasks, notes, ctx);
      expect(r.ok, r.msg).toBe(true);
    });
  }
});

describe("grouping logic", () => {
  const mk = (over: Partial<TaskData>): TaskData => ({ text: "x", category: "brain", done: false, ...over });

  it("done tasks group as done regardless of due date", () => {
    expect(groupFor(mk({ done: true, due: TODAY }), TODAY)).toBe("done");
  });
  it("no due date groups as upcoming with no urgency", () => {
    const t = mk({});
    expect(groupFor(t, TODAY)).toBe("upcoming");
    expect(urgencyFor(t, TODAY)).toBeNull();
  });
  it("due today groups as today with a TODAY tag", () => {
    const t = mk({ due: TODAY });
    expect(groupFor(t, TODAY)).toBe("today");
    expect(urgencyFor(t, TODAY)).toEqual({ label: "TODAY", kind: "today" });
  });
  it("a past-due daily never shows OVERDUE, only TODAY", () => {
    const t = mk({ due: addDays(TODAY, -2), recurrence: "daily" });
    expect(groupFor(t, TODAY)).toBe("today");
    expect(urgencyFor(t, TODAY)).toEqual({ label: "TODAY", kind: "today" });
  });
  it("overdue groups as today with an OVERDUE tag", () => {
    const t = mk({ due: addDays(TODAY, -2) });
    expect(groupFor(t, TODAY)).toBe("today");
    expect(urgencyFor(t, TODAY)?.kind).toBe("overdue");
  });
  it("within a week shows a weekday tag", () => {
    expect(urgencyFor(mk({ due: addDays(TODAY, 3) }), TODAY)).toEqual({ label: "TUE", kind: "soon" });
  });
  it("further out shows a month-day tag", () => {
    expect(urgencyFor(mk({ due: addDays(TODAY, 20) }), TODAY)).toEqual({ label: "JUN 12", kind: "soon" });
  });
  it("todayISO formats as YYYY-MM-DD", () => {
    expect(todayISO(new Date("2026-05-23T15:00:00"))).toBe("2026-05-23");
  });
});

import { partition, filterOf, byCategory } from "./filters";

describe("filter partitioning (chips)", () => {
  const mk = (over: Partial<TaskData>): TaskData => ({ text: "x", category: "brain", done: false, ...over });
  it("splits overdue out of today", () => {
    expect(filterOf(mk({ due: TODAY }), TODAY)).toBe("today");
    expect(filterOf(mk({ due: addDays(TODAY, -1) }), TODAY)).toBe("overdue");
    expect(filterOf(mk({ due: addDays(TODAY, 5) }), TODAY)).toBe("upcoming");
    expect(filterOf(mk({}), TODAY)).toBe("upcoming");
    expect(filterOf(mk({ done: true, due: TODAY }), TODAY)).toBe("done");
  });
  it("partition counts each chip", () => {
    const items = [
      { id: "1", data: mk({ due: TODAY }) },
      { id: "2", data: mk({ due: addDays(TODAY, -1) }) },
      { id: "3", data: mk({ due: addDays(TODAY, 3) }) },
      { id: "4", data: mk({}) },
      { id: "5", data: mk({ done: true }) },
    ];
    const p = partition(items, TODAY);
    expect(p.today.length).toBe(1);
    expect(p.overdue.length).toBe(1);
    expect(p.upcoming.length).toBe(2);
    expect(p.done.length).toBe(1);
  });
  it("byCategory narrows to one group, 'all' keeps everything", () => {
    const items = [
      { id: "1", data: mk({ category: "work" }) },
      { id: "2", data: mk({ category: "home" }) },
      { id: "3", data: mk({ category: "work" }) },
    ];
    expect(byCategory(items, "all").length).toBe(3);
    expect(byCategory(items, "").length).toBe(3);
    expect(byCategory(items, "work").map((i) => i.id)).toEqual(["1", "3"]);
    expect(byCategory(items, "home").length).toBe(1);
    expect(byCategory(items, "missing").length).toBe(0);
  });
});

describe("bills on the task entity (Money v1)", () => {
  it("a one-time bill stamps a dated receipt on completion", async () => {
    const store = new Store(new InMemoryAdapter());
    const svc = new TasksService(store, "u1");
    const id = await svc.createTask("Deposit for trip", { due: todayISO(), bill: { amount: 300 } });
    await svc.toggleDone(id!);
    const t = await svc.task(id!);
    expect(t!.done).toBe(true);
    expect(t!.lastDone).toBe(todayISO()); // the "Paid <date>" receipt source
    expect(t!.bill!.amount).toBe(300);
  });

  it("rollAutopayBills advances a lapsed autopay bill without a slip or completion", async () => {
    const store = new Store(new InMemoryAdapter());
    const events: string[] = [];
    const svc = new TasksService(store, "u1", (e) => events.push(e.type));
    const id = await svc.createTask("Rent", { due: "2026-07-01", recurrence: "monthly", bill: { amount: 1850, autopay: true } });
    const manual = await svc.createTask("Electric", { due: "2026-07-01", recurrence: "monthly", bill: { amount: 120 } });
    events.length = 0;
    const rolled = await svc.rollAutopayBills("2026-08-03");
    expect(rolled).toBe(1); // manual bills are NEVER auto-rolled
    const t = await svc.task(id!);
    expect(t!.due).toBe("2026-09-01");
    expect(t!.lastDone).toBe("2026-07-01"); // the date autopay was SCHEDULED
    expect(t!.slips ?? 0).toBe(0);
    // nothing claimed: no task.completed, no task.pushed
    expect(events).not.toContain("task.completed");
    expect(events).not.toContain("task.pushed");
    expect((await svc.task(manual!))!.due).toBe("2026-07-01"); // untouched, honestly overdue
  });

  it("updateBillTask edits facts without counting a slip", async () => {
    const store = new Store(new InMemoryAdapter());
    const events: string[] = [];
    const svc = new TasksService(store, "u1", (e) => events.push(e.type));
    const id = await svc.createTask("Internet", { due: "2026-08-05", recurrence: "monthly", bill: { amount: 80 } });
    events.length = 0;
    await svc.updateBillTask(id!, { due: "2026-08-20", bill: { amount: 85, payUrl: "https://pay.example.com" } });
    const t = await svc.task(id!);
    expect(t!.due).toBe("2026-08-20");
    expect(t!.bill!.amount).toBe(85);
    expect(t!.slips ?? 0).toBe(0);
    expect(events).not.toContain("task.pushed");
    // and it refuses to touch a non-bill task
    const plain = await svc.createTask("Not a bill");
    expect(await svc.updateBillTask(plain!, { due: "2026-08-20" })).toBe(false);
  });
});
