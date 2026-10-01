import { describe, it, expect } from "vitest";
import { gapOptions, gapBlock, GAP_OPTION_LIMIT, type GapTaskIn } from "./gapOffer";
import { gapFill } from "../today/nowContext";

// SCHEDULE AUDIT 2026-10-01, item 7: a "30 Min Open" row offers what fits
// instead of going straight to Focus (Today) or a blank form (Schedule).
const T = "2026-10-01";
const task = (id: string, over: Partial<GapTaskIn> = {}): GapTaskIn => ({ id, text: id, category: "work", done: false, ...over });
const est = () => 30;

describe("gapOptions", () => {
  it("offers only tasks whose estimate fits the gap, with no buffer", () => {
    const out = gapOptions([task("a", { estimateMin: 30 }), task("b", { estimateMin: 45 })], 30, T, est);
    expect(out.map((o) => o.id)).toEqual(["a"]);
    expect(out[0]!.minutes, "a 30 minute task books the whole 30 minute gap").toBe(30);
  });

  it("a 15 minute gap still offers a 15 minute task, where the Now card (buffered) offers nothing", () => {
    const tasks = [task("quick", { estimateMin: 15 })];
    expect(gapOptions(tasks, 15, T, est).map((o) => o.id)).toEqual(["quick"]);
    expect(gapFill(tasks, 15, T, est)).toBeNull();
  });

  it("ranks like the Now card: due today, then overdue, then the rest", () => {
    const out = gapOptions([
      task("later", { due: "2026-10-09", estimateMin: 20 }),
      task("none", { estimateMin: 20 }),
      task("late", { due: "2026-09-20", estimateMin: 20 }),
      task("today", { due: T, estimateMin: 20 }),
    ], 60, T, est);
    expect(out.map((o) => o.id)).toEqual(["today", "late", "later", "none"]);
    expect(gapFill([task("later", { due: "2026-10-09", estimateMin: 20 }), task("today", { due: T, estimateMin: 20 })], 60, T, est)!.id)
      .toBe("today");
  });

  it("leaves out done tasks, bills, reminders, paused areas and what the day already holds", () => {
    const out = gapOptions([
      task("done", { done: true }), task("bill", { bill: { amount: 1 } }), task("rem", { reminder: { at: "x" } }),
      task("paused", { category: "rest" }), task("planned"), task("ok"),
    ], 60, T, est, { paused: new Set(["rest"]), planned: new Set(["planned"]) });
    expect(out.map((o) => o.id)).toEqual(["ok"]);
  });

  it("a task's own estimate beats the category's", () => {
    const out = gapOptions([task("own", { estimateMin: 10 })], 20, T, () => 90);
    expect(out.map((o) => [o.id, o.minutes])).toEqual([["own", 10]]);
  });

  it("caps the list so the sheet stays small", () => {
    const many = Array.from({ length: 9 }, (_, i) => task("t" + i, { estimateMin: 10 }));
    expect(gapOptions(many, 60, T, est)).toHaveLength(GAP_OPTION_LIMIT);
    expect(gapOptions(many, 60, T, est, { limit: 2 })).toHaveLength(2);
  });

  it("[edge] nothing fits, nothing is offered", () => {
    expect(gapOptions([task("big", { estimateMin: 120 })], 30, T, est)).toEqual([]);
    expect(gapOptions([], 30, T, est)).toEqual([]);
  });
});

describe("gapBlock", () => {
  it("starts where the gap starts and runs the booked length", () => {
    expect(gapBlock("12:15", 45)).toEqual({ start: "12:15", end: "13:00" });
  });
  it("[edge] never runs past the end of the day", () => {
    expect(gapBlock("23:30", 60).end).toBe("23:59");
  });
});
