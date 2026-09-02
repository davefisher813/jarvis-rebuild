import { describe, it, expect } from "vitest";
import { condCap, condResultEntry, condScore, condScoreLabel, condSummary, intervalAt, intervalsDone, marksOwnRounds, mmss, perRound } from "./conditioning";
import { formatSet } from "./measures";
import type { CondBlock } from "./types";

// THE CONDITIONING BLOCK (ruled 2026-09-01, built 2026-09-02). Two states
// share one set of derivations; these pin them.
const amrap: CondBlock = { format: "amrap", capSec: 720 };
const emom: CondBlock = { format: "emom", capSec: 600, intervalSec: 60, rounds: 10 };
const tabata: CondBlock = { format: "tabata", capSec: 240, intervalSec: 20, restSec: 10, rounds: 8 };
const forTime: CondBlock = { format: "for_time", capSec: 1200 };

describe("the clock's words", () => {
  it("mmss", () => {
    expect(mmss(462)).toBe("7:42");
    expect(mmss(7)).toBe("0:07");
    expect(mmss(720)).toBe("12:00");
    expect(mmss(-3)).toBe("0:00");
  });
  it("summaries", () => {
    expect(condSummary(amrap)).toBe("AMRAP · 12:00");
    expect(condSummary(emom)).toBe("EMOM · 10 × 1:00");
    expect(condSummary(tabata)).toBe("Tabata · 8 × 0:20 / 0:10");
    expect(condSummary(forTime)).toBe("For Time · cap 20:00");
  });
  it("the cap is built from the parts, so it can never disagree with them", () => {
    expect(condCap("amrap", { minutes: 12 })).toBe(720);
    expect(condCap("emom", { intervalSec: 60, rounds: 10 })).toBe(600);
    expect(condCap("tabata", { intervalSec: 20, restSec: 10, rounds: 8 })).toBe(240);
  });
});

describe("intervals", () => {
  it("interval formats mark their own rounds; the others wait for a tap", () => {
    expect(marksOwnRounds(emom)).toBe(true);
    expect(marksOwnRounds(tabata)).toBe(true);
    expect(marksOwnRounds(amrap)).toBe(false);
    expect(marksOwnRounds(forTime)).toBe(false);
  });
  it("an EMOM at 2:30 is in round 3 with thirty seconds left", () => {
    expect(intervalAt(emom, 150)).toEqual({ round: 3, phase: "work", left: 30 });
    expect(intervalsDone(emom, 150)).toBe(2);
    expect(intervalsDone(emom, 600)).toBe(10);
    expect(intervalsDone(emom, 900)).toBe(10);
  });
  it("a Tabata alternates work and rest", () => {
    expect(intervalAt(tabata, 5)).toEqual({ round: 1, phase: "work", left: 15 });
    expect(intervalAt(tabata, 25)).toEqual({ round: 1, phase: "rest", left: 5 });
    expect(intervalAt(tabata, 30)).toEqual({ round: 2, phase: "work", left: 20 });
    expect(intervalAt(tabata, 240)).toEqual({ round: 8, phase: "rest", left: 0 });
  });
});

describe("splits", () => {
  it("per-round times come from cumulative splits, with the change from the round before", () => {
    expect(perRound([98, 202, 313, 435, 546])).toEqual([
      { round: 1, sec: 98, delta: null },
      { round: 2, sec: 104, delta: 6 },
      { round: 3, sec: 111, delta: 7 },
      { round: 4, sec: 122, delta: 11 },
      { round: 5, sec: 111, delta: -11 },
    ]);
    expect(perRound([])).toEqual([]);
  });
});

describe("the entry the clock writes", () => {
  it("an AMRAP scores the rounds it tapped and carries the splits", () => {
    const e = condResultEntry({ kind: "rounds", cond: amrap }, 720, [98, 202, 313]);
    expect(e.r).toBe(3);
    expect(e.elapsed).toBe(720);
    expect(e.splits).toEqual([98, 202, 313]);
    expect(condScore({ kind: "rounds" }, e)).toBe("3 rounds");
    expect(condScore({ kind: "rounds" }, { ...e, extra: 12 })).toBe("3 + 12");
    expect(formatSet({ kind: "rounds" }, { ...e, extra: 12 })).toBe("3 rounds + 12");
    expect(condScoreLabel({ kind: "rounds", cond: amrap })).toBe("Rounds + reps");
  });
  it("an AMRAP with no round tapped is a done mark, not a zero", () => {
    const e = condResultEntry({ kind: "rounds", cond: amrap }, 720, []);
    expect(e.r).toBeUndefined();
    expect(e.done).toBe(true);
    expect(e.splits).toBeUndefined();
  });
  it("a For Time scores its elapsed seconds in the exercise's unit", () => {
    const sec = condResultEntry({ kind: "time_faster", unit: "sec", cond: forTime }, 462, []);
    expect(sec.v).toBe(462);
    expect(condScore({ kind: "time_faster", unit: "sec" }, sec)).toBe("7:42");
    const min = condResultEntry({ kind: "time_faster", unit: "min", cond: forTime }, 462, []);
    expect(min.v).toBe(7.7);
  });
  it("an EMOM counts the intervals it finished", () => {
    const e = condResultEntry({ kind: "rounds", cond: emom }, 600, []);
    expect(e.r).toBe(10);
    const early = condResultEntry({ kind: "rounds", cond: emom }, 150, []);
    expect(early.r).toBe(2);
  });
});
