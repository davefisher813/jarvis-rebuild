import { describe, it, expect } from "vitest";
import {
  dealHand, HAND_MAX, estimateOf, receiptLines, handledOf, EMPTY_RECEIPTS,
  loadSweepDays, recordSweepDay, streakView, sweepEstimate,
} from "./sweep";

// The Sweep's promises, held as tests. Each block is one approved catalog
// pick (Dave 2026-08-25: "1B · 2A · 3A · 4A · 5A · 6A · 7A · 8A · 9A · 10A ·
// L1Y · L2Y").

class Mem {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

describe("3A: the hand, never the pile", () => {
  it("deals at most nine, whatever the pile holds", () => {
    const pile = Array.from({ length: 240 }, (_, i) => i);
    expect(dealHand(pile)).toHaveLength(HAND_MAX);
    expect(dealHand(pile)[0]).toBe(0);
  });

  it("a small pile is dealt whole", () => {
    expect(dealHand([1, 2, 3])).toEqual([1, 2, 3]);
    expect(dealHand([])).toEqual([]);
  });
});

describe("5A: every card wears its cost", () => {
  it("prepared one-tap actions are seconds", () => {
    for (const k of ["bill", "event", "task", "archive"]) expect(estimateOf(k)).toBe("~5 sec");
  });
  it("a drafted reply costs the reading of it", () => {
    expect(estimateOf("reply")).toBe("~30 sec");
  });
  it("no plan means opening the thread, honestly the slowest", () => {
    expect(estimateOf(null)).toBe("~1 min");
    expect(estimateOf(undefined)).toBe("~1 min");
  });
});

describe("7A: receipts count what happened, never what was attempted", () => {
  it("prints only the lines that are true", () => {
    expect(receiptLines({ ...EMPTY_RECEIPTS, sent: 2, bills: 1, archived: 4 }))
      .toEqual(["2 replies sent", "1 bill filed in Money", "4 gone for good"]);
  });
  it("gets singular right, because '1 replies' costs the number its credibility", () => {
    expect(receiptLines({ ...EMPTY_RECEIPTS, sent: 1 })).toEqual(["1 reply sent"]);
  });
  it("an empty session prints nothing rather than a zero parade", () => {
    expect(receiptLines(EMPTY_RECEIPTS)).toEqual([]);
    expect(handledOf(EMPTY_RECEIPTS)).toBe(0);
  });
});

describe("10A: the honest streak", () => {
  it("a day with kills colors in; a zero-card session does not", () => {
    const s = new Mem();
    recordSweepDay("2026-08-25", 3, s);
    recordSweepDay("2026-08-26", 0, s);
    expect(loadSweepDays(s).days).toEqual(["2026-08-25"]);
  });

  it("nothing ever resets: a gap costs the day, not the history", () => {
    const s = new Mem();
    for (const d of ["2026-08-19", "2026-08-20", "2026-08-21", "2026-08-24", "2026-08-25"]) recordSweepDay(d, 1, s);
    const v = streakView(loadSweepDays(s), "2026-08-25");
    // Last seven days ending today: 19,20,21 hit, 22,23 missed, 24,25 hit.
    expect(v.last7).toEqual([true, true, true, false, false, true, true]);
    expect(v.cleared).toBe(5);
    // Best run is the 19-21 stretch: three consecutive days.
    expect(v.best).toBe(3);
  });

  it("the best run survives forever, even after worse weeks", () => {
    const s = new Mem();
    for (const d of ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-08-25"]) recordSweepDay(d, 1, s);
    expect(streakView(loadSweepDays(s), "2026-08-25").best).toBe(4);
  });

  it("recording the same day twice counts once", () => {
    const s = new Mem();
    recordSweepDay("2026-08-25", 2, s);
    recordSweepDay("2026-08-25", 5, s);
    expect(loadSweepDays(s).days).toEqual(["2026-08-25"]);
  });

  it("garbage in storage reads as an empty history, never a crash", () => {
    const s = new Mem();
    s.setItem("jarvis.mail.sweep.v1", "{not json");
    expect(loadSweepDays(s).days).toEqual([]);
    s.setItem("jarvis.mail.sweep.v1", JSON.stringify({ days: ["nope", 7, "2026-08-25"] }));
    expect(loadSweepDays(s).days).toEqual(["2026-08-25"]);
  });
});

describe("the deck card's estimate", () => {
  it("rounds UP, because an estimate that runs over breaks the promise", () => {
    expect(sweepEstimate(1)).toBe("About 1 min");
    expect(sweepEstimate(3)).toBe("About 2 min");
    expect(sweepEstimate(9)).toBe("About 6 min");
  });
  it("says nothing about an empty hand", () => {
    expect(sweepEstimate(0)).toBe("");
  });
});
