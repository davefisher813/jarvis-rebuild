import { describe, it, expect } from "vitest";
import { stillTrueGoals, STILL_TRUE_MIN_PREV, STILL_TRUE_MAX } from "./stillTrue";
import type { MonthSealData } from "./seal";
import type { Goal } from "../life/types";

// "STILL TRUE?" (handoff item 10's remnant). Everything worth pinning is a
// refusal to ask. The question only earns its place against positive evidence
// that something stopped.

const seal = (over: Partial<MonthSealData> = {}): MonthSealData => ({
  month: "2026-08", sealedAt: 0, done: 0, pushed: 0, daysIn: 20,
  byCategory: {}, bandStart: null, sessions: 0, deposits: 0, saved: 0,
  goalsLive: 0, goalsAchieved: 0, bandCount: 0, byHour: new Array(24).fill(0),
  doneByDay: {}, pushedByCategory: {}, slip: null, byPick: [],
  overrunByCategory: {}, suggestions: {}, strands: { created: 0, corrected: 0, deleted: 0 },
  remindersTicked: 0, deck: { sent: 0, asWritten: 0 }, carried: [], ...over,
});

const goal = (id: string, title: string, tags: string[], over: Partial<Goal["data"]> = {}): Goal => ({
  id, data: { title, state: "on_track", tags, ...over },
});

const PREV = seal({ month: "2026-07", byCategory: { fitness: 9, work: 4 } });

describe("when the question is asked", () => {
  it("asks about a goal that was moving and then stopped dead", () => {
    const out = stillTrueGoals(seal(), PREV, [goal("g1", "Run a half marathon", ["fitness"])]);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe("Run a half marathon");
    expect(out[0]!.wasDone).toBe(9);
  });

  it("asks the one that dropped furthest first, and never more than a couple", () => {
    const prev = seal({ month: "2026-07", byCategory: { a: 20, b: 10, c: 5, d: 4 } });
    const goals = [goal("1", "A", ["a"]), goal("2", "B", ["b"]), goal("3", "C", ["c"]), goal("4", "D", ["d"])];
    const out = stillTrueGoals(seal(), prev, goals);
    expect(out).toHaveLength(STILL_TRUE_MAX);
    expect(out.map((g) => g.title)).toEqual(["A", "B"]);
  });
});

describe("when it stays quiet, which is most of the time", () => {
  it("says nothing with no previous month to compare against", () => {
    // Without a "was moving" there is no honest question, so none is asked.
    expect(stillTrueGoals(seal(), null, [goal("g1", "X", ["fitness"])])).toEqual([]);
  });

  it("says nothing about a goal that was barely moving before either", () => {
    // Absence of evidence is not evidence. One completion last month is not
    // a run of momentum that visibly stopped.
    const thin = seal({ month: "2026-07", byCategory: { fitness: STILL_TRUE_MIN_PREV - 1 } });
    expect(stillTrueGoals(seal(), thin, [goal("g1", "X", ["fitness"])])).toEqual([]);
  });

  it("says nothing about a goal with no tags, because it cannot see it", () => {
    // No reach means the app genuinely does not know whether anything moved.
    expect(stillTrueGoals(seal(), PREV, [goal("g1", "X", [])])).toEqual([]);
  });

  it("says nothing when something did finish this month", () => {
    const now = seal({ byCategory: { fitness: 1 } });
    expect(stillTrueGoals(now, PREV, [goal("g1", "X", ["fitness"])])).toEqual([]);
  });

  it("counts scheduled time as movement, even with nothing finished", () => {
    // A month of showing up and finishing nothing is still a month of caring
    // about it, and this app does not get to call that a stop.
    const now = seal({ hours: { fitness: 480 } });
    expect(stillTrueGoals(now, PREV, [goal("g1", "X", ["fitness"])])).toEqual([]);
  });

  it("never asks about a goal already achieved or already cut", () => {
    const achieved = goal("g1", "X", ["fitness"], { state: "achieved" });
    const dropped = goal("g2", "Y", ["fitness"], { dropped: { on: "2026-07-04" } });
    expect(stillTrueGoals(seal(), PREV, [achieved, dropped])).toEqual([]);
  });

  it("never changes the goal it asks about", () => {
    // The card is a question. Cutting a goal is a decision with a record, and
    // that is a different path on purpose.
    const g = goal("g1", "X", ["fitness"]);
    const before = JSON.stringify(g);
    stillTrueGoals(seal(), PREV, [g]);
    expect(JSON.stringify(g)).toBe(before);
  });
});
