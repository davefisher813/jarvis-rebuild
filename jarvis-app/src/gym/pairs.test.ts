import { describe, it, expect } from "vitest";
import { pairLabels, fillerFor, pairExercises, unpairExercise } from "./pairs";
import type { Exercise } from "./types";

const ex = (id: string, name: string, over: Partial<Exercise> = {}): Exercise =>
  ({ id, name, kind: "weight_reps", sets: [], ...over });

describe("pairLabels: A1/A2 notation (catalog §4.2)", () => {
  it("labels a symmetric pair A1/A2 in day order", () => {
    const day = [ex("e1", "Bench", { pairWith: "e2" }), ex("e2", "Row", { pairWith: "e1" }), ex("e3", "Curl")];
    const labels = pairLabels(day);
    expect(labels.get("e1")).toBe("A1");
    expect(labels.get("e2")).toBe("A2");
    expect(labels.has("e3")).toBe(false);
  });

  it("labels two separate pairs B after A", () => {
    const day = [
      ex("e1", "Bench", { pairWith: "e2" }), ex("e2", "Row", { pairWith: "e1" }),
      ex("e3", "Squat", { pairWith: "e4" }), ex("e4", "Lunge", { pairWith: "e3" }),
    ];
    const labels = pairLabels(day);
    expect(labels.get("e3")).toBe("B1");
    expect(labels.get("e4")).toBe("B2");
  });

  it("a stale one-sided link (the partner does not point back) gets no label", () => {
    const day = [ex("e1", "Bench", { pairWith: "e2" }), ex("e2", "Row")];
    expect(pairLabels(day).size).toBe(0);
  });
});

describe("fillerFor: catalog §4.2", () => {
  it("offers the filler paired with a lift during its rest", () => {
    const lift = ex("e1", "Bench", { pairWith: "e2", restSec: 120 });
    const filler = ex("e2", "T-Spine Rotations", { pairWith: "e1", filler: true });
    expect(fillerFor(lift, [lift, filler])?.name).toBe("T-Spine Rotations");
  });

  it("an ordinary A1/A2 pair (neither side a filler) offers nothing", () => {
    const a = ex("e1", "Bench", { pairWith: "e2" });
    const b = ex("e2", "Row", { pairWith: "e1" });
    expect(fillerFor(a, [a, b])).toBeNull();
  });

  it("an unpaired exercise offers nothing", () => {
    expect(fillerFor(ex("e1", "Bench"), [ex("e1", "Bench")])).toBeNull();
  });
});

describe("pairExercises / unpairExercise", () => {
  it("pairing two exercises sets a symmetric link", () => {
    const day = [ex("e1", "Bench"), ex("e2", "Row"), ex("e3", "Curl")];
    const paired = pairExercises(day, "e1", "e2");
    expect(paired.find((e) => e.id === "e1")!.pairWith).toBe("e2");
    expect(paired.find((e) => e.id === "e2")!.pairWith).toBe("e1");
  });

  it("re-pairing one side drops its old partner's link -- a pair is always exactly two", () => {
    const day = pairExercises([ex("e1", "Bench"), ex("e2", "Row"), ex("e3", "Curl")], "e1", "e2");
    const repaired = pairExercises(day, "e1", "e3");
    expect(repaired.find((e) => e.id === "e2")!.pairWith).toBeUndefined();
    expect(repaired.find((e) => e.id === "e3")!.pairWith).toBe("e1");
  });

  it("unpairExercise clears both sides", () => {
    const day = pairExercises([ex("e1", "Bench"), ex("e2", "Row")], "e1", "e2");
    const unpaired = unpairExercise(day, "e1");
    expect(unpaired.find((e) => e.id === "e1")!.pairWith).toBeUndefined();
    expect(unpaired.find((e) => e.id === "e2")!.pairWith).toBeUndefined();
  });
});
