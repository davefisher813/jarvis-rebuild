import { describe, it, expect, vi } from "vitest";
import type { TaskData } from "../../notes/types";
import { executeProposal, type Executed, type WriteDeps } from "./execute";
import type { ProposalContent } from "./proposals";

// MAKING THE CHANGE (chat box order, 2026-10-24): the only place a proposal becomes a write. The receipts come from what was made, every
// write brings an Undo built from the record as it was, and a card is a promise about a task as the person saw it.

const base = (over: Partial<TaskData> = {}): TaskData => ({ text: "Call the plumber", category: "", done: false, due: "2026-10-29", ...over });

// An in-memory stand-in for the two services, behaving as they do for the fields these writes touch.
function world(start: Record<string, TaskData> = { t1: base() }) {
  const tasks = new Map<string, TaskData>(Object.entries(start).map(([k, v]) => [k, { ...v }]));
  const decisions = new Map<string, { decision: string; why?: string; ruledOut?: string }>();
  let n = 0;
  const deps = {
    task: vi.fn(async (id: string) => (tasks.has(id) ? { ...tasks.get(id)! } : null)),
    createTask: vi.fn(async (text: string, o: { due?: string; priority?: "high" | "low"; personId?: string }) => {
      if (!text.trim()) return null;
      const id = `new${++n}`;
      tasks.set(id, { text: text.trim(), category: "", done: false, ...(o.due ? { due: o.due } : {}), ...(o.priority ? { priority: o.priority } : {}), ...(o.personId ? { personId: o.personId } : {}) });
      return id;
    }),
    deleteTask: vi.fn(async (id: string) => { tasks.delete(id); }),
    setDue: vi.fn(async (id: string, due: string | null) => { const t = tasks.get(id); if (!t) return false; t.due = due; return true; }),
    completeTask: vi.fn(async (id: string): Promise<{ ok: boolean; rolled: boolean; changed: boolean; nextDue?: string }> => {
      const t = tasks.get(id);
      if (!t) return { ok: false, rolled: false, changed: false };
      t.done = true;
      return { ok: true, rolled: false, changed: true };
    }),
    restoreCompletion: vi.fn(async (id: string, before: TaskData) => { const t = tasks.get(id); if (!t) return false; t.done = before.done; t.due = before.due ?? null; return true; }),
    editText: vi.fn(async (id: string, text: string) => { const t = tasks.get(id); if (!t || !text.trim()) return false; t.text = text.trim(); return true; }),
    setPriority: vi.fn(async (id: string, p: "high" | "low" | null) => { const t = tasks.get(id); if (!t) return false; if (p) t.priority = p; else delete t.priority; return true; }),
    createDecision: vi.fn(async (d: { decision: string; why?: string; ruledOut?: string }): Promise<string | null> => { const id = `d${++n}`; decisions.set(id, d); return id; }),
    removeDecision: vi.fn(async (id: string) => { decisions.delete(id); }),
  } satisfies WriteDeps;
  return { tasks, decisions, deps };
}

const update = (change: Extract<ProposalContent, { kind: "update_task" }>["change"], basis?: Partial<TaskData>): ProposalContent => ({
  kind: "update_task", taskId: "t1", title: "Call the plumber",
  basis: { text: "Call the plumber", due: "2026-10-29", done: false, priority: null, ...basis } as never,
  change,
});
const ok = (r: Executed) => { if (!r.ok) throw new Error("expected success: " + r.message); return r; };

describe("a new task", () => {
  it("is made with exactly what the card showed, and the receipt says what was made", async () => {
    const w = world({});
    const r = ok(await executeProposal({ kind: "create_task", text: "Pay rent", due: "2026-11-01", priority: "high", personId: "m1", personName: "Marco" }, w.deps));
    expect(w.deps.createTask).toHaveBeenCalledWith("Pay rent", { due: "2026-11-01", priority: "high", personId: "m1" });
    expect(r.receipt).toBe("Added: Pay rent");
    expect(r.toast).toBe("Task added");
    const id = r.refs[0]!.id;
    expect(r.refs).toEqual([{ kind: "task", id, label: "Pay rent" }]);
    expect(w.tasks.get(id)).toMatchObject({ text: "Pay rent", due: "2026-11-01", priority: "high", personId: "m1", done: false });
  });

  it("Undo takes it away again", async () => {
    const w = world({});
    const r = ok(await executeProposal({ kind: "create_task", text: "Pay rent" }, w.deps));
    expect(w.tasks.size).toBe(1);
    await r.undo();
    expect(w.tasks.size).toBe(0);
  });

  it("passes only what was on the card: no date, priority or person that was not shown", async () => {
    const w = world({});
    await executeProposal({ kind: "create_task", text: "Pay rent" }, w.deps);
    expect(w.deps.createTask).toHaveBeenCalledWith("Pay rent", {});
  });

  it("a store that will not take it is a failure that says nothing was added, never a receipt", async () => {
    const w = world({});
    w.deps.createTask.mockResolvedValueOnce(null);
    expect(await executeProposal({ kind: "create_task", text: "Pay rent" }, w.deps)).toEqual({ ok: false, message: "That task could not be saved · Nothing was added" });
  });

  it("a write that throws is a failure in the app's own words, and does not throw on", async () => {
    const w = world({});
    w.deps.createTask.mockRejectedValueOnce(new Error("socket hang up: tasks/u-123"));
    const r = await executeProposal({ kind: "create_task", text: "Pay rent" }, w.deps);
    expect(r).toEqual({ ok: false, message: "Couldn't Save · Check Your Connection" });
  });
});

describe("a change to a task", () => {
  it("moves a date, says so with the new day, and Undo puts the old day back", async () => {
    const w = world();
    const r = ok(await executeProposal(update({ due: "2026-10-31" }), w.deps));
    expect(w.tasks.get("t1")!.due).toBe("2026-10-31");
    expect(r.receipt).toBe("Moved to Sat, Oct 31: Call the plumber");
    expect(r.toast).toBe("Task moved");
    await r.undo();
    expect(w.tasks.get("t1")!.due).toBe("2026-10-29");
  });

  it("a title with a line break in it is a plain line in the receipt and the chip", async () => {
    const w = world({ t1: base({ text: "Pay invoice\nDue Tue" }) });
    const r = ok(await executeProposal({ kind: "update_task", taskId: "t1", title: "Pay invoice\nDue Tue", basis: { text: "Pay invoice\nDue Tue", due: "2026-10-29", done: false, priority: null }, change: { done: true } }, w.deps));
    expect(r.receipt).toBe("Done: Pay invoice Due Tue");
    expect(r.refs[0]!.label).toBe("Pay invoice Due Tue");
  });

  it("clears a date and can bring it back", async () => {
    const w = world();
    const r = ok(await executeProposal(update({ due: null }), w.deps));
    expect(w.tasks.get("t1")!.due).toBeNull();
    expect(r.receipt).toBe("Cleared the date: Call the plumber");
    await r.undo();
    expect(w.tasks.get("t1")!.due).toBe("2026-10-29");
  });

  it("finishes a task, and Undo reopens it through the app's own restore", async () => {
    const w = world();
    const r = ok(await executeProposal(update({ done: true }), w.deps));
    expect(w.tasks.get("t1")!.done).toBe(true);
    expect(r.receipt).toBe("Done: Call the plumber");
    expect(r.toast).toBe("Task completed");
    await r.undo();
    expect(w.tasks.get("t1")!.done).toBe(false);
    expect(w.deps.restoreCompletion).toHaveBeenCalledTimes(1);
    expect(w.deps.restoreCompletion.mock.calls[0]![1]).toMatchObject({ done: false, due: "2026-10-29" });
  });

  it("renames, and Undo restores the old words", async () => {
    const w = world();
    const r = ok(await executeProposal(update({ text: "Call the plumber about the leak" }), w.deps));
    expect(w.tasks.get("t1")!.text).toBe("Call the plumber about the leak");
    expect(r.receipt).toBe("Renamed: Call the plumber about the leak");
    expect(r.refs).toEqual([{ kind: "task", id: "t1", label: "Call the plumber about the leak" }]);
    await r.undo();
    expect(w.tasks.get("t1")!.text).toBe("Call the plumber");
  });

  it("sets and clears a priority", async () => {
    const w = world();
    const up = ok(await executeProposal(update({ priority: "high" }), w.deps));
    expect(w.tasks.get("t1")!.priority).toBe("high");
    await up.undo();
    expect(w.tasks.get("t1")!.priority).toBeUndefined();
    const w2 = world({ t1: base({ priority: "high" }) });
    ok(await executeProposal(update({ priority: null }, { priority: "high" } as never), w2.deps));
    expect(w2.tasks.get("t1")!.priority).toBeUndefined();
  });

  it("several changes at once land together and are taken back together, last first", async () => {
    const w = world();
    const r = ok(await executeProposal(update({ text: "Call the plumber today", due: "2026-10-30", priority: "high", done: true }), w.deps));
    expect(w.tasks.get("t1")).toMatchObject({ text: "Call the plumber today", due: "2026-10-30", priority: "high", done: true });
    expect(r.receipt).toBe("Changed: Call the plumber today");
    expect(r.toast).toBe("Task completed");
    await r.undo();
    expect(w.tasks.get("t1")).toMatchObject({ text: "Call the plumber", due: "2026-10-29", done: false });
    expect(w.tasks.get("t1")!.priority).toBeUndefined();
  });

  it("an Undo with one step that will not go still puts the others back, and says it did not finish", async () => {
    const w = world();
    const r = ok(await executeProposal(update({ text: "Call the plumber today", due: "2026-10-30", priority: "high" }), w.deps));
    w.deps.setPriority.mockRejectedValueOnce(new Error("offline"));
    await expect(r.undo()).rejects.toThrow("undo incomplete");
    expect(w.tasks.get("t1")).toMatchObject({ text: "Call the plumber", due: "2026-10-29" });
  });

  it("a step that fails part-way takes back what landed and reports that nothing was changed", async () => {
    const w = world();
    w.deps.setDue.mockResolvedValueOnce(false);
    const r = await executeProposal(update({ text: "Call the plumber today", priority: "high", due: "2026-10-30" }), w.deps);
    expect(r).toEqual({ ok: false, message: "That change could not be saved · Nothing was changed" });
    expect(w.tasks.get("t1")).toMatchObject({ text: "Call the plumber", due: "2026-10-29" });
    expect(w.tasks.get("t1")!.priority).toBeUndefined();
  });

  it("a step that throws is the same: undone, and said", async () => {
    const w = world();
    w.deps.setPriority.mockRejectedValueOnce(new Error("offline"));
    const r = await executeProposal(update({ text: "Call the plumber today", priority: "high" }), w.deps);
    expect(r).toMatchObject({ ok: false, message: "That change could not be saved · Nothing was changed" });
    expect(w.tasks.get("t1")!.text).toBe("Call the plumber");
  });
});

describe("a task that repeats is done for today, not finished, and the thread says so", () => {
  const repeating = (): ReturnType<typeof world> => {
    const w = world({ t1: base({ text: "Water the plants", due: "2026-10-26" }) });
    w.deps.completeTask.mockImplementation(async (id: string) => {
      const t = w.tasks.get(id)!;
      t.due = "2026-10-27"; // rolled, not done
      return { ok: true, rolled: true, changed: true, nextDue: "2026-10-27" };
    });
    return w;
  };
  const tick = (rollsTo = "2026-10-27"): ProposalContent => ({
    kind: "update_task", taskId: "t1", title: "Water the plants",
    basis: { text: "Water the plants", due: "2026-10-26", done: false, priority: null }, change: { done: true }, rollsTo,
  });

  it("the receipt and the toast say what happened to it: done for today, and the date it moved to", async () => {
    const w = repeating();
    const r = ok(await executeProposal(tick(), w.deps));
    expect(r.receipt).toBe("Done for today: Water the plants · Next Tue, Oct 27");
    expect(r.toast).toBe("Ticked off for today");
    expect(w.tasks.get("t1")).toMatchObject({ done: false, due: "2026-10-27" });
  });

  it("Undo puts it back through the app's own restore", async () => {
    const w = repeating();
    w.deps.restoreCompletion.mockImplementation(async (id: string, before: TaskData) => { w.tasks.get(id)!.due = before.due ?? null; return true; });
    const r = ok(await executeProposal(tick(), w.deps));
    await r.undo();
    expect(w.tasks.get("t1")!.due).toBe("2026-10-26");
    expect(w.deps.restoreCompletion).toHaveBeenCalledTimes(1);
  });

  it("a tick that wrote nothing (already ticked today) is no success: no receipt, and it says so", async () => {
    const w = world({ t1: base({ text: "Water the plants", due: "2026-10-26" }) });
    w.deps.completeTask.mockResolvedValueOnce({ ok: true, rolled: true, changed: false, nextDue: "2026-10-27" });
    expect(await executeProposal(tick(), w.deps)).toEqual({ ok: false, message: "That change could not be saved · Nothing was changed" });
    expect(w.deps.restoreCompletion).not.toHaveBeenCalled();
  });

  it("a next date other than the one the card showed (the day turned over) is put back, and the card's promise is not broken quietly", async () => {
    const w = repeating();
    w.deps.restoreCompletion.mockImplementation(async (id: string, before: TaskData) => { w.tasks.get(id)!.due = before.due ?? null; return true; });
    const r = await executeProposal(tick("2026-10-28"), w.deps);
    expect(r).toEqual({ ok: false, message: "That repeating task's next date is not the one this card showed · Nothing was changed" });
    expect(w.tasks.get("t1")!.due).toBe("2026-10-26");
  });
});

describe("what could not be put back is not said to be nothing", () => {
  it("a failure part-way where a step will not go back says the change was saved in part", async () => {
    const w = world();
    w.deps.setDue.mockResolvedValueOnce(false);
    w.deps.editText.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error("offline"));
    const r = await executeProposal(update({ text: "Call the plumber today", due: "2026-10-30" }), w.deps);
    expect(r).toEqual({ ok: false, message: "That change was only saved in part · Check the task" });
    expect(w.deps.editText).toHaveBeenCalledTimes(2);
  });

  it("a step the service refuses on the way back (it answers false) counts the same", async () => {
    const w = world();
    w.deps.setDue.mockResolvedValueOnce(false);
    w.deps.editText.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const r = await executeProposal(update({ text: "Call the plumber today", due: "2026-10-30" }), w.deps);
    expect(r).toEqual({ ok: false, message: "That change was only saved in part · Check the task" });
  });

  it("an Undo that a step refuses (the task is gone) fails loudly instead of ending as though it worked", async () => {
    const w = world();
    const r = ok(await executeProposal(update({ due: "2026-10-31" }), w.deps));
    w.tasks.delete("t1");
    await expect(r.undo()).rejects.toThrow("undo incomplete");
  });
});

describe("a card is a promise about the task as the person saw it", () => {
  const writes = (w: ReturnType<typeof world>) => [w.deps.setDue, w.deps.completeTask, w.deps.editText, w.deps.setPriority, w.deps.restoreCompletion];

  it("a task that is gone is not changed", async () => {
    const w = world({});
    expect(await executeProposal(update({ due: "2026-10-31" }), w.deps)).toEqual({ ok: false, message: "That task is gone · Nothing was changed" });
    for (const f of writes(w)) expect(f).not.toHaveBeenCalled();
  });

  it("a task finished somewhere else in the meantime is not touched", async () => {
    const w = world({ t1: base({ done: true }) });
    expect(await executeProposal(update({ due: "2026-10-31" }), w.deps)).toEqual({ ok: false, message: "That task is already done · Nothing was changed" });
    for (const f of writes(w)) expect(f).not.toHaveBeenCalled();
  });

  it("a task edited since the card was drawn is not overwritten: words, date or priority", async () => {
    for (const edited of [{ text: "Call the electrician" }, { due: "2026-11-05" }, { priority: "low" as const }]) {
      const w = world({ t1: base(edited) });
      const r = await executeProposal(update({ done: true }), w.deps);
      expect(r, JSON.stringify(edited)).toEqual({ ok: false, message: "That task changed since this card was drawn · Nothing was changed" });
      for (const f of writes(w)) expect(f).not.toHaveBeenCalled();
    }
  });

  it("a task that became a bill or a reminder is left to the screens that own those", async () => {
    for (const kind of [{ bill: { amount: 10 } as never }, { reminder: { time: "09:00" } as never }]) {
      const w = world({ t1: base(kind) });
      const r = await executeProposal(update({ due: "2026-10-31" }), w.deps);
      expect(r).toEqual({ ok: false, message: "That one is changed somewhere else · Nothing was changed" });
      for (const f of writes(w)) expect(f).not.toHaveBeenCalled();
    }
  });
});

describe("a decision", () => {
  it("is saved as worded, and Undo removes it", async () => {
    const w = world({});
    const r = ok(await executeProposal({ kind: "capture_decision", decision: "Use Ridgeline", why: "Best warranty", ruledOut: "Summit" }, w.deps));
    expect(w.deps.createDecision).toHaveBeenCalledWith({ decision: "Use Ridgeline", why: "Best warranty", ruledOut: "Summit" });
    expect(r.receipt).toBe("Saved decision · Use Ridgeline");
    expect(r.toast).toBe("Saved decision");
    expect(r.refs).toEqual([{ kind: "decision", id: r.refs[0]!.id, label: "Use Ridgeline" }]);
    expect(w.decisions.size).toBe(1);
    await r.undo();
    expect(w.decisions.size).toBe(0);
  });

  it("carries no reason or road not taken that the card did not show", async () => {
    const w = world({});
    await executeProposal({ kind: "capture_decision", decision: "Use Ridgeline" }, w.deps);
    expect(w.deps.createDecision).toHaveBeenCalledWith({ decision: "Use Ridgeline" });
  });

  it("a store that will not take it is a failure that says so", async () => {
    const w = world({});
    w.deps.createDecision.mockResolvedValueOnce(null);
    expect(await executeProposal({ kind: "capture_decision", decision: "x" }, w.deps)).toEqual({ ok: false, message: "That decision could not be saved · Nothing was added" });
  });
});
