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
  // LIFE-F-10 (2026-09-05): the Area filter matched the primary only, so a
  // task tagged Family as an extra was missing from Area = Family while the
  // Family category page listed it.
  it("byCategory finds a task by an extra area too", () => {
    const items = [
      { id: "1", data: mk({ category: "work", extraCategories: ["family"] }) },
      { id: "2", data: mk({ category: "home" }) },
    ];
    expect(byCategory(items, "family").map((i) => i.id)).toEqual(["1"]);
    expect(byCategory(items, "work").map((i) => i.id)).toEqual(["1"]);
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

  // HMN-F-11 (2026-09-05): a once bill on autopay was skipped by the roll
  // (`!d.recurrence` on TasksService.ts:166), so after its date it read "Set
  // to autopay · today" every day, stayed in the Bills count, and had no
  // checkbox. Deleting it was the only way out.
  it("a once autopay bill whose date has passed is marked handled, with the scheduled date", async () => {
    const store = new Store(new InMemoryAdapter());
    const events: string[] = [];
    const svc = new TasksService(store, "u1", (e) => events.push(e.type));
    const id = await svc.createTask("Car Registration", { due: "2026-07-20", bill: { amount: 85, autopay: true } });
    const ahead = await svc.createTask("Insurance", { due: "2026-09-01", bill: { amount: 300, autopay: true } });
    events.length = 0;
    expect(await svc.rollAutopayBills("2026-08-03")).toBe(1);
    const t = await svc.task(id!);
    expect(t!.done).toBe(true);
    expect(t!.lastDone).toBe("2026-07-20"); // the date the payment was SCHEDULED
    expect(t!.due).toBe("2026-07-20"); // nothing to roll to: a once bill has no next
    // Nothing is claimed to have been paid: the copy layer says "scheduled".
    expect(events).not.toContain("task.completed");
    // A once autopay bill still ahead of its date is left alone.
    expect((await svc.task(ahead!))!.done).toBe(false);
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

describe("steps on the task entity (2026-09-04, 'isn't there supposed to be an option to assign steps to a task?')", () => {
  it("createTask stores steps, trimmed and stripped of blank lines", async () => {
    const store = new Store(new InMemoryAdapter());
    const svc = new TasksService(store, "u1");
    const id = await svc.createTask("Plan the trip", {
      steps: [{ text: "  Book flights  ", done: false }, { text: "   ", done: false }, { text: "Pack", done: true }],
    });
    const t = await svc.task(id!);
    expect(t!.steps).toEqual([{ text: "Book flights", done: false }, { text: "Pack", done: true }]);
  });

  it("a task with no steps stores none", async () => {
    const store = new Store(new InMemoryAdapter());
    const svc = new TasksService(store, "u1");
    const id = await svc.createTask("Simple task");
    const t = await svc.task(id!);
    expect(t!.steps).toBeUndefined();
  });

  it("setSteps replaces the whole list, and clears it back to undefined when empty", async () => {
    const store = new Store(new InMemoryAdapter());
    const svc = new TasksService(store, "u1");
    const id = await svc.createTask("Ship the feature", { steps: [{ text: "Write code", done: true }] });
    await svc.setSteps(id!, [{ text: "Write code", done: true }, { text: "Write tests", done: false }]);
    let t = await svc.task(id!);
    expect(t!.steps).toEqual([{ text: "Write code", done: true }, { text: "Write tests", done: false }]);
    await svc.setSteps(id!, []);
    t = await svc.task(id!);
    expect(t!.steps).toBeFalsy();
  });

  it("setSteps never touches the task's own done -- display-only, Close Task is the only thing that completes it", async () => {
    const store = new Store(new InMemoryAdapter());
    const svc = new TasksService(store, "u1");
    const id = await svc.createTask("Ship the feature");
    await svc.setSteps(id!, [{ text: "Write code", done: true }, { text: "Write tests", done: true }]);
    const t = await svc.task(id!);
    expect(t!.done).toBe(false);
  });

  it("setSteps on a task that doesn't exist returns false", async () => {
    const store = new Store(new InMemoryAdapter());
    const svc = new TasksService(store, "u1");
    expect(await svc.setSteps("nope", [{ text: "x", done: false }])).toBe(false);
  });
});

// B1-3 (2026-09-04): "Undo after deleting a task restores a stripped copy."
// Seven Undo sites across the app used to recreate with only text, category,
// due and recurrence. recreateFrom is the one function all of them now call.
describe("recreateFrom (undo-after-delete restores the whole task)", () => {
  it("carries project, extra areas, if-then plan, steps and bill amount, not just the bare fields", async () => {
    const store = new Store(new InMemoryAdapter());
    const svc = new TasksService(store, "u1");
    const id = await svc.createTask("Renew the lease", {
      category: "home",
      extraCategories: ["money"],
      due: "2026-09-10",
      recurrence: "monthly",
      projectId: "proj-1",
      bill: { amount: 2200 },
      plan: { cue: { kind: "after", what: "coffee" }, then: "call the landlord" },
      steps: [{ text: "Call landlord", done: false }],
      fromNote: "note-1",
      fromThread: "thread-1",
    });
    const original = await svc.task(id!);
    await svc.deleteTask(id!);
    const restoredId = await svc.recreateFrom(original!);
    const restored = await svc.task(restoredId!);
    expect(restored).toMatchObject({
      text: "Renew the lease",
      category: "home",
      extraCategories: ["money"],
      due: "2026-09-10",
      recurrence: "monthly",
      projectId: "proj-1",
      bill: { amount: 2200 },
      plan: { cue: { kind: "after", what: "coffee" }, then: "call the landlord" },
      steps: [{ text: "Call landlord", done: false }],
      fromNote: "note-1",
      fromThread: "thread-1",
    });
  });

  it("a bare task with none of the extras restores just as bare", async () => {
    const store = new Store(new InMemoryAdapter());
    const svc = new TasksService(store, "u1");
    const id = await svc.createTask("Buy milk", { category: "errands" });
    const original = await svc.task(id!);
    const restoredId = await svc.recreateFrom(original!);
    const restored = await svc.task(restoredId!);
    expect(restored!.projectId).toBeUndefined();
    expect(restored!.plan).toBeUndefined();
    expect(restored!.steps).toBeUndefined();
    expect(restored!.bill).toBeUndefined();
  });
});

// SHARED-F-03 (2026-09-05): "Undo re-does." The completion toast lives for
// five seconds and the row underneath stays tappable, so Undo has to write
// the state it means to restore rather than flip whatever the row is now.
describe("Undo on a completion toast (SHARED-F-03)", () => {
  it("leaves a task the user already un-ticked by hand alone", async () => {
    const svc = new TasksService(new Store(new InMemoryAdapter()), "u-undo-f03");
    const id = (await svc.createTask("Email Sam", { due: "2026-09-05" }))!;
    const before = (await svc.task(id))!;
    await svc.toggleDone(id);            // the tick that raised the toast
    await svc.toggleDone(id);            // the row un-ticked by hand
    await svc.restoreCompletion(id, before); // Undo, tapped late
    expect((await svc.task(id))?.done).toBe(false);
  });

  it("is the same answer however many times it is tapped", async () => {
    const svc = new TasksService(new Store(new InMemoryAdapter()), "u-undo-f03b");
    const id = (await svc.createTask("Water plants", { due: "2026-09-05", recurrence: "weekly" }))!;
    const before = (await svc.task(id))!;
    await svc.toggleDone(id);
    await svc.restoreCompletion(id, before);
    await svc.restoreCompletion(id, before);
    const after = await svc.task(id);
    expect(after?.due).toBe("2026-09-05");
    expect(after?.runLen ?? 0).toBe(0);
  });
});

// UP-CORE-02 (2026-09-05): a task that knows how long it takes. The number
// is his, it survives a delete and an Undo, and clearing it hands the
// question back to the learned category median rather than storing a zero.
describe("how long this one takes (UP-CORE-02)", () => {
  it("stores minutes, clears to nothing, and refuses an impossible length", async () => {
    const svc = new TasksService(new Store(new InMemoryAdapter()), "u-est");
    const id = (await svc.createTask("Call the dentist", { estimateMin: 15 }))!;
    expect((await svc.task(id))?.estimateMin).toBe(15);
    await svc.setEstimate(id, 90);
    expect((await svc.task(id))?.estimateMin).toBe(90);
    await svc.setEstimate(id, null);
    expect((await svc.task(id))?.estimateMin ?? null).toBeNull();
    // Not a length: dropped rather than clamped into one he never chose.
    await svc.setEstimate(id, -5);
    expect((await svc.task(id))?.estimateMin ?? null).toBeNull();
    const wild = (await svc.createTask("Wild", { estimateMin: 100000 }))!;
    expect((await svc.task(wild))?.estimateMin).toBeUndefined();
  });

  it("comes back with the task after an undo", async () => {
    const svc = new TasksService(new Store(new InMemoryAdapter()), "u-est2");
    const id = (await svc.createTask("Write the report", { estimateMin: 120 }))!;
    const snapshot = (await svc.task(id))!;
    await svc.deleteTask(id);
    const back = (await svc.recreateFrom(snapshot, id))!;
    expect((await svc.task(back))?.estimateMin).toBe(120);
  });
});
