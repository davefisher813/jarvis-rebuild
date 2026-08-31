import { describe, it, expect } from "vitest";
import { formatSet, logButtonLabel, entryNoun, beats, hasVolume, setVolume, scoreOf, fieldsFor, hasTarget, targetLine, plannedEntryAt, isUniformStrip } from "./measures";
import type { Exercise, MeasureKind, SetEntry, SetLog } from "./types";

// Nine measure kinds, and the direction lives IN the kind. These pin the two
// things that would silently lie: which way a record goes, and whether "weight
// moved" means anything for this kind.
//
// THE SET STRIP: an Exercise's plan is `sets: SetEntry[]`, one chip per set,
// not a single `target`. `strip(n, over)` below builds a uniform strip the
// way the "Quick Setup" convenience input does.

let seq = 0;
const mkSet = (over: SetLog = {}): SetEntry => ({ id: `s${seq++}`, ...over });
const strip = (count: number, over: SetLog = {}): SetEntry[] => Array.from({ length: count }, () => mkSet(over));

const ex = (kind: MeasureKind, over: Partial<Exercise> = {}): Exercise =>
  ({ id: "e", name: "X", kind, sets: strip(3), ...over }) as Exercise;

describe("formatSet speaks each kind's language", () => {
  it("renders every kind without inventing units", () => {
    expect(formatSet(ex("weight_reps", { unit: "lb" }), { w: 135, r: 8 })).toBe("135 lb × 8");
    expect(formatSet(ex("weight_reps", { unit: "kg" }), { w: 60, r: 5 })).toBe("60 kg × 5");
    expect(formatSet(ex("reps"), { r: 12 })).toBe("12 reps");
    expect(formatSet(ex("rounds"), { r: 1 })).toBe("1 round");
    expect(formatSet(ex("rounds"), { r: 12 })).toBe("12 rounds");
    expect(formatSet(ex("time_faster", { unit: "sec" }), { v: 4.64 })).toBe("4.64 sec");
    expect(formatSet(ex("time_longer", { unit: "sec" }), { v: 90 })).toBe("90 sec");
    expect(formatSet(ex("distance", { unit: "m" }), { v: 2000 })).toBe("2000 m");
    expect(formatSet(ex("distance_time", { unit: "mi", timeUnit: "min" }), { v: 3, t: 24 })).toBe("3 mi in 24 min");
    expect(formatSet(ex("height", { unit: "in" }), { v: 31.5 })).toBe("31.5 in");
    expect(formatSet(ex("done"), {})).toBe("Done");
  });
});

describe("the one-tap button reads the NEXT planned set in the strip", () => {
  it("labels with the target at the logged position, and Done needs no numbers", () => {
    expect(logButtonLabel(ex("weight_reps", { unit: "lb", sets: strip(3, { w: 135, r: 8 }) }), 0)).toBe("Log 135 lb × 8");
    expect(logButtonLabel(ex("time_faster", { unit: "sec", sets: strip(1, { v: 4.6 }) }), 0)).toBe("Log 4.6 sec");
    expect(logButtonLabel(ex("done"), 0)).toBe("Mark Done");
  });
  it("falls back once the strip is fully logged", () => {
    const heavy = ex("weight_reps", { unit: "lb", sets: strip(2, { w: 135, r: 8 }) });
    expect(logButtonLabel(heavy, 0)).toBe("Log 135 lb × 8");
    expect(logButtonLabel(heavy, 1)).toBe("Log 135 lb × 8");
    // Past the end of the plan there is no next chip to read.
    expect(plannedEntryAt(heavy, 2)).toBeUndefined();
    expect(logButtonLabel(heavy, 2)).toBe("Log Set");
  });
  it("names entries the way the athlete would", () => {
    expect(entryNoun("weight_reps")).toBe("Sets");
    expect(entryNoun("time_faster")).toBe("Attempts");
    expect(entryNoun("rounds")).toBe("Rounds");
  });
});

describe("PR direction is baked into the kind", () => {
  it("faster wins for a sprint, longer wins for a hold", () => {
    expect(beats("time_faster", { v: 4.64 }, { v: 4.71 })).toBe(true);
    expect(beats("time_faster", { v: 4.80 }, { v: 4.71 })).toBe(false);
    expect(beats("time_longer", { v: 90 }, { v: 75 })).toBe(true);
    expect(beats("time_longer", { v: 60 }, { v: 75 })).toBe(false);
  });
  it("more is better for weight, reps, rounds, distance, height", () => {
    expect(beats("weight_reps", { w: 145, r: 5 }, { w: 135, r: 8 })).toBe(true);
    expect(beats("reps", { r: 14 }, { r: 12 })).toBe(true);
    expect(beats("rounds", { r: 13 }, { r: 12 })).toBe(true);
    expect(beats("distance", { v: 2100 }, { v: 2000 })).toBe(true);
    expect(beats("height", { v: 32 }, { v: 31.5 })).toBe(true);
  });
  it("distance_time scores on pace, lower being better", () => {
    // 3 mi in 24 min (8:00) beats 3 mi in 27 min (9:00)
    expect(beats("distance_time", { v: 3, t: 24 }, { v: 3, t: 27 })).toBe(true);
    expect(scoreOf("distance_time", { v: 3, t: 24 })!.lowerWins).toBe(true);
  });
  it("Done has no score, so it can never produce a record", () => {
    expect(scoreOf("done", {})).toBeNull();
    expect(beats("done", {}, {})).toBe(false);
  });
});

describe("volume is only claimed where it is real", () => {
  it("weight work has volume; a sprint day does not get an invented number", () => {
    expect(hasVolume("weight_reps")).toBe(true);
    expect(setVolume("weight_reps", { w: 135, r: 8 })).toBe(1080);
    for (const k of ["reps", "rounds", "time_faster", "time_longer", "distance", "distance_time", "height", "done"] as MeasureKind[]) {
      expect(hasVolume(k)).toBe(false);
      expect(setVolume(k, { r: 10, v: 100, t: 5 })).toBe(0);
    }
  });
});

describe("deviation fields", () => {
  it("offers exactly the steppers each kind needs, and none for Done", () => {
    // SPEC MOVED (Dave 2026-08-15): reps before weight, so every surface
    // reads Sets, Reps, Weight in speaking order.
    expect(fieldsFor("weight_reps").map((f) => f.key)).toEqual(["r", "w"]);
    expect(fieldsFor("distance_time").map((f) => f.key)).toEqual(["v", "t"]);
    expect(fieldsFor("done")).toEqual([]);
  });
});

describe("an exercise with no target never offers to log a zero", () => {
  it("says what it will do instead, on the button and the plan line", () => {
    const bare = ex("time_faster", { unit: "sec", sets: strip(4) });
    expect(hasTarget(bare)).toBe(false);
    expect(logButtonLabel(bare, 0)).toBe("Log Attempt");
    expect(targetLine(bare)).toBe("4 attempts");
    const planned = ex("weight_reps", { unit: "lb", sets: strip(3, { w: 135, r: 8 }) });
    expect(hasTarget(planned)).toBe(true);
    expect(targetLine(planned)).toBe("3 × 135 lb × 8");
    expect(targetLine(ex("done", { sets: strip(1) }))).toBe("1 time");
  });
});

describe("THE SET STRIP: uniform vs heterogeneous programming (catalog §1.2, §3.1)", () => {
  it("a uniform strip speaks as one line", () => {
    const uniform = strip(3, { w: 135, r: 5 });
    expect(isUniformStrip("weight_reps", uniform)).toBe(true);
    expect(targetLine(ex("weight_reps", { unit: "lb", sets: uniform }))).toBe("3 × 135 lb × 5");
  });

  it("a real program is not homogeneous: 3x5, 1x8 is expressed as itself", () => {
    // The exact case the catalog opens with: a back-off set that is not the
    // same as the three before it.
    const backOffSet = [
      mkSet({ w: 135, r: 5 }), mkSet({ w: 135, r: 5 }), mkSet({ w: 135, r: 5 }), mkSet({ w: 135, r: 8 }),
    ];
    expect(isUniformStrip("weight_reps", backOffSet)).toBe(false);
    const heteroEx = ex("weight_reps", { unit: "lb", sets: backOffSet });
    expect(targetLine(heteroEx)).toBe("135 lb × 5, 135 lb × 5, 135 lb × 5, 135 lb × 8");
  });

  it("a skipped or done chip breaks uniformity even with matching numbers", () => {
    const withSkip = [mkSet({ w: 100, r: 5 }), mkSet({ w: 100, r: 5, skipped: true })];
    expect(isUniformStrip("weight_reps", withSkip)).toBe(false);
  });

  it("a strip of one is trivially uniform", () => {
    expect(isUniformStrip("weight_reps", strip(1, { w: 200, r: 1 }))).toBe(true);
  });
});

// EMPTY IS A LEGAL VALUE (decision catalog 2026-08-30, and Dave 2026-08-31
// with a screenshot of his own editor showing "SET 2 · 0 lb × 8" on sets he
// never gave a weight: "Wasn't all this supposed to be changed?"). A set
// speaks only the numbers it actually has; nothing manufactures a zero.
// Zero and absent read the same, which is what heals his already-stored
// zeros with no migration.
describe("empty is legal: no surface manufactures a zero", () => {
  const lb = ex("weight_reps", { unit: "lb" });

  it("his exact screenshot: weight never said reads as reps, not 0 lb", () => {
    expect(formatSet(lb, { r: 8 })).toBe("8 reps");
    expect(formatSet(lb, { w: 0, r: 8 })).toBe("8 reps"); // stored zero heals too
    expect(formatSet(lb, { r: 8 })).not.toContain("0 lb");
  });

  it("reps never said reads as the weight alone", () => {
    expect(formatSet(lb, { w: 115 })).toBe("115 lb");
  });

  it("the bare done mark is a valid fact and says so", () => {
    expect(formatSet(lb, { done: true })).toBe("Done");
  });

  it("a chip with nothing in it says Empty, never 0 × 0", () => {
    expect(formatSet(lb, {})).toBe("Empty");
    expect(formatSet(ex("reps"), {})).toBe("Empty");
    expect(formatSet(ex("distance", { unit: "m" }), {})).toBe("Empty");
  });

  it("distance_time renders only the half that exists", () => {
    const dt = ex("distance_time", { unit: "mi", timeUnit: "min" });
    expect(formatSet(dt, { v: 3 })).toBe("3 mi");
    expect(formatSet(dt, { t: 24 })).toBe("24 min");
    expect(formatSet(dt, {})).toBe("Empty");
  });

  it("the Save line for his screenshot data lists real numbers only", () => {
    const e = ex("weight_reps", { unit: "lb", sets: [
      { id: "a", w: 115, r: 8 }, { id: "b", w: 0, r: 8 }, { id: "c", r: 8 },
    ] });
    expect(targetLine(e)).toBe("115 lb × 8, 8 reps, 8 reps");
    expect(targetLine(e)).not.toContain("0 lb");
  });
});
