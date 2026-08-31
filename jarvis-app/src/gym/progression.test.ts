import { describe, it, expect } from "vitest";
import { suggestFor, applySuggestion } from "./progression";
import type { Workout, WorkoutExercise, SetEntry, Exercise } from "./types";

const wk = (date: string, exs: WorkoutExercise[]): Workout =>
  ({ id: date, data: { programId: "p", dayId: "d", dayName: "Day", date, startedAt: 0, endedAt: 0, exercises: exs } });
const wex = (name: string, sets: Partial<SetEntry>[], kind: "weight_reps" | "reps" = "weight_reps"): WorkoutExercise =>
  ({ exerciseId: "x", name, kind, unit: kind === "weight_reps" ? "lb" : undefined, sets: sets.map((s, i) => ({ id: `s${i}`, ...s })) });
const plan = (over: Partial<Exercise> = {}): Exercise => ({
  id: "e1", name: "Bench", kind: "weight_reps", unit: "lb",
  sets: [{ id: "p1", w: 225, r: 5 }, { id: "p2", w: 225, r: 5 }], ...over,
});

// THE PROGRESSION ENGINE (D6-A). It reads the marks the athlete already
// makes -- all clean, a grind, a miss -- and offers. It never edits.
describe("suggestFor", () => {
  it("offers a bump when every marked set of the last session was clean", () => {
    const h = [wk("2026-08-24", [wex("Bench", [{ w: 225, r: 5, moved: "clean" }, { w: 225, r: 5, moved: "clean" }])])];
    const s = suggestFor(h, plan())!;
    expect(s.next.w).toBe(230);
    expect(s.next.r).toBe(5);
    expect(s.why).toContain("all clean");
  });

  it("holds after a grind: the same weight, and it says why", () => {
    const h = [wk("2026-08-24", [wex("Bench", [{ w: 225, r: 5, moved: "clean" }, { w: 225, r: 5, moved: "grind" }])])];
    const s = suggestFor(h, plan())!;
    expect(s.next.w).toBe(225);
    expect(s.kind).toBe("hold");
  });

  it("offers a step back after a miss, never a bump", () => {
    const h = [wk("2026-08-24", [wex("Bench", [{ w: 225, r: 5, moved: "missed" }])])];
    const s = suggestFor(h, plan())!;
    expect(s.next.w).toBeLessThan(225);
    expect(s.kind).toBe("back");
  });

  it("says nothing at all when nothing was marked: no marks, no opinion", () => {
    const h = [wk("2026-08-24", [wex("Bench", [{ w: 225, r: 5 }, { w: 225, r: 5 }])])];
    expect(suggestFor(h, plan())).toBeNull();
  });

  it("says nothing on a lift with no history", () => {
    expect(suggestFor([], plan())).toBeNull();
  });

  it("a rep-only lift gains a rep, never a phantom weight", () => {
    const h = [wk("2026-08-24", [wex("Pull-Ups", [{ r: 8, moved: "clean" }], "reps")])];
    const s = suggestFor(h, plan({ name: "Pull-Ups", kind: "reps", sets: [{ id: "p1", r: 8 }] }))!;
    expect(s.next.r).toBe(9);
    expect(s.next.w).toBeUndefined();
  });

  it("dumbbell-sized jumps stay small when the athlete's own numbers are small", () => {
    const h = [wk("2026-08-24", [wex("Curl", [{ w: 30, r: 12, moved: "clean" }])])];
    const s = suggestFor(h, plan({ name: "Curl", sets: [{ id: "p1", w: 30, r: 12 }] }))!;
    expect(s.next.w).toBe(32.5);
  });

  it("warm-ups are not evidence: a clean ramp with an unmarked work set says nothing", () => {
    const h = [wk("2026-08-24", [wex("Bench", [
      { w: 45, r: 10, moved: "clean", warmup: true },
      { w: 225, r: 5 },
    ])])];
    expect(suggestFor(h, plan())).toBeNull();
  });

  it("reads the most recent session only, not an old good day", () => {
    const h = [
      wk("2026-08-10", [wex("Bench", [{ w: 215, r: 5, moved: "clean" }])]),
      wk("2026-08-24", [wex("Bench", [{ w: 225, r: 5, moved: "grind" }])]),
    ];
    expect(suggestFor(h, plan())!.kind).toBe("hold");
  });

  it("a suggestion is a ghost: nothing in the program moves until it is applied", () => {
    const h = [wk("2026-08-24", [wex("Bench", [{ w: 225, r: 5, moved: "clean" }])])];
    const p = plan();
    const before = JSON.stringify(p);
    suggestFor(h, p);
    expect(JSON.stringify(p)).toBe(before);
  });
});

describe("applySuggestion", () => {
  it("writes the new target across the working sets, leaving ids and ramps alone", () => {
    const p = plan({ sets: [{ id: "w", w: 45, r: 10, warmup: true }, { id: "p1", w: 225, r: 5 }, { id: "p2", w: 225, r: 5 }] });
    const out = applySuggestion(p, { kind: "bump", next: { w: 230, r: 5 }, why: "x", from: { w: 225, r: 5 } });
    expect(out.sets.map((s) => s.w)).toEqual([45, 230, 230]);
    expect(out.sets[1]!.id).toBe("p1");
    expect(out.sets[0]!.warmup).toBe(true);
  });

  it("never touches a skipped chip", () => {
    const p = plan({ sets: [{ id: "p1", w: 225, r: 5 }, { id: "p2", skipped: true }] });
    const out = applySuggestion(p, { kind: "bump", next: { w: 230, r: 5 }, why: "x", from: { w: 225, r: 5 } });
    expect(out.sets[1]!.skipped).toBe(true);
    expect(out.sets[1]!.w).toBeUndefined();
  });
});
