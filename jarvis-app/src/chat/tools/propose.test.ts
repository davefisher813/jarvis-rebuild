import { describe, it, expect, vi } from "vitest";
import type { TaskData } from "../../notes/types";
import { ToolFailure } from "./dispatcher";
import { makeProposers, type ProposeDeps } from "./propose";

// THE TIER 1 TOOLS AS PROPOSALS (chat box order, 2026-10-24): a request for a write is judged against the record as it is NOW and becomes
// the content of a card. It changes nothing; it is handed two reads.

const task = (over: Partial<TaskData> = {}): TaskData => ({ text: "Call the plumber", category: "", done: false, due: "2026-10-29", ...over });

function setup(tasks: Record<string, TaskData> = { t1: task() }, people: Record<string, { name: string }> = { m1: { name: "Marco" } }) {
  const deps = {
    task: vi.fn(async (id: string) => tasks[id] ?? null),
    person: vi.fn(async (id: string) => people[id] ?? null),
  } satisfies ProposeDeps;
  return { deps, p: makeProposers(deps) };
}

async function failure(run: Promise<unknown>): Promise<ToolFailure> {
  try { await run; } catch (e) { if (e instanceof ToolFailure) return e; throw e; }
  throw new Error("expected a ToolFailure");
}

describe("create_task", () => {
  it("is the exact words, tidied, with only what was asked for", async () => {
    const { p } = setup();
    expect(await p.create_task({ text: "  Call   the plumber \n" })).toEqual({ kind: "create_task", text: "Call the plumber" });
    expect(await p.create_task({ text: "Pay rent", due: "2026-11-01", priority: "high" })).toEqual({ kind: "create_task", text: "Pay rent", due: "2026-11-01", priority: "high" });
  });

  it("what is saved is what is shown: invisible and reordering characters are gone before the card is hashed", async () => {
    const { p } = setup();
    expect(await p.create_task({ text: "Call\u200B the\u202E plumber\uFEFF" })).toEqual({ kind: "create_task", text: "Call the plumber" });
    expect(await p.capture_decision({ decision: "Use\u200B Ridgeline", why: "Best\u00AD warranty" })).toEqual({ kind: "capture_decision", decision: "Use Ridgeline", why: "Best warranty" });
    expect((await failure(p.create_task({ text: "\u200B\u200B" }))).code).toBe("bad_input");
  });

  it("only high and low are priorities; anything else is left off, not guessed", async () => {
    const { p } = setup();
    expect(await p.create_task({ text: "Pay rent", priority: "urgent" })).toEqual({ kind: "create_task", text: "Pay rent" });
  });

  it("refuses words that are not there and dates that are not days", async () => {
    const { p } = setup();
    expect((await failure(p.create_task({ text: "   " }))).code).toBe("bad_input");
    expect((await failure(p.create_task({}))).code).toBe("bad_input");
    for (const due of ["2026-02-31", "2026-13-01", "tomorrow", "10/30/2026", "2026-10-3"]) {
      expect((await failure(p.create_task({ text: "Pay rent", due }))).code, due).toBe("bad_input");
    }
  });

  it("names the person from the record, not from the model", async () => {
    const { p, deps } = setup();
    expect(await p.create_task({ text: "Call about the quote", person_ref: "person:m1" })).toEqual({
      kind: "create_task", text: "Call about the quote", personId: "m1", personName: "Marco",
    });
    expect(deps.person).toHaveBeenCalledWith("m1");
  });

  it("a person who is gone, or a ref that is not a person, is a plain failure", async () => {
    const { p } = setup();
    expect((await failure(p.create_task({ text: "x", person_ref: "person:ghost" }))).code).toBe("not_found");
    expect((await failure(p.create_task({ text: "x", person_ref: "task:t1" }))).code).toBe("bad_ref");
  });
});

describe("update_task", () => {
  it("reads the task as it is now and keeps that as the basis the change is judged against", async () => {
    const { p, deps } = setup();
    expect(await p.update_task({ ref: "task:t1", due: "2026-10-30" })).toEqual({
      kind: "update_task", taskId: "t1", title: "Call the plumber",
      basis: { text: "Call the plumber", due: "2026-10-29", done: false, priority: null },
      change: { due: "2026-10-30" },
    });
    expect(deps.task).toHaveBeenCalledWith("t1");
  });

  it("carries every change asked for, and nothing else", async () => {
    const { p } = setup({ t1: task({ priority: "low" }) });
    const c = await p.update_task({ ref: "task:t1", mark_done: true, text: "Call the plumber today", priority: "high", due: "2026-11-02" });
    expect(c).toMatchObject({ change: { done: true, text: "Call the plumber today", priority: "high", due: "2026-11-02" } });
  });

  it("none for a priority clears it, and clearing a date that exists is a change", async () => {
    const { p } = setup({ t1: task({ priority: "high" }) });
    expect(await p.update_task({ ref: "task:t1", priority: "none", clear_due: true })).toMatchObject({ change: { priority: null, due: null } });
  });

  it("drops a change that is already true, and refuses a request that would change nothing", async () => {
    const { p } = setup({ t1: task({ priority: "high" }) });
    expect(await p.update_task({ ref: "task:t1", due: "2026-10-29", priority: "high", text: "Call the plumber", mark_done: true })).toMatchObject({ change: { done: true } });
    for (const same of [{ due: "2026-10-29" }, { priority: "high" }, { text: " Call the  plumber " }]) {
      expect((await failure(p.update_task({ ref: "task:t1", ...same }))).code, JSON.stringify(same)).toBe("nothing_to_change");
    }
    const { p: p2 } = setup({ t1: task({ due: null }) });
    expect((await failure(p2.update_task({ ref: "task:t1", clear_due: true }))).code).toBe("nothing_to_change");
    expect((await failure(p2.update_task({ ref: "task:t1", priority: "none" }))).code).toBe("nothing_to_change");
  });

  it("a task that is gone or already done gets no card", async () => {
    const { p } = setup({ t1: task({ done: true }) });
    expect((await failure(p.update_task({ ref: "task:t1", due: "2026-11-02" }))).code).toBe("already_done");
    expect((await failure(p.update_task({ ref: "task:ghost", due: "2026-11-02" }))).code).toBe("not_found");
  });

  it("leaves a bill to Money and a reminder to its list: each has writes of its own that an edit would go around", async () => {
    const bill = task({ bill: { amount: 120, autopay: false } as never });
    const reminder = task({ reminder: { time: "09:00" } as never });
    const { p } = setup({ b1: bill, r1: reminder });
    expect((await failure(p.update_task({ ref: "task:b1", mark_done: true }))).code).toBe("is_bill");
    expect((await failure(p.update_task({ ref: "task:r1", due: "2026-11-02" }))).code).toBe("is_reminder");
  });

  it("refuses requests that contradict themselves or are not real", async () => {
    const { p } = setup();
    expect((await failure(p.update_task({ ref: "task:t1", due: "2026-11-02", clear_due: true }))).code).toBe("bad_input");
    expect((await failure(p.update_task({ ref: "task:t1", mark_done: false }))).code).toBe("bad_input");
    expect((await failure(p.update_task({ ref: "task:t1", due: "2026-02-30" }))).code).toBe("bad_input");
    expect((await failure(p.update_task({ ref: "task:t1", text: "   " }))).code).toBe("bad_input");
    expect((await failure(p.update_task({ ref: "note:n1", due: "2026-11-02" }))).code).toBe("bad_ref");
    expect((await failure(p.update_task({ ref: 7 }))).code).toBe("bad_ref");
  });
});

describe("capture_decision", () => {
  it("is the decision in the person's words, with the reason and the road not taken only when given", async () => {
    const { p } = setup();
    expect(await p.capture_decision({ decision: "  Use Ridgeline  " })).toEqual({ kind: "capture_decision", decision: "Use Ridgeline" });
    expect(await p.capture_decision({ decision: "Use Ridgeline", why: "Best warranty", ruled_out: "Summit" })).toEqual({
      kind: "capture_decision", decision: "Use Ridgeline", why: "Best warranty", ruledOut: "Summit",
    });
  });

  it("a decision with no words is no decision", async () => {
    const { p } = setup();
    expect((await failure(p.capture_decision({ decision: " " }))).code).toBe("bad_input");
  });
});

describe("all of them only read", () => {
  it("touch nothing but the two reads they were handed", async () => {
    const { p, deps } = setup();
    await p.create_task({ text: "x", person_ref: "person:m1" });
    await p.update_task({ ref: "task:t1", due: "2026-11-02" });
    await p.capture_decision({ decision: "y" });
    expect(Object.keys(deps).sort()).toEqual(["person", "task"]);
    expect(deps.task.mock.calls.length + deps.person.mock.calls.length).toBe(2);
  });
});
