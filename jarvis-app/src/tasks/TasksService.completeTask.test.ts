import { describe, it, expect, vi } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { TasksService } from "./TasksService";
import { todayISO, nextDue } from "./grouping";
import type { EventInput } from "../events";

// Issue 102, "completion does not persist from the Edit Task sheet". Mark Done
// on the sheet was a FLIP (toggleDone), so a task finished behind the sheet's
// back was reopened by the tap, and a write the store refused (answering false,
// which is not a throw) was reported as a success. completeTask SETS.

function setup() {
  const store = new Store(new InMemoryAdapter());
  const events: EventInput[] = [];
  const svc = new TasksService(store, "u", (e) => events.push(e));
  const count = (type: string) => events.filter((e) => e.type === type).length;
  return { store, svc, events, count };
}

describe("TasksService.completeTask: Mark Done sets, it does not flip", () => {
  it("finishes a one-time task and logs one completion", async () => {
    const { svc, count } = setup();
    const id = (await svc.createTask("Send Invoice", { due: todayISO() }))!;
    const r = await svc.completeTask(id);
    expect(r).toEqual({ ok: true, rolled: false, changed: true });
    expect((await svc.task(id))!.done).toBe(true);
    expect(count("task.completed")).toBe(1);
  });

  it("is a no-op the second time: still done, no second completion, no second write event", async () => {
    const { svc, count } = setup();
    const id = (await svc.createTask("Send Invoice", { due: todayISO() }))!;
    await svc.completeTask(id);
    const updates = count("entity.updated");
    const r = await svc.completeTask(id);
    expect(r).toEqual({ ok: true, rolled: false, changed: false });
    expect((await svc.task(id))!.done).toBe(true);
    expect(count("task.completed")).toBe(1);
    expect(count("entity.updated")).toBe(updates);
  });

  it("does not reopen a task that was finished behind the sheet's back (the flip bug)", async () => {
    const { svc } = setup();
    const id = (await svc.createTask("Send Invoice", { due: todayISO() }))!;
    await svc.toggleDone(id); // another surface finishes it
    expect((await svc.task(id))!.done).toBe(true);
    const r = await svc.completeTask(id); // the sheet, opened before that, taps Mark Done
    expect(r.ok).toBe(true);
    expect((await svc.task(id))!.done).toBe(true);
  });

  it("toggleDone still flips: a ring tap on a finished task reopens it", async () => {
    const { svc } = setup();
    const id = (await svc.createTask("Send Invoice", { due: todayISO() }))!;
    await svc.toggleDone(id);
    await svc.toggleDone(id);
    expect((await svc.task(id))!.done).toBe(false);
  });

  it("a repeating task rolls to its next date (by design) and says so", async () => {
    const { svc, count } = setup();
    const today = todayISO();
    const id = (await svc.createTask("Take Vitamins", { due: today, recurrence: "daily" }))!;
    const r = await svc.completeTask(id);
    const t = (await svc.task(id))!;
    expect(r).toEqual({ ok: true, rolled: true, changed: true, nextDue: nextDue(today, "daily") });
    expect(t.done).toBe(false);
    expect(t.due).toBe(r.nextDue);
    expect(t.due! > today).toBe(true);
    expect(t.lastDone).toBe(today);
    expect(t.runLen).toBe(1);
    expect(t.doneCount).toBe(1);
    expect(count("task.completed")).toBe(1);
  });

  it("a repeating task does not roll a second time on the same day (a retry or a double tap skips no occurrence)", async () => {
    const { svc, count } = setup();
    const today = todayISO();
    const id = (await svc.createTask("Take Vitamins", { due: today, recurrence: "daily" }))!;
    const first = await svc.completeTask(id);
    const again = await svc.completeTask(id);
    const t = (await svc.task(id))!;
    expect(again).toEqual({ ok: true, rolled: true, changed: false, nextDue: first.nextDue });
    expect(t.due).toBe(first.nextDue);
    expect(t.runLen).toBe(1);
    expect(t.doneCount).toBe(1);
    expect(count("task.completed")).toBe(1);
  });

  it("a missing task is not ok", async () => {
    const { svc } = setup();
    expect(await svc.completeTask("nope")).toEqual({ ok: false, rolled: false, changed: false });
  });

  it("a store that refuses the write (false) is a failure: nothing is logged", async () => {
    const { store, svc, count } = setup();
    const id = (await svc.createTask("Send Invoice", { due: todayISO() }))!;
    vi.spyOn(store, "update").mockResolvedValue(false);
    const r = await svc.completeTask(id);
    expect(r.ok).toBe(false);
    expect(count("task.completed")).toBe(0);
    expect(count("entity.updated")).toBe(0);
  });

  it("a refused write on a repeating task is a failure too", async () => {
    const { store, svc, count } = setup();
    const id = (await svc.createTask("Take Vitamins", { due: todayISO(), recurrence: "daily" }))!;
    vi.spyOn(store, "update").mockResolvedValue(false);
    expect((await svc.completeTask(id)).ok).toBe(false);
    expect(count("task.completed")).toBe(0);
  });

  it("a queued write (offline) is ok: it is held and will land", async () => {
    const { store, svc } = setup();
    const id = (await svc.createTask("Send Invoice", { due: todayISO() }))!;
    vi.spyOn(store, "update").mockResolvedValue("queued");
    expect((await svc.completeTask(id)).ok).toBe(true);
  });

  it("a bill stamps lastDone when it is finished", async () => {
    const { svc } = setup();
    const id = (await svc.recreateFrom({ text: "Water Bill", category: "", done: false, due: todayISO(), bill: { amount: 40 } }))!;
    expect((await svc.completeTask(id)).ok).toBe(true);
    const t = (await svc.task(id))!;
    expect(t.done).toBe(true);
    expect(t.lastDone).toBe(todayISO());
  });
});

describe("TasksService.toggleDone: a refused write is not a completion", () => {
  it("answers false and logs nothing when the store refuses the done write", async () => {
    const { store, svc, count } = setup();
    const id = (await svc.createTask("Send Invoice", { due: todayISO() }))!;
    vi.spyOn(store, "update").mockResolvedValue(false);
    expect(await svc.toggleDone(id)).toBe(false);
    expect(count("task.completed")).toBe(0);
  });

  it("answers false when the store refuses a reopen", async () => {
    const { store, svc } = setup();
    const id = (await svc.createTask("Send Invoice", { due: todayISO() }))!;
    await svc.toggleDone(id);
    vi.spyOn(store, "update").mockResolvedValue(false);
    expect(await svc.toggleDone(id)).toBe(false);
  });
});
