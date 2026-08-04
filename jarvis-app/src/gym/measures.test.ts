import { describe, it, expect } from "vitest";
import { formatSet, logButtonLabel, entryNoun, beats, hasVolume, setVolume, scoreOf, fieldsFor, hasTarget, targetLine } from "./measures";
import type { Exercise, MeasureKind } from "./types";

// Nine measure kinds, and the direction lives IN the kind. These pin the two
// things that would silently lie: which way a record goes, and whether "weight
// moved" means anything for this kind.

const ex = (kind: MeasureKind, over: Partial<Exercise> = {}): Exercise =>
  ({ id: "e", name: "X", kind, sets: 3, ...over }) as Exercise;

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

describe("the one-tap button reads the real plan", () => {
  it("labels with the target, and Done needs no numbers", () => {
    expect(logButtonLabel(ex("weight_reps", { unit: "lb", target: { w: 135, r: 8 } }))).toBe("Log 135 lb × 8");
    expect(logButtonLabel(ex("time_faster", { unit: "sec", target: { v: 4.6 } }))).toBe("Log 4.6 sec");
    expect(logButtonLabel(ex("done"))).toBe("Mark Done");
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
    expect(fieldsFor("weight_reps").map((f) => f.key)).toEqual(["w", "r"]);
    expect(fieldsFor("distance_time").map((f) => f.key)).toEqual(["v", "t"]);
    expect(fieldsFor("done")).toEqual([]);
  });
});

describe("an exercise with no target never offers to log a zero", () => {
  it("says what it will do instead, on the button and the plan line", () => {
    const bare = ex("time_faster", { unit: "sec", sets: 4 });
    expect(hasTarget(bare)).toBe(false);
    expect(logButtonLabel(bare)).toBe("Log Attempt");
    expect(targetLine(bare)).toBe("4 attempts");
    const planned = ex("weight_reps", { unit: "lb", sets: 3, target: { w: 135, r: 8 } });
    expect(hasTarget(planned)).toBe(true);
    expect(targetLine(planned)).toBe("3 × 135 lb × 8");
    expect(targetLine(ex("done", { sets: 1 }))).toBe("1 time");
  });
});
