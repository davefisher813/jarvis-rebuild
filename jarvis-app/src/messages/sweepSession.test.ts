import { describe, it, expect } from "vitest";
import { loadSweepSession, saveSweepSession, clearSweepSession, isFreshSession, resumeHand, SESSION_KEY } from "./sweepSession";

function mem() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    raw: m,
  };
}

// E-19 (Push D): the parked Sweep.
describe("sweepSession", () => {
  it("round-trips a parked hand and drops junk", () => {
    const s = mem();
    saveSweepSession({ handIds: ["a", "b", "c"], idx: 1, planText: "“On it.”", savedAt: 1000, receipts: { sent: 1, bills: 0, scheduled: 0, tasks: 0, archived: 2, later: 0 }, elapsedMs: 4000 }, s);
    expect(loadSweepSession(s)).toEqual({ handIds: ["a", "b", "c"], idx: 1, planText: "“On it.”", savedAt: 1000, receipts: { sent: 1, bills: 0, scheduled: 0, tasks: 0, archived: 2, later: 0 }, elapsedMs: 4000 });
    s.setItem(SESSION_KEY, JSON.stringify({ handIds: "nope", idx: 0, savedAt: 1 }));
    expect(loadSweepSession(s)).toBeNull();
    s.setItem(SESSION_KEY, "{not json");
    expect(loadSweepSession(s)).toBeNull();
    clearSweepSession(s);
    expect(loadSweepSession(s)).toBeNull();
  });

  it("is fresh for less than one session length, never longer", () => {
    const parked = { handIds: ["a"], idx: 0, savedAt: 10_000 };
    expect(isFreshSession(parked, 10_000 + 299_999, 300_000)).toBe(true);
    expect(isFreshSession(parked, 10_000 + 300_000, 300_000)).toBe(false);
    expect(isFreshSession(parked, 9_000, 300_000)).toBe(false); // a clock that went backwards
    expect(isFreshSession(null, 10_000, 300_000)).toBe(false);
  });

  it("re-deals the parked hand from what is still in the deck, keeping the seat", () => {
    const threads = [{ id: "c" }, { id: "a" }, { id: "z" }, { id: "d" }];
    // Parked at seat 2 (card c) of a,b,c,d. b was handled elsewhere since.
    const r = resumeHand({ handIds: ["a", "b", "c", "d"], idx: 2, savedAt: 0 }, threads);
    expect(r?.hand.map((t) => t.id)).toEqual(["a", "c", "d"]);
    expect(r?.idx).toBe(1); // still card c
    // The parked card itself is gone: the next surviving one is the seat.
    const r2 = resumeHand({ handIds: ["a", "b", "c", "d"], idx: 1, savedAt: 0 }, threads);
    expect(r2?.hand[r2.idx]?.id).toBe("c");
    // Nothing from the parked seat onward survives: no offer.
    expect(resumeHand({ handIds: ["a", "b"], idx: 1, savedAt: 0 }, threads)).toBeNull();
    expect(resumeHand({ handIds: ["q"], idx: 0, savedAt: 0 }, threads)).toBeNull();
  });
});
