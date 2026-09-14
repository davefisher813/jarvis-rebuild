import { describe, it, expect } from "vitest";
import {
  asksCount, comparable, countsFor, defaultCount, loadStyleOf, lowerIsStronger,
  plateMath, styleSummary, volumeFactor, weightLabel, weightStep, weightless,
} from "./equipment";
import { beats, fieldsFor, scoreOf, setVolume } from "./measures";

describe("loadStyleOf: nothing already saved changes meaning", () => {
  it("reads the pre-menu load flag as a dumbbell counted each hand", () => {
    expect(loadStyleOf({ load: "each" })).toEqual({ equipment: "dumbbell", counted: "each_hand" });
    expect(loadStyleOf({ load: "total" })).toEqual({});
  });

  it("keeps the meaning of the two options that were never equipment", () => {
    // "One Side at a Time" said how to COUNT, so it becomes a count.
    expect(loadStyleOf({ equipment: "unilateral" })).toEqual({ equipment: "other", counted: "each_side" });
    // "Timed or Distance" was not a load at all.
    expect(loadStyleOf({ equipment: "timed" }).equipment).toBe("other");
  });

  it("carries the old dumbbell label's each-hand reading forward", () => {
    expect(loadStyleOf({ equipment: "dumbbell" })).toEqual({ equipment: "dumbbell", counted: "each_hand" });
  });

  it("says nothing about an exercise that never said anything", () => {
    expect(loadStyleOf({})).toEqual({});
  });
});

describe("the stepper adjusts to the equipment", () => {
  // Dave, 2026-09-14: "The weight should adjust accordingly... It can't all
  // be the same." It was 5, for everything, forever.
  it("steps the rack's real granularity, not one number for all of it", () => {
    expect(weightStep({ equipment: "barbell" })).toBe(5);
    expect(weightStep({ equipment: "stack" })).toBe(10);
    expect(weightStep({ equipment: "bodyweight" })).toBe(2.5);
    expect(weightStep({ equipment: "stack" }, "kg")).toBe(5);
    expect(weightStep({ equipment: "bodyweight" }, "kg")).toBe(1);
  });

  it("falls back to the old universal 5 when nothing was said", () => {
    expect(weightStep({})).toBe(5);
    expect(fieldsFor("weight_reps").find((f) => f.key === "w")).toEqual({ key: "w", label: "Weight", step: 5 });
  });

  it("names the Weight row for what the number actually is", () => {
    expect(weightLabel({ counted: "each_hand" })).toBe("Weight Per Hand");
    expect(weightLabel({ counted: "each_side" })).toBe("Weight Per Side");
    expect(weightLabel({ counted: "assist" })).toBe("Assistance");
    expect(weightLabel({ counted: "added" })).toBe("Added Weight");
    expect(weightLabel({})).toBe("Weight");
    const f = fieldsFor("weight_reps", { equipment: "stack", counted: "total", unit: "lb" });
    expect(f.find((x) => x.key === "w")).toEqual({ key: "w", label: "Weight", step: 10 });
  });
});

describe("Counted As is asked only when it is a question", () => {
  it("stays away from equipment with one reading, and from no equipment", () => {
    expect(asksCount("stack")).toBe(false);
    expect(asksCount("assisted")).toBe(false);
    expect(asksCount("bodyweight")).toBe(false);
    expect(asksCount(undefined)).toBe(false);
    expect(asksCount("dumbbell")).toBe(true);
    expect(asksCount("machine")).toBe(true);
  });

  it("brings its own default so picking the equipment is one tap", () => {
    expect(defaultCount("dumbbell")).toBe("each_hand");
    expect(defaultCount("barbell")).toBe("total");
    expect(defaultCount("assisted")).toBe("assist");
    expect(countsFor("barbell")).toEqual(["total", "each_side"]);
  });
});

describe("tonnage counts what actually moved", () => {
  const set = { w: 50, r: 10 };

  it("was half-counting every per-hand and per-side lift", () => {
    expect(setVolume("weight_reps", set, "lb")).toBe(500);
    expect(setVolume("weight_reps", set, "lb", { counted: "each_hand" })).toBe(1000);
    expect(setVolume("weight_reps", set, "lb", { counted: "each_side" })).toBe(1000);
    expect(setVolume("weight_reps", set, "lb", { counted: "total" })).toBe(500);
    expect(volumeFactor({ counted: "each_hand" })).toBe(2);
  });

  it("counts assistance as no tonnage rather than as flattering tonnage", () => {
    // Counting the help as work would say a lifter moved more the more of it
    // they took. Zero is the honest answer without a bodyweight to subtract.
    expect(setVolume("weight_reps", { w: 80, r: 8 }, "lb", { counted: "assist" })).toBe(0);
  });

  it("leaves the number on the chip alone either way", () => {
    // The convention is a label; only the SUM changes.
    expect(set.w).toBe(50);
  });
});

describe("less can be stronger", () => {
  const style = { equipment: "assisted" as const, counted: "assist" as const };

  it("reads an assisted lift's lightest set as its best", () => {
    expect(lowerIsStronger(style)).toBe(true);
    expect(scoreOf("weight_reps", { w: 60, r: 8 }, "lb", style)!.lowerWins).toBe(true);
    // 60 lb of help beats 100 lb of help. Before this it lost to it.
    expect(beats("weight_reps", { w: 60, r: 8 }, { w: 100, r: 8 }, {}, { of: style, than: style })).toBe(true);
    expect(beats("weight_reps", { w: 100, r: 8 }, { w: 60, r: 8 }, {}, { of: style, than: style })).toBe(false);
  });

  it("leaves every other lift heavier-wins", () => {
    const bar = { equipment: "barbell" as const, counted: "total" as const };
    expect(scoreOf("weight_reps", { w: 225, r: 5 }, "lb", bar)!.lowerWins).toBe(false);
    expect(beats("weight_reps", { w: 245, r: 5 }, { w: 225, r: 5 }, {}, { of: bar, than: bar })).toBe(true);
  });
});

describe("not every pair of sets is a comparison", () => {
  it("refuses to hand out a record for a change of machine", () => {
    const perSide = { equipment: "machine" as const, counted: "each_side" as const };
    const whole = { equipment: "stack" as const, counted: "total" as const };
    expect(comparable(perSide, whole)).toBe(false);
    expect(beats("weight_reps", { w: 120, r: 8 }, { w: 100, r: 8 }, {}, { of: perSide, than: whole })).toBe(false);
  });

  it("still compares two lifts that merely use different hardware the same way", () => {
    const bar = { equipment: "barbell" as const, counted: "total" as const };
    const machine = { equipment: "machine" as const, counted: "total" as const };
    expect(comparable(bar, machine)).toBe(true);
  });

  it("lets anything logged before this compare with anything, as it always did", () => {
    expect(comparable({}, { counted: "each_side" })).toBe(true);
    expect(beats("weight_reps", { w: 120, r: 8 }, { w: 100, r: 8 })).toBe(true);
  });
});

describe("the rest of what the equipment decides", () => {
  it("offers plate math only where plates go, and a bar only on a barbell", () => {
    expect(plateMath({ equipment: "barbell" })).toEqual({ offer: true, hasBar: true });
    expect(plateMath({ equipment: "machine" })).toEqual({ offer: true, hasBar: false });
    expect(plateMath({ equipment: "stack" })).toEqual({ offer: false, hasBar: false });
    expect(plateMath({})).toEqual({ offer: false, hasBar: false });
  });

  it("drops the weight field on a band instead of asking for a fiction", () => {
    expect(weightless({ equipment: "band" })).toBe(true);
    expect(weightless({ equipment: "barbell" })).toBe(false);
  });

  it("summarises without repeating the default back at you", () => {
    expect(styleSummary({ equipment: "dumbbell", counted: "each_hand" })).toBe("Dumbbells");
    expect(styleSummary({ equipment: "dumbbell", counted: "total" })).toBe("Dumbbells · The Whole Load");
    // 2026-09-14: the two machine words are said in full now. The pin-and-stack
    // kind is a selectorized machine; "Weight Stack" described the same object
    // from a different angle and left the pair illegible as a pair.
    expect(styleSummary({ equipment: "stack", counted: "total" })).toBe("Selectorized Machine");
    expect(styleSummary({ equipment: "smith", counted: "total" })).toBe("Smith Machine");
    expect(styleSummary({ equipment: "kettlebell", counted: "each_hand" })).toBe("Kettlebell");
    expect(styleSummary({})).toBe("Not Set");
  });
});
