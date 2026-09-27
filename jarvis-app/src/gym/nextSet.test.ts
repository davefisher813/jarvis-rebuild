import { describe, it, expect } from "vitest";
import { nextSetEntry, withDraft, fieldsOf } from "./nextSet";
import type { Exercise, SetEntry } from "./types";

const s = (id: string, w: number, r: number, extra: Partial<SetEntry> = {}): SetEntry =>
  ({ id, w, r, ...extra } as SetEntry);

const bench = (sets: SetEntry[]): Exercise =>
  ({ id: "e1", exerciseKey: "bench", name: "Bench", kind: "weight_reps", unit: "lb", sets } as Exercise);

// Dave, 2026-09-21: "It should auto default to the prior session numbers then
// the set before after that."
describe("the next set defaults the way the athlete asked", () => {
  const plan = bench([s("p1", 275, 5), s("p2", 275, 5), s("p3", 275, 5)]);
  const last = [s("l1", 185, 3), s("l2", 225, 3), s("l3", 255, 2)];

  it("set 1 takes LAST SESSION, not the plan", () => {
    const n = nextSetEntry({ plan, logged: [], lastSession: last });
    expect(n).toMatchObject({ w: 185, r: 3 });
  });

  it("set 2 takes what was just logged, not last session and not the plan", () => {
    const n = nextSetEntry({ plan, logged: [s("a", 205, 5)], lastSession: last });
    expect(n, "the set before, this session").toMatchObject({ w: 205, r: 5 });
  });

  it("set 3 keeps following the set before", () => {
    const n = nextSetEntry({ plan, logged: [s("a", 205, 5), s("b", 225, 2)], lastSession: last });
    expect(n).toMatchObject({ w: 225, r: 2 });
  });

  it("the plan is the floor, for a lift with no history at all", () => {
    expect(nextSetEntry({ plan, logged: [], lastSession: null })).toMatchObject({ w: 275, r: 5 });
  });

  it("what the athlete types beats every one of them", () => {
    const n = nextSetEntry({ plan, logged: [], lastSession: last, draft: { w: 315 } });
    expect(n).toMatchObject({ w: 315, r: 3 });
  });
});

describe("what a seeded set must never inherit", () => {
  const plan = bench([s("p1", 225, 5), s("p2", 225, 5)]);

  it("a warm-up does not count as a working set, or the plan advances early", () => {
    const n = nextSetEntry({ plan, logged: [s("w", 135, 5, { warmup: true })], lastSession: [s("l1", 185, 3)] });
    expect(n, "still the FIRST working set, so still last session").toMatchObject({ w: 185, r: 3 });
  });

  it("a drop does not count either", () => {
    // His own screen: 310x1 then two drops. The next working set follows the
    // 310, not the 225 he dropped to.
    const logged = [s("a", 310, 1), s("d1", 275, 1, { drop: true }), s("d2", 225, 1, { drop: true })];
    expect(nextSetEntry({ plan, logged })).toMatchObject({ w: 310, r: 1 });
  });

  it("the copy carries no stamp, no grind mark, and no warm-up flag", () => {
    const logged = [s("a", 205, 5, { at: 1_700_000_000, moved: "grind" })];
    const n = nextSetEntry({ plan, logged })!;
    expect(n.at, "a new set is a new event").toBeUndefined();
    expect(n.moved, "nobody has said how the next one moved yet").toBeUndefined();
    expect(n.warmup).toBeFalsy();
    expect(n.drop).toBeFalsy();
  });

  it("no plan, no history and no typing means no answer to give", () => {
    expect(nextSetEntry({ plan: bench([]), logged: [] })).toBeNull();
  });
});

// 2026-09-26 (the workout logging pass-off, Dave: "Bottom action buttons do
// not update when numbers change. They show the wrong logged weight"). The
// fields are strings the session owns; the one answer is the seed with the
// typing laid over it, and the plan is never layered under it.
describe("the fields' strings and the one pending answer", () => {
  const plan = bench([s("p1", 20, 10), s("p2", 20, 10)]);

  it("opens the fields from the seed, empty where the app knows no number", () => {
    expect(fieldsOf(s("x", 225, 5))).toEqual({ w: "225", r: "5" });
    expect(fieldsOf({ id: "x", r: 10 } as SetEntry)).toEqual({ w: "", r: "10" });
    expect(fieldsOf(null)).toEqual({ w: "", r: "" });
  });

  it("with nothing typed the answer is the seed itself", () => {
    const seed = nextSetEntry({ plan, logged: [], lastSession: [{ id: "l1", r: 10 } as SetEntry] });
    expect(seed).toMatchObject({ r: 10 });
    expect(seed!.w, "last time logged reps alone, so the plan's 20 lb is NOT under it").toBeUndefined();
    expect(withDraft(seed, null)).toBe(seed);
  });

  it("typing wins, and an emptied field comes off rather than landing as a zero", () => {
    const seed = s("x", 225, 5);
    expect(withDraft(seed, { w: "230", r: "5" })).toMatchObject({ w: 230, r: 5 });
    expect(withDraft(seed, { w: "", r: "5" })!.w).toBeUndefined();
    expect(withDraft(seed, { w: "0", r: "5" })!.w).toBeUndefined();
    expect(withDraft(null, { w: "100", r: "8" })).toMatchObject({ w: 100, r: 8 });
  });
});
