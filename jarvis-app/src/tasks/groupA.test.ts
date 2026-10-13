// @vitest-environment jsdom
// Group A laws (addendum items 6, 7, 9).
// Where You Were: shows only for a PRIOR sitting, never past 12 hours, and
// any activity in this sitting hides it. Momentum Chain: same category
// first, never a bill, two Not Nows quiets the day, no counters. Auto-Sweep:
// first open only, events and bills never move, undo restores every date,
// the third move offers Set Aside exactly once, failure is loud.

import { describe, it, expect, beforeEach } from "vitest";
import { Store, InMemoryAdapter, type ItemData, type ServerTime } from "@core";
import { TasksService } from "./TasksService";
import { recordSpot, touchActivity, restorableSpot, SESSION_GAP_MS, EXPIRY_MS } from "../restore/whereYouWere";
import { nextBest, chainQuietToday, dismissChain, chainReason } from "./momentum";
import { runAutoSweep, undoSweep, sweepable, setAsideCandidate, markOffered, readReceipt, retrySweep, liveMoved, liveFailed, dismissSweepCard, sweepCardDismissed } from "./autoSweep";
import type { BillInfo, Recurrence } from "../notes/types";
// A bill task from before the Money ledger. createTask refuses bills now (a
// bill lives in Money, hard rule 1), but the bills already stored still have
// to behave, and recreateFrom writes a whole record as it is: that is how Undo
// restores one, and how a test makes one.
async function legacyBill(svc: TasksService, text: string, o: { due?: string; recurrence?: Recurrence; bill: BillInfo }): Promise<string | null> {
  return svc.recreateFrom({ text, category: "", done: false, ...o });
}


const TODAY = "2026-08-15";
const U = "user1";

const svc = () => new TasksService(new Store(new InMemoryAdapter()), U);

beforeEach(() => localStorage.clear());

describe("Where You Were", () => {
  it("a fresh record is this sitting: no banner", () => {
    recordSpot({ kind: "note", id: "n1", label: "Training Plan" });
    expect(restorableSpot()).toBeNull();
  });

  it("a prior sitting shows; 12+ hours does not", () => {
    const base = 1_000_000_000_000;
    recordSpot({ kind: "note", id: "n1", label: "Training Plan" }, () => base);
    expect(restorableSpot(() => base + SESSION_GAP_MS + 60_000)).not.toBeNull();
    expect(restorableSpot(() => base + EXPIRY_MS + 1)).toBeNull();
  });

  it("activity in this sitting refreshes the record and hides the banner", () => {
    const base = 1_000_000_000_000;
    recordSpot({ kind: "note", id: "n1", label: "Training Plan" }, () => base);
    const later = base + SESSION_GAP_MS + 60_000;
    expect(restorableSpot(() => later)).not.toBeNull();
    touchActivity(() => later); // the user did something HERE
    expect(restorableSpot(() => later + 1000)).toBeNull();
  });
});

describe("Momentum Chain", () => {
  const item = (id: string, text: string, cat: string, extra = {}) => ({ id, data: { text, category: cat, done: false, ...extra } }) as Parameters<typeof nextBest>[0][number];

  it("same category wins, then the nearest due date", () => {
    const items = [
      item("a", "Other cat sooner", "work", { due: "2026-08-15" }),
      item("b", "Same cat later", "gym", { due: "2026-08-20" }),
      item("c", "Same cat sooner", "gym", { due: "2026-08-16" }),
    ];
    expect(nextBest(items, "done1", "gym")!.id).toBe("c");
  });

  it("never a bill, never the finished task, honest null when empty", () => {
    const items = [
      item("bill", "Rent", "money", { bill: { amount: 1200 } }),
      item("done1", "The finished one", "gym"),
    ];
    expect(nextBest(items, "done1", "gym")).toBeNull();
  });

  // B6-6 (2026-09-04): a reminder's done is always false, so before this fix
  // it passed every other guard here and could surface as "Keep Going: Take
  // meds". filters.ts and upnext.ts already exclude reminders; this closes
  // the same gap in the momentum chain.
  it("never a reminder", () => {
    const items = [item("r", "Take meds", "gym", { reminder: { time: "09:00" } })];
    expect(nextBest(items, "done1", "gym")).toBeNull();
  });

  it("two Not Nows quiets the chain for the day", () => {
    expect(chainQuietToday(TODAY)).toBe(false);
    dismissChain(TODAY);
    expect(chainQuietToday(TODAY)).toBe(false);
    dismissChain(TODAY);
    expect(chainQuietToday(TODAY)).toBe(true);
    // A new day starts clean.
    expect(chainQuietToday("2026-08-16")).toBe(false);
  });

  it("the reason line is derived facts or nothing", () => {
    expect(chainReason(item("x", "T", "gym", {}), "gym")).toBe("Same Area");
    expect(chainReason(item("x", "T", "", {}), "")).toBeNull();
  });

  // §AM (2026-09-26): due and late are Colour Key meanings (amber, red), so
  // they are drawn from the task by each surface in the key's ink and never
  // ride this grey string.
  it("carries no due or late words: those wear the key, not the grey", () => {
    expect(chainReason(item("x", "T", "gym", { due: TODAY }), "gym")).toBe("Same Area");
    expect(chainReason(item("x", "T", "gym", { due: "2026-08-01" }), "gym")).toBe("Same Area");
    expect(chainReason(item("x", "T", "work", { due: TODAY }), "gym")).toBeNull();
  });

  // The finished task's area, not the suggestion's own. nextBest falls
  // through to another area when the finished one has nothing open, and
  // that suggestion is not "Same Area" (AMENDED 2026-09-26, pass-off: the
  // word is Area, in Title Case).
  it("says Same Area only when the suggestion shares the FINISHED task's area", () => {
    const items = [item("a", "Other area", "work", { due: TODAY })];
    const next = nextBest(items, "done1", "gym")!;
    expect(next.id).toBe("a");
    expect(chainReason(next, "gym")).toBeNull();
    expect(chainReason(next, "work")).toBe("Same Area");
  });
});

describe("Auto-Sweep", () => {
  it("moves overdue tasks to today with a receipt; bills and events are untouched", async () => {
    const tasks = svc();
    const a = (await tasks.createTask("Old one", { due: "2026-08-13" }))!;
    const b = (await legacyBill(tasks, "Rent", { due: "2026-08-13", bill: { amount: 1200 } }))!;
    const receipt = (await runAutoSweep(tasks, TODAY))!;
    expect(receipt.moved.map((m) => m.id)).toEqual([a]);
    expect((await tasks.task(a))!.due).toBe(TODAY);
    expect((await tasks.task(b))!.due).toBe("2026-08-13");
  });

  // 2026-09-11: a recurring task keeps its anchor day (LIFE-F-03), the same
  // carve-out Set Aside and Fresh Start make; the sweep neither moves it nor
  // counts a slip against it.
  it("never moves a recurring task", async () => {
    const tasks = svc();
    const m = (await tasks.createTask("Pay the gym", { due: "2026-08-13", recurrence: "monthly" }))!;
    const receipt = await runAutoSweep(tasks, TODAY);
    expect(receipt).toBeNull();
    const after = (await tasks.task(m))!;
    expect(after.due).toBe("2026-08-13");
    expect(after.slips).toBeUndefined();
  });

  it("runs once per day: the second open does not resweep", async () => {
    const tasks = svc();
    await tasks.createTask("Old one", { due: "2026-08-13" });
    await runAutoSweep(tasks, TODAY);
    // Make it overdue again by hand; the same day's second run must not touch it.
    const receipt2 = await runAutoSweep(tasks, TODAY);
    expect(receipt2).toEqual(readReceipt(TODAY));
  });

  it("undo restores every prior date and clears the receipt", async () => {
    const tasks = svc();
    const a = (await tasks.createTask("Old one", { due: "2026-08-13" }))!;
    const receipt = (await runAutoSweep(tasks, TODAY))!;
    await undoSweep(tasks, receipt);
    expect((await tasks.task(a))!.due).toBe("2026-08-13");
    expect(readReceipt(TODAY)).toBeNull();
  });

  it("the third consecutive move offers Set Aside, then goes quiet for three days", async () => {
    const tasks = svc();
    const a = (await tasks.createTask("Renew the domain", { due: "2026-08-12" }))!;
    await tasks.setDue(a, "2026-08-13"); // slip 1
    await tasks.setDue(a, "2026-08-14"); // slip 2
    // reset ran-marker between simulated days
    localStorage.removeItem("jarvis.sweep.last.v1");
    const receipt = (await runAutoSweep(tasks, TODAY))!; // slip 3 via sweep
    const moved = liveMoved(receipt, await tasks.listTasks(), TODAY);
    const cand = setAsideCandidate(moved, TODAY);
    expect(cand!.id).toBe(a);
    markOffered(a, TODAY);
    expect(setAsideCandidate(moved, TODAY)).toBeNull();
    // LAW 2 (2026-08-29): the old offered-list had no expiry, so one
    // dismissal muted a task forever however long it kept sliding. Quiet
    // is three days, then it may speak again.
    expect(setAsideCandidate(moved, "2026-08-17")).toBeNull(); // day 2, still quiet
    expect(setAsideCandidate(moved, "2026-08-19")!.id).toBe(a); // past the window
  });

  // LIFE-F-20 (2026-09-05): the cutoff was read through toISOString(), the
  // UTC day, which beyond UTC+12 is the day before local noon; the quiet
  // window was a day off there. Kiritimati is UTC+14 in every season.
  it("the three-day quiet is three days fourteen hours ahead of Greenwich", async () => {
    const prevTz = process.env.TZ;
    process.env.TZ = "Pacific/Kiritimati";
    try {
      const tasks = svc();
      const a = (await tasks.createTask("Renew the domain", { due: "2026-08-12" }))!;
      await tasks.setDue(a, "2026-08-13");
      await tasks.setDue(a, "2026-08-14");
      localStorage.removeItem("jarvis.sweep.last.v1");
      const receipt = (await runAutoSweep(tasks, TODAY))!;
      const moved = liveMoved(receipt, await tasks.listTasks(), TODAY);
      markOffered(a, TODAY);
      expect(setAsideCandidate(moved, "2026-08-17")).toBeNull(); // day 2, still quiet
      expect(setAsideCandidate(moved, "2026-08-18")!.id).toBe(a); // day 3, may speak again
    } finally {
      process.env.TZ = prevTz;
    }
  });

  // LAW 1 (Dave 2026-08-29): "notifications show up on things that are
  // already done". The receipt is history and stays whole for Undo; every
  // card reads through liveMoved instead, against the live tasks.
  it("liveMoved drops what has since been done, deleted, or re-dated", async () => {
    const tasks = svc();
    const done = (await tasks.createTask("Get gas tank", { due: "2026-08-13" }))!;
    const gone = (await tasks.createTask("Deleted later", { due: "2026-08-13" }))!;
    const moved = (await tasks.createTask("Pushed to Friday", { due: "2026-08-13" }))!;
    const open = (await tasks.createTask("Still open", { due: "2026-08-13" }))!;
    const receipt = (await runAutoSweep(tasks, TODAY))!;
    expect(receipt.moved).toHaveLength(4);

    await tasks.toggleDone(done);
    await tasks.deleteTask(gone);
    await tasks.setDue(moved, "2026-08-21");

    const live = liveMoved(receipt, await tasks.listTasks(), TODAY);
    expect(live.map((m) => m.id)).toEqual([open]);
    // The receipt itself is untouched: Undo still needs every entry.
    expect(readReceipt(TODAY)!.moved).toHaveLength(4);
  });

  it("the moved card can be dismissed for the day without moving anything back", async () => {
    const tasks = svc();
    const a = (await tasks.createTask("Old one", { due: "2026-08-13" }))!;
    await runAutoSweep(tasks, TODAY);
    expect(sweepCardDismissed(TODAY)).toBe(false);
    dismissSweepCard(TODAY);
    expect(sweepCardDismissed(TODAY)).toBe(true);
    // The whole point: a dismiss is not an undo (it used to be one).
    expect((await tasks.task(a))!.due).toBe(TODAY);
    expect(sweepCardDismissed("2026-08-16")).toBe(false); // tomorrow speaks again
  });

  it("sweepable never includes done, undated, or future tasks", async () => {
    const tasks = svc();
    await tasks.createTask("future", { due: "2026-08-20" });
    await tasks.createTask("undated", {});
    const items = await tasks.listTasks();
    expect(sweepable(items, TODAY)).toEqual([]);
  });

  it("retry after a marked day sweeps again", async () => {
    const tasks = svc();
    await runAutoSweep(tasks, TODAY); // marks ran, nothing to move
    const a = (await tasks.createTask("Now overdue", { due: "2026-08-13" }))!;
    const receipt = await retrySweep(tasks, TODAY);
    expect(receipt!.moved.map((m) => m.id)).toEqual([a]);
  });
});

// Issue 102, "moving yesterday's tasks fails daily". One task the sweep could
// not move used to fail the WHOLE sweep, and Retry (which re-ran everything and
// overwrote the receipt) could never clear it. Failure is now per task, and a
// task that is simply gone is not a failure at all.
describe("Auto-Sweep failure is per task (issue 102)", () => {
  // A stand-in for the two ways a listed task can be unmovable: the row reads
  // as missing (the list came from the persisted cache, the read from the
  // network), or the write is refused.
  class Flaky extends InMemoryAdapter {
    missing = new Set<string>();
    throwOn = new Set<string>();
    refuse = new Set<string>();
    async read(ownerId: string, id: string) {
      return this.missing.has(id) ? null : super.read(ownerId, id);
    }
    async apply(ownerId: string, id: string, patch: ItemData, serverTime?: ServerTime, clientAt?: number) {
      if (this.throwOn.has(id)) throw Object.assign(new Error("denied"), { code: "42501", status: 403 });
      if (this.refuse.has(id)) return false;
      return super.apply(ownerId, id, patch, serverTime, clientAt);
    }
  }
  async function three() {
    const adapter = new Flaky();
    const tasks = new TasksService(new Store(adapter), U);
    const a = (await tasks.createTask("A", { due: "2026-08-12" }))!;
    const b = (await tasks.createTask("B", { due: "2026-08-13" }))!;
    const c = (await tasks.createTask("C", { due: "2026-08-14" }))!;
    return { adapter, tasks, a, b, c };
  }

  it("a vanished task is not a sweep failure", async () => {
    const { adapter, tasks, a, b, c } = await three();
    adapter.missing.add(b); // listed, but its row will not read
    const receipt = (await runAutoSweep(tasks, TODAY))!;
    expect(receipt.moved.map((m) => m.id).sort()).toEqual([a, c].sort());
    expect(receipt.failed).toBe(false);
    expect(receipt.failedIds ?? []).toEqual([]);
  });

  it("a task whose write throws fails only itself", async () => {
    const { adapter, tasks, a, b, c } = await three();
    adapter.throwOn.add(b);
    const receipt = (await runAutoSweep(tasks, TODAY))!;
    expect(receipt.moved.map((m) => m.id).sort()).toEqual([a, c].sort());
    expect(receipt.failed).toBe(true);
    expect(receipt.failedIds).toEqual([b]);
    expect((await tasks.task(a))!.due).toBe(TODAY);
    expect((await tasks.task(b))!.due).toBe("2026-08-13");
  });

  it("a refused write is a failure, not a move", async () => {
    const { adapter, tasks, a, b } = await three();
    adapter.refuse.add(b);
    const receipt = (await runAutoSweep(tasks, TODAY))!;
    expect(receipt.moved.map((m) => m.id)).not.toContain(b);
    expect(receipt.moved.map((m) => m.id)).toContain(a);
    expect(receipt.failedIds).toEqual([b]);
  });

  it("Retry resumes only the failed ids and keeps the earlier moves", async () => {
    const { adapter, tasks, a, b, c } = await three();
    adapter.throwOn.add(b);
    await runAutoSweep(tasks, TODAY);
    adapter.throwOn.clear();
    const receipt = (await retrySweep(tasks, TODAY))!;
    expect(receipt.moved.map((m) => m.id).sort()).toEqual([a, b, c].sort());
    expect(receipt.failed).toBe(false);
    expect(receipt.failedIds).toEqual([]);
    expect(readReceipt(TODAY)).toEqual(receipt); // persisted, not just returned
    expect((await tasks.task(b))!.due).toBe(TODAY);
    // Undo still has every move to put back.
    await undoSweep(tasks, receipt);
    expect((await tasks.task(a))!.due).toBe("2026-08-12");
  });

  it("a Retry that still fails keeps the earlier moves and the stuck id", async () => {
    const { adapter, tasks, a, b, c } = await three();
    adapter.throwOn.add(b);
    await runAutoSweep(tasks, TODAY);
    const receipt = (await retrySweep(tasks, TODAY))!;
    expect(receipt.moved.map((m) => m.id).sort()).toEqual([a, c].sort());
    expect(receipt.failed).toBe(true);
    expect(receipt.failedIds).toEqual([b]);
    expect(readReceipt(TODAY)!.moved.map((m) => m.id).sort()).toEqual([a, c].sort());
  });

  it("a failure that resolved itself leaves no failed receipt behind", async () => {
    const { adapter, tasks, b } = await three();
    adapter.throwOn.add(b);
    await runAutoSweep(tasks, TODAY);
    expect(readReceipt(TODAY)!.failed).toBe(true);
    await tasks.deleteTask(b); // the stuck task is gone
    const receipt = await retrySweep(tasks, TODAY);
    expect(receipt!.failed).toBe(false);
    expect(readReceipt(TODAY)!.failed).toBe(false);
    // The next mount of Today reads the receipt back: it must not be failed.
    expect((await runAutoSweep(tasks, TODAY))!.failed).toBe(false);
  });

  it("an older failed receipt with no ids still retries, and clears when nothing is left", async () => {
    const tasks = svc();
    localStorage.setItem("jarvis.sweep.receipt.v1", JSON.stringify({ date: TODAY, moved: [], failed: true }));
    localStorage.setItem("jarvis.sweep.last.v1", TODAY);
    expect(await retrySweep(tasks, TODAY)).toBeNull();
    expect(readReceipt(TODAY)).toBeNull();
  });

  it("setDue reports a refused write and leaves the date alone", async () => {
    const { adapter, tasks, b } = await three();
    adapter.refuse.add(b);
    expect(await tasks.setDue(b, TODAY)).toBe(false);
    expect((await tasks.task(b))!.due).toBe("2026-08-13");
  });

  it("liveFailed drops a task that is done, deleted or re-dated, and keeps one still stuck", async () => {
    const { tasks, a, b, c } = await three();
    const receipt = { date: TODAY, moved: [], failed: true, failedIds: [a, b, c, "gone"] };
    await tasks.toggleDone(a);
    await tasks.setDue(b, TODAY);
    const items = await tasks.listTasks();
    expect(liveFailed(receipt, items, TODAY)).toEqual([c]);
    expect(liveFailed({ ...receipt, failed: false }, items, TODAY)).toEqual([]);
    expect(liveFailed({ date: TODAY, moved: [], failed: true }, items, TODAY)).toBeNull(); // whole sweep
    expect(liveFailed(null, items, TODAY)).toEqual([]);
  });
});
