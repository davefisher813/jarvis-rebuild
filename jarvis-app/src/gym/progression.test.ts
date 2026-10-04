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
    // Casing sweep 1 (2026-09-26): Title Case by the whole rule (§H2), units spelled "Min".
    expect(s.why).toContain("All Clean");
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

  // Part 3 wave 5 (Dave's 9b): with nothing marked, the completed reps
  // against the plan's range decide (double progression); with no range on
  // the plan either, there is still no opinion.
  it("with nothing marked, every set at the planned reps offers the increment; with no range on the plan, nothing", () => {
    const h = [wk("2026-08-24", [wex("Bench", [{ w: 225, r: 5 }, { w: 225, r: 5 }])])];
    const s = suggestFor(h, plan())!;
    expect(s.kind).toBe("bump");
    expect(s.basis!.marks).toBe("None Marked");
    expect(suggestFor(h, plan({ sets: [{ id: "p1", w: 225 }] }))).toBeNull();
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

  it("warm-ups are not evidence: a clean ramp mark is ignored, and the unmarked work set is read on its reps alone", () => {
    const h = [wk("2026-08-24", [wex("Bench", [
      { w: 45, r: 10, moved: "clean", warmup: true },
      { w: 225, r: 5 },
    ])])];
    const s = suggestFor(h, plan())!;
    expect(s.basis!.marks).toBe("None Marked");
    expect(s.basis!.source).toBe("1 Working Set on Aug 24");
    expect(suggestFor(h, plan({ sets: [{ id: "p1", w: 225 }] }))).toBeNull();
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

// Part 3 wave 5 (Dave's 9b and O2a): the Assisted engine.
describe("the Assisted engine", () => {
  const range = plan({ sets: [{ id: "p1", w: 225, r: 6 }, { id: "p2", w: 225, r: 8 }] });

  // 2026-10-04: Program was a third mode that returned nothing exactly as
  // Manual does; it left the menu and a stored one reads as Manual
  // (health/settings.test.ts), so the engine has the two that differ.
  it("Manual offers nothing and Assisted does", () => {
    const h = [wk("2026-09-10", [wex("Bench", [{ w: 225, r: 8, moved: "clean" }])])];
    expect(suggestFor(h, range, { mode: "manual" })).toBeNull();
    expect(suggestFor(h, range, { mode: "assisted" })).not.toBeNull();
  });

  it("with nothing marked, every completed set at the top of the range adds the smallest increment, with its basis", () => {
    const h = [wk("2026-09-10", [wex("Bench", [{ w: 225, r: 8 }, { w: 225, r: 8 }])])];
    const s = suggestFor(h, range, { smallestJump: 2.5, equipmentLabel: "Barbell" })!;
    expect(s.kind).toBe("bump");
    expect(s.next.w).toBe(227.5);
    expect(s.why).toMatch(/Every Set Cleared 8/);
    expect(s.basis).toMatchObject({ variant: "Bench, Barbell", range: "6 to 8 Reps", increment: "2.5 Lb", marks: "None Marked" });
    expect(s.basis!.source).toBe("2 Working Sets on Sep 10");
    expect(s.basis!.role).toMatch(/Warm-Ups and Drops Left Out/);
  });

  it("inside the range, the weight holds and the target is the top of the range; under it, a step back", () => {
    const inside = [wk("2026-09-10", [wex("Bench", [{ w: 225, r: 7 }, { w: 225, r: 6 }])])];
    const hold = suggestFor(inside, range)!;
    expect(hold.kind).toBe("hold");
    expect(hold.next).toMatchObject({ w: 225, r: 8 });
    const under = [wk("2026-09-10", [wex("Bench", [{ w: 225, r: 5 }, { w: 225, r: 4 }])])];
    expect(suggestFor(under, range)!.kind).toBe("back");
  });

  it("the marks win over the reps: a grind holds even at the top of the range", () => {
    const h = [wk("2026-09-10", [wex("Bench", [{ w: 225, r: 8, moved: "grind" }, { w: 225, r: 8 }])])];
    const s = suggestFor(h, range)!;
    expect(s.kind).toBe("hold");
    expect(s.basis!.marks).toBe("1 Grind");
  });

  it("a plan with no rep range and no marks says nothing, and warm-ups and drops never count", () => {
    const noRange = plan({ sets: [{ id: "p1", w: 225 }] });
    const h = [wk("2026-09-10", [wex("Bench", [{ w: 135, r: 10, warmup: true }, { w: 225, r: 8 }, { w: 185, r: 12, drop: true }])])];
    expect(suggestFor(h, noRange)).toBeNull();
    const s = suggestFor(h, range)!;
    expect(s.basis!.source).toBe("1 Working Set on Sep 10");
  });
});

// 2026-09-29: "Suggested 595 Lb x 2" over a card whose Last line said 270 x 5,
// with 360 x 3 and 450 x 3 before it. The Last header and the fields' seed read
// THIS WORKOUT DAY's previous session first (prs.ts lastSessionFor); the
// suggestion read the newest session of the lift on ANY day, so it built next
// week's target on a different day's heaviest set.
describe("suggestFor reads the same session the Last line does", () => {
  const day = (id: string, date: string, sets: Partial<SetEntry>[]) => {
    const w = wk(date, [wex("Bench", sets)]);
    w.data.dayId = id;
    return w;
  };
  const range = plan({ sets: [{ id: "p1", w: 270, r: 5 }] });
  const clean = (w: number, r: number) => ({ w, r, moved: "clean" as const });

  it("prefers this workout day's session over a newer session of another day", () => {
    const h = [
      day("heavy", "2026-09-10", [clean(270, 5), clean(270, 5)]),
      day("light", "2026-09-17", [clean(590, 2)]),
    ];
    const anyDay = suggestFor(h, range)!;
    expect(anyDay.from.w).toBe(590); // the old reading, still what no day preference gives
    const sameDay = suggestFor(h, range, { preferDayId: "heavy" })!;
    expect(sameDay.from.w).toBe(270);
    expect(sameDay.next.w).toBe(275);
  });

  it("falls back to the newest session when this day has never trained the lift", () => {
    const h = [day("light", "2026-09-17", [clean(225, 5)])];
    expect(suggestFor(h, range, { preferDayId: "heavy" })!.from.w).toBe(225);
  });

  it("speaks in the lift's unit: a kg session is converted, not read as pounds", () => {
    const kgSession = wk("2026-09-17", [{ exerciseId: "x", name: "Bench", kind: "weight_reps", unit: "kg",
      sets: [{ id: "k1", w: 100, r: 5, moved: "clean" }] }]);
    const s = suggestFor([kgSession], plan({ unit: "lb" }))!;
    expect(s.from.w).toBeCloseTo(220.5, 0);
    expect(s.next.w).toBeLessThan(230);
  });

  it("offers nothing when the heaviest set is more than 1.5x the tops before it (an outlier, not a trend)", () => {
    const h = [
      day("d", "2026-08-20", [clean(360, 3)]),
      day("d", "2026-08-27", [clean(450, 3)]),
      day("d", "2026-09-03", [clean(450, 3)]),
      day("d", "2026-09-10", [clean(2250, 3)]),
    ];
    expect(suggestFor(h, plan({ sets: [{ id: "p1", w: 450, r: 3 }] }))).toBeNull();
  });

  it("still offers a real jump: a session 25 percent above the last is a trend, not an outlier", () => {
    const h = [
      day("d", "2026-08-20", [clean(360, 3)]),
      day("d", "2026-08-27", [clean(360, 3)]),
      day("d", "2026-09-03", [clean(450, 3)]),
    ];
    expect(suggestFor(h, plan({ sets: [{ id: "p1", w: 450, r: 3 }] }))!.next.w).toBe(455);
  });

  it("does not guard with fewer than two earlier sessions to compare", () => {
    const h = [day("d", "2026-08-20", [clean(135, 5)]), day("d", "2026-09-03", [clean(400, 5)])];
    expect(suggestFor(h, plan({ sets: [{ id: "p1", w: 400, r: 5 }] }))).not.toBeNull();
  });
});
