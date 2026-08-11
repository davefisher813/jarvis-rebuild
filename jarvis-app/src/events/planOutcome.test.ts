import { describe, it, expect } from "vitest";
import { recordPicks, resolvePendingPlans, planRecord, planRecordLine, type PlanStorage } from "./planOutcome";
import type { EventInput } from "./types";

// Plan-vs-done is advertised as the app's most valuable measurement, so its
// definition must hold exactly: a pick is done ONLY if completed by end of
// that LOCAL day. These tests pin the definition, the same-day replan rule,
// and that today's plan is never scored early.

function memStorage(): PlanStorage {
  let v: string | null = null;
  return { read: () => v, write: (x) => { v = x; } };
}

const at = (y: number, mo: number, d: number, h: number) => new Date(y, mo - 1, d, h).getTime();

function collect() {
  const out: EventInput[] = [];
  return { out, emit: (e: EventInput) => { out.push(e); } };
}

describe("plan outcome resolution", () => {
  it("scores done-same-day true, done-later false, never-done false, in pick order", () => {
    const storage = memStorage();
    recordPicks("2026-08-02", ["a", "b", "c"], storage);
    const samples = [
      { t: at(2026, 8, 2, 21), id: "a" }, // done that evening: counts
      { t: at(2026, 8, 3, 9), id: "b" }, // done next morning: does NOT count
      // c: never completed (or deleted): does not count
    ];
    const { out, emit } = collect();
    const n = resolvePendingPlans("2026-08-03", samples, emit, storage);
    expect(n).toBe(3);
    expect(out.map((e) => e.type)).toEqual(["plan.outcome", "plan.outcome", "plan.outcome"]);
    expect(out.map((e) => [e.entityId, e.props?.n, e.props?.flag])).toEqual([
      ["a", 1, true],
      ["b", 2, false],
      ["c", 3, false],
    ]);
  });

  it("leaves today's own plan pending (scored only from a later day)", () => {
    const storage = memStorage();
    recordPicks("2026-08-03", ["a"], storage);
    const { out, emit } = collect();
    expect(resolvePendingPlans("2026-08-03", [{ t: at(2026, 8, 3, 10), id: "a" }], emit, storage)).toBe(0);
    expect(out).toHaveLength(0);
    // next day it resolves, and only once
    expect(resolvePendingPlans("2026-08-04", [{ t: at(2026, 8, 3, 10), id: "a" }], emit, storage)).toBe(1);
    expect(out[0]?.props?.flag).toBe(true);
    expect(resolvePendingPlans("2026-08-04", [], emit, storage)).toBe(0);
  });

  it("same-day replan replaces the picks: the last plan of the day is scored", () => {
    const storage = memStorage();
    recordPicks("2026-08-02", ["a", "b"], storage);
    recordPicks("2026-08-02", ["c"], storage);
    const { out, emit } = collect();
    resolvePendingPlans("2026-08-03", [], emit, storage);
    expect(out.map((e) => e.entityId)).toEqual(["c"]);
  });

  it("resolves several missed days at once (app not opened for a while)", () => {
    const storage = memStorage();
    recordPicks("2026-08-01", ["a"], storage);
    recordPicks("2026-08-02", ["b"], storage);
    const { out, emit } = collect();
    expect(resolvePendingPlans("2026-08-03", [{ t: at(2026, 8, 1, 12), id: "a" }], emit, storage)).toBe(2);
    expect(out.map((e) => [e.entityId, e.props?.flag])).toEqual([
      ["a", true],
      ["b", false],
    ]);
  });

  it("empty picks are never recorded", () => {
    const storage = memStorage();
    recordPicks("2026-08-02", [], storage);
    const { out, emit } = collect();
    expect(resolvePendingPlans("2026-08-03", [], emit, storage)).toBe(0);
    expect(out).toHaveLength(0);
  });
});

// Reading the measurement back (2026-08-10): the audit found plan.outcome was
// emitted and never consumed. planRecord summarizes the recent window for the
// commit moment in Plan My Day.

describe("planRecord", () => {
  const NOW = at(2026, 8, 10, 12);
  const ev = (daysAgo: number, flag: boolean, type = "plan.outcome") => ({
    type, ts: NOW - daysAgo * 86400000, props: { n: 1, flag },
  });

  it("counts picks and same-day dones inside the window only", () => {
    const r = planRecord([ev(1, true), ev(3, false), ev(5, true), ev(20, true)], NOW);
    expect(r).toEqual({ picks: 3, done: 2 });
  });

  it("ignores other event types", () => {
    const r = planRecord([ev(1, true), ev(1, true, "plan.picked"), ev(1, true, "task.completed")], NOW);
    expect(r.picks).toBe(1);
  });

  it("line renders the locked definition, silent under 3 picks", () => {
    expect(planRecordLine({ picks: 5, done: 3 })).toBe("Lately: 3 of 5 planned picks got done the same day.");
    expect(planRecordLine({ picks: 2, done: 2 })).toBeNull();
    expect(planRecordLine({ picks: 0, done: 0 })).toBeNull();
  });
});
