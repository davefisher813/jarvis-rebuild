import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { TasksService } from "../../tasks/TasksService";
import { DecisionService } from "../../decisions/DecisionService";
import { PeopleService } from "../../people/PeopleService";
import { todayISO } from "../../tasks/grouping";
import { addDays } from "../../schedule/calendar";
import { approveAndRun } from "./approval";
import { makeProposers } from "./propose";
import { ProposalStore, cardLines } from "./proposals";
import { makeWriteDeps } from "./writeDeps";

// THE CARD AND WHAT HAPPENS, ON THE REAL SERVICES (the independent review of 2026-10-24). The unit tests use stand-ins for the task and
// decision services; this one wires the real ones behind a card, because a card that says one thing while the service does another is the
// one failure no stand-in can show: a repeating task "marked done" that was only rolled, a wrong year, a receipt for a write that did not land.

function world() {
  const store = new Store(new InMemoryAdapter());
  const tasks = new TasksService(store, "u");
  const decisions = new DecisionService(store, "u");
  const people = new PeopleService(store, "u");
  const proposals = new ProposalStore();
  const proposers = makeProposers({
    task: (id) => tasks.task(id),
    async person(id) { const p = await people.get(id); return p ? { name: p.data.name } : null; },
    today: () => todayISO(),
  });
  const writes = makeWriteDeps({ tasks, decisions });
  /** A model's call, as a card on screen, then the person's tap on it. */
  const propose = async (tool: "create_task" | "update_task" | "capture_decision", input: Record<string, unknown>) => {
    const content = await proposers[tool](input);
    return proposals.open(tool, content);
  };
  const tap = (p: { id: string; hash: string }) => approveAndRun(proposals, p.id, p.hash, writes);
  return { tasks, decisions, proposals, propose, tap };
}

const TODAY = todayISO();

describe("a repeating task, on the real service", () => {
  it("the card says what a tick does and the tick does it: done for today, moved to the date the card gave", async () => {
    const w = world();
    const id = (await w.tasks.createTask("Water the plants", { due: TODAY, recurrence: "daily" }))!;
    const card = await w.propose("update_task", { ref: `task:${id}`, mark_done: true });
    const tomorrow = addDays(TODAY, 1);
    expect(card.content).toMatchObject({ rollsTo: tomorrow });
    expect(cardLines(card.content).some((l) => l.startsWith("Tick it off for today (repeats, next due"))).toBe(true);

    const r = await w.tap(card);
    if (!r.ok) throw new Error(r.message);
    expect(r.receipt).toMatch(/^Done for today: Water the plants · Next /);
    expect(r.toast).toBe("Ticked off for today");
    // What the card, the receipt and the toast claim is what is stored: not finished, moved to the day the card gave.
    expect(await w.tasks.task(id)).toMatchObject({ done: false, due: tomorrow, lastDone: TODAY });

    await r.undo();
    expect(await w.tasks.task(id)).toMatchObject({ done: false, due: TODAY });
    expect((await w.tasks.task(id))!.lastDone ?? null).toBeNull();
  });

  it("asked again the same day it gets no card, because the service would write nothing", async () => {
    const w = world();
    const id = (await w.tasks.createTask("Water the plants", { due: TODAY, recurrence: "daily" }))!;
    const first = await w.propose("update_task", { ref: `task:${id}`, mark_done: true });
    await w.tap(first);
    await expect(w.propose("update_task", { ref: `task:${id}`, mark_done: true })).rejects.toMatchObject({ code: "already_done" });
  });

  it("a card for a task that does not repeat finishes it, says Done, and Undo reopens it", async () => {
    const w = world();
    const id = (await w.tasks.createTask("Send invoice", { due: TODAY }))!;
    const card = await w.propose("update_task", { ref: `task:${id}`, mark_done: true });
    expect(cardLines(card.content)).toContain("Mark it done");
    const r = await w.tap(card);
    if (!r.ok) throw new Error(r.message);
    expect(r.receipt).toBe("Done: Send invoice");
    expect((await w.tasks.task(id))!.done).toBe(true);
    await r.undo();
    expect((await w.tasks.task(id))!.done).toBe(false);
  });
});

describe("a date, on the real service", () => {
  it("a year the model got wrong never becomes a card, so nothing can be saved a year ago under a date that looks right", async () => {
    const w = world();
    const id = (await w.tasks.createTask("Call the plumber", { due: TODAY }))!;
    const lastYear = `${Number(TODAY.slice(0, 4)) - 1}${TODAY.slice(4)}`;
    await expect(w.propose("update_task", { ref: `task:${id}`, due: lastYear })).rejects.toMatchObject({ code: "bad_input" });
    expect(w.proposals.list()).toEqual([]);
    expect((await w.tasks.task(id))!.due).toBe(TODAY);
  });

  it("a move to a later day is stored as shown and Undo puts the old day back", async () => {
    const w = world();
    const id = (await w.tasks.createTask("Call the plumber", { due: TODAY }))!;
    const later = addDays(TODAY, 3);
    const card = await w.propose("update_task", { ref: `task:${id}`, due: later });
    const r = await w.tap(card);
    if (!r.ok) throw new Error(r.message);
    expect((await w.tasks.task(id))!.due).toBe(later);
    await r.undo();
    expect((await w.tasks.task(id))!.due).toBe(TODAY);
  });
});

describe("a new task and a decision, on the real services", () => {
  it("a task made from a card says where it came from, carries only what the card showed, and Undo removes it", async () => {
    const w = world();
    const card = await w.propose("create_task", { text: "Call the plumber about the leak", due: addDays(TODAY, 2), priority: "high" });
    const r = await w.tap(card);
    if (!r.ok) throw new Error(r.message);
    const made = (await w.tasks.task(r.refs[0]!.id))!;
    expect(made).toMatchObject({ text: "Call the plumber about the leak", due: addDays(TODAY, 2), priority: "high", done: false, category: "" });
    expect(made.source).toMatchObject({ type: "chat" });
    expect(made.personId).toBeUndefined();
    await r.undo();
    expect(await w.tasks.task(r.refs[0]!.id)).toBeNull();
  });

  it("a decision is saved in the log as worded, from the chat, and Undo removes it", async () => {
    const w = world();
    const card = await w.propose("capture_decision", { decision: "Use Ridgeline for the roof", why: "Best warranty", ruled_out: "Summit Roofing" });
    const r = await w.tap(card);
    if (!r.ok) throw new Error(r.message);
    const [rec] = await w.decisions.list();
    expect(rec!.data).toMatchObject({ decision: "Use Ridgeline for the roof", why: "Best warranty", ruledOut: ["Summit Roofing"], source: { kind: "chat" } });
    await r.undo();
    expect(await w.decisions.list()).toEqual([]);
  });
});

describe("a card for a task that changed under it, on the real service", () => {
  it("is not overwritten, and the task stays as the person left it", async () => {
    const w = world();
    const id = (await w.tasks.createTask("Call the plumber", { due: TODAY }))!;
    const card = await w.propose("update_task", { ref: `task:${id}`, due: addDays(TODAY, 3) });
    await w.tasks.setDue(id, addDays(TODAY, 9));
    const r = await w.tap(card);
    expect(r).toMatchObject({ ok: false, message: "That task changed since this card was drawn · Nothing was changed" });
    expect((await w.tasks.task(id))!.due).toBe(addDays(TODAY, 9));
  });
});
