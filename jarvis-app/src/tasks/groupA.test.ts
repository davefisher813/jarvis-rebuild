// @vitest-environment jsdom
// Group A laws (addendum items 6, 7, 9).
// Where You Were: shows only for a PRIOR sitting, never past 12 hours, and
// any activity in this sitting hides it. Momentum Chain: same category
// first, never a bill, two Not Nows quiets the day, no counters. Auto-Sweep:
// first open only, events and bills never move, undo restores every date,
// the third move offers Set Aside exactly once, failure is loud.

import { describe, it, expect, beforeEach } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { TasksService } from "./TasksService";
import { recordSpot, touchActivity, restorableSpot, SESSION_GAP_MS, EXPIRY_MS } from "../restore/whereYouWere";
import { nextBest, chainQuietToday, dismissChain, chainReason } from "./momentum";
import { runAutoSweep, undoSweep, sweepable, setAsideCandidate, markOffered, readReceipt, retrySweep, liveMoved, dismissSweepCard, sweepCardDismissed } from "./autoSweep";

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
    expect(chainReason(item("x", "T", "gym", { due: TODAY }), "gym", TODAY)).toBe("Same category, due today");
    expect(chainReason(item("x", "T", "", {}), "", TODAY)).toBeNull();
  });
});

describe("Auto-Sweep", () => {
  it("moves overdue tasks to today with a receipt; bills and events are untouched", async () => {
    const tasks = svc();
    const a = (await tasks.createTask("Old one", { due: "2026-08-13" }))!;
    const b = (await tasks.createTask("Rent", { due: "2026-08-13", bill: { amount: 1200 } }))!;
    const receipt = (await runAutoSweep(tasks, TODAY))!;
    expect(receipt.moved.map((m) => m.id)).toEqual([a]);
    expect((await tasks.task(a))!.due).toBe(TODAY);
    expect((await tasks.task(b))!.due).toBe("2026-08-13");
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
