import { describe, it, expect } from "vitest";
import { suggestFor, applySuggestion } from "./progression";
import type { Workout, WorkoutExercise, SetEntry, Exercise } from "./types";

const wk = (date: string, exs: WorkoutExercise[], dayId = "d"): Workout =>
  ({ id: date + dayId, data: { programId: "p", dayId, dayName: "Day", date, startedAt: 0, endedAt: 0, exercises: exs } });
const wex = (name: string, sets: Partial<SetEntry>[], kind: "weight_reps" | "reps" = "weight_reps"): WorkoutExercise =>
  ({ exerciseId: "x", name, kind, unit: kind === "weight_reps" ? "lb" : undefined, sets: sets.map((s, i) => ({ id: `s${i}`, ...s })) });
const plan = (over: Partial<Exercise> = {}): Exercise => ({
  id: "e1", name: "Bench", kind: "weight_reps", unit: "lb",
  sets: [{ id: "p1", w: 275, r: 6 }, { id: "p2", w: 275, r: 8 }, { id: "p3", w: 275, r: 8 }], ...over,
});
/** One session of Bench at `w` for each rep count. */
const bench = (date: string, w: number, reps: number[], marks: ("clean" | "grind" | "missed" | undefined)[] = []) =>
  wk(date, [wex("Bench", reps.map((r, i) => ({ w, r, ...(marks[i] ? { moved: marks[i] } : {}) })))]);

// THE ONE PUBLISHED RULE (section 10, 2026-10-17): autoregulated double
// progression. Every suggestion names the lifter's own last sets, and nothing
// is written until he logs it.
describe("rule 1: hold the load and add reps inside the range", () => {
  it("below the top of the range, the load holds and the target is the top", () => {
    const s = suggestFor([bench("2026-10-10", 275, [8, 7, 6])], plan())!;
    expect(s.kind).toBe("hold");
    expect(s.next).toEqual({ w: 275, r: 8 });
    expect(s.reason).toEqual(["Last Time 275 × 8, 7, 6", "Below the Top of 6 to 8", "Hold 275, Add Reps to 8"]);
    expect(s.expect).toBeUndefined();
  });

  it("a single rep target is the top, and two under it the bottom", () => {
    const s = suggestFor([bench("2026-10-10", 225, [5, 4])], plan({ sets: [{ id: "p1", w: 225, r: 5 }, { id: "p2", w: 225, r: 5 }] }))!;
    expect(s.range).toEqual({ low: 3, high: 5 });
    expect(s.kind).toBe("hold");
  });

  it("only the sets AT the working load count: a back-off set under the range is not a miss", () => {
    const h = [wk("2026-10-10", [wex("Bench", [{ w: 275, r: 8 }, { w: 275, r: 8 }, { w: 275, r: 8 }, { w: 225, r: 4 }])])];
    expect(suggestFor(h, plan())!.kind).toBe("bump");
  });
});

describe("rule 2: step when every set is at the top", () => {
  it("steps about 2.5 percent to the smallest jump, resets reps to the bottom, and says what to expect", () => {
    const s = suggestFor([bench("2026-10-10", 275, [8, 8, 8])], plan(), { smallestJump: 5 })!;
    expect(s.kind).toBe("bump");
    expect(s.next).toEqual({ w: 280, r: 6 });
    expect(s.reason).toEqual(["Last Time 275 × 8, 8, 8", "All at the Top of 6 to 8", "Step to 280 × 6"]);
    expect(s.expect).toBe("Expect 6 to 7");
    expect(s.why).toBe("Last Time 275 × 8, 8, 8, All at the Top of 6 to 8, Step to 280 × 6");
  });

  it("a pair of 2.5 plates is a 5 jump; the 2.5 default is the engine's floor", () => {
    expect(suggestFor([bench("2026-10-10", 200, [8, 8, 8])], plan(), { smallestJump: 5 })!.next.w).toBe(205);
    expect(suggestFor([bench("2026-10-10", 200, [8, 8, 8])], plan())!.next.w).toBe(205);
    expect(suggestFor([bench("2026-10-10", 120, [8, 8, 8])], plan())!.next.w).toBe(122.5);
  });

  it("never steps more than 5 percent once a jump fits under it, and never less than one jump", () => {
    for (const load of [60, 85, 100, 135, 185, 225, 275, 315, 405, 500]) {
      for (const jump of [1, 2.5, 5, 10]) {
        if (jump > load * 0.07) continue; // rule 2's other branch
        const s = suggestFor([bench("2026-10-10", load, [8, 8, 8])], plan(), { smallestJump: jump })!;
        const step = s.next.w! - load;
        expect(step, `${load} by ${jump}`).toBeGreaterThanOrEqual(jump - 1e-9);
        expect(step <= load * 0.05 + 1e-9 || Math.abs(step - jump) < 1e-9, `${load} by ${jump} stepped ${step}`).toBe(true);
      }
    }
  });

  it("the 7 percent rule: a jump too big for the load extends the range top by three instead", () => {
    const curl = wk("2026-10-10", [wex("Curl", [{ w: 30, r: 12 }, { w: 30, r: 12 }])]);
    const s = suggestFor([curl], plan({ name: "Curl", sets: [{ id: "p1", w: 30, r: 10 }, { id: "p2", w: 30, r: 12 }] }), { smallestJump: 5 })!;
    expect(s.kind).toBe("extend");
    expect(s.next).toEqual({ w: 30, r: 15 });
    expect(s.range).toEqual({ low: 10, high: 15 });
    expect(s.reason[2]).toBe("A 5 Jump Is Over 7% of 30, Range Now 10 to 15");
    expect(s.addSet, "no load step this week, so a set may be added").toBe(true);
  });

  it("a rep-only lift adds a rep at the top, never a phantom weight", () => {
    const h = [wk("2026-10-10", [wex("Pull-Ups", [{ r: 8 }, { r: 8 }], "reps")])];
    const s = suggestFor(h, plan({ name: "Pull-Ups", kind: "reps", unit: undefined, sets: [{ id: "p1", r: 8 }] }))!;
    expect(s.next).toEqual({ r: 9 });
    expect(s.next.w).toBeUndefined();
    expect(s.reason[0]).toBe("Last Time 8, 8 Reps");
  });
});

describe("rule 3: two strikes", () => {
  const p = plan();
  it("one missed session repeats the same prescription", () => {
    const s = suggestFor([bench("2026-10-03", 275, [8, 8, 8]), bench("2026-10-10", 275, [6, 5, 4])], p)!;
    expect(s.kind).toBe("hold");
    expect(s.next).toEqual({ w: 275, r: 6 });
    expect(s.reason[1]).toBe("Under 6 Once");
  });

  it("two in a row cut the load 5 percent to the jump, 10 percent for a lifter with under twelve sessions", () => {
    const novice = [bench("2026-10-03", 275, [6, 5, 4]), bench("2026-10-10", 275, [6, 5, 4])];
    const n = suggestFor(novice, p, { smallestJump: 5 })!;
    expect(n.kind).toBe("back");
    expect(n.next).toEqual({ w: 245, r: 6 });
    expect(n.reason).toEqual(["Last Time 275 × 6, 5, 4", "Under 6 Twice", "Back to 245 × 6"]);
    const seasoned = [
      ...Array.from({ length: 10 }, (_, i) => bench(`2026-07-${String(i + 1).padStart(2, "0")}`, 255, [8, 8, 8])),
      bench("2026-10-03", 275, [6, 5, 4]), bench("2026-10-10", 275, [6, 5, 4]),
    ];
    expect(suggestFor(seasoned, p, { smallestJump: 5 })!.next.w).toBe(260);
  });

  it("a stall at the same load again asks for a different rep range before any swap", () => {
    const h = [
      bench("2026-09-05", 275, [5, 5, 4]), bench("2026-09-12", 275, [5, 4, 4]),
      bench("2026-09-19", 260, [8, 8, 8]), bench("2026-09-26", 265, [8, 8, 8]),
      bench("2026-10-03", 275, [5, 5, 5]), bench("2026-10-10", 275, [5, 4, 4]),
    ];
    const s = suggestFor(h, p)!;
    expect(s.kind).toBe("scheme");
    expect(s.next).toEqual({ w: 275, r: 6 });
    expect(s.reason).toEqual(["Last Time 275 × 5, 4, 4", "Stalled at 275 Twice", "Try a Different Rep Range"]);
  });
});

describe("rule 4: a lighter week", () => {
  it("a back-off week halves the sets and takes about 10 percent off, nothing to failure", () => {
    const s = suggestFor([bench("2026-10-10", 275, [8, 8, 8])], plan(), { smallestJump: 5, backOffWeek: true })!;
    expect(s.kind).toBe("lighter");
    expect(s.next).toEqual({ w: 245, r: 6 });
    expect(s.sets).toBe(2);
    expect(s.reason).toEqual(["Last Time 275 × 8, 8, 8", "Back-Off Week", "Lighter Week 245 × 6, 2 Sets, Nothing to Failure"]);
  });

  it("five accumulation sessions in a row suggest one on their own; a lighter session resets the count", () => {
    const up = [255, 260, 265, 270, 275].map((w, i) => bench(`2026-09-${String(5 + i * 7).padStart(2, "0")}`, w, [8, 8, 8]));
    const s = suggestFor(up, plan(), { smallestJump: 5 })!;
    expect(s.kind).toBe("lighter");
    expect(s.reason[1]).toBe("5 Sessions Up Without a Lighter One");
    const reset = [...up.slice(0, 3), bench("2026-09-26", 225, [8, 8]), bench("2026-10-03", 275, [8, 8, 8])];
    expect(suggestFor(reset, plan(), { smallestJump: 5 })!.kind).toBe("bump");
  });
});

describe("rule 6: his marks, when he made them", () => {
  it("All Clean lets the step through below the top; a miss holds it at the top", () => {
    const easy = suggestFor([bench("2026-10-10", 275, [8, 7, 7], ["clean", "clean", "clean"])], plan(), { smallestJump: 5 })!;
    expect(easy.kind).toBe("bump");
    expect(easy.reason[1]).toBe("Marked Easy");
    const hard = suggestFor([bench("2026-10-10", 275, [8, 8, 8], [undefined, undefined, "missed"])], plan())!;
    expect(hard.kind).toBe("hold");
    expect(hard.reason[1]).toBe("Marked Hard");
    expect(hard.addSet).toBe(true);
    expect(hard.basis!.marks).toBe("1 Missed");
  });

  it("a grind is right: the reps decide", () => {
    expect(suggestFor([bench("2026-10-10", 275, [8, 8, 8], ["grind"])], plan(), { smallestJump: 5 })!.kind).toBe("bump");
    expect(suggestFor([bench("2026-10-10", 275, [8, 7, 8], ["grind"])], plan())!.kind).toBe("hold");
  });
});

describe("silence where there is no evidence", () => {
  it("no history, Manual mode, or no rep range on the plan", () => {
    expect(suggestFor([], plan())).toBeNull();
    expect(suggestFor([bench("2026-10-10", 275, [8, 8, 8])], plan(), { mode: "manual" })).toBeNull();
    expect(suggestFor([bench("2026-10-10", 275, [8, 8, 8])], plan({ sets: [{ id: "p1", w: 275 }] }))).toBeNull();
  });

  it("warm-ups and drops are not evidence", () => {
    const h = [wk("2026-10-10", [wex("Bench", [{ w: 135, r: 10, warmup: true, moved: "clean" }, { w: 275, r: 7 }, { w: 225, r: 12, drop: true }])])];
    const s = suggestFor(h, plan())!;
    expect(s.kind).toBe("hold");
    expect(s.basis!.source).toBe("1 Working Set on Oct 10");
    expect(s.basis!.marks).toBe("None Marked");
  });

  it("the outlier guard still holds: a top set past 1.5x the tops before it offers nothing", () => {
    const h = [bench("2026-08-20", 360, [3]), bench("2026-08-27", 450, [3]), bench("2026-09-03", 450, [3]), bench("2026-09-10", 2250, [3])];
    expect(suggestFor(h, plan({ sets: [{ id: "p1", w: 450, r: 3 }] }))).toBeNull();
  });

  it("a suggestion is a ghost: nothing in the program moves until it is applied", () => {
    const p = plan();
    const before = JSON.stringify(p);
    suggestFor([bench("2026-10-10", 275, [8, 8, 8])], p);
    expect(JSON.stringify(p)).toBe(before);
  });
});

describe("the session it reads", () => {
  it("prefers this workout day's session over a newer session of another day", () => {
    const h = [bench("2026-09-10", 275, [8, 8, 8]), wk("2026-09-17", [wex("Bench", [{ w: 315, r: 2 }])], "light")];
    expect(suggestFor(h, plan(), { preferDayId: "d" })!.from.w).toBe(275);
    expect(suggestFor(h, plan(), { preferDayId: "nowhere" })!.from.w).toBe(315);
  });

  it("speaks in the lift's unit: a kg session is converted, not read as pounds", () => {
    const kg = wk("2026-09-17", [{ exerciseId: "x", name: "Bench", kind: "weight_reps", unit: "kg", sets: [{ id: "k1", w: 100, r: 8 }, { id: "k2", w: 100, r: 8 }] }]);
    const s = suggestFor([kg], plan({ unit: "lb" }), { smallestJump: 5 })!;
    expect(s.from.w).toBeCloseTo(220.5, 0);
    expect(s.next.w).toBeCloseTo(225.5, 0);
  });
});

describe("applySuggestion", () => {
  const sug = (next: { w?: number; r?: number }) => ({ kind: "bump" as const, next, from: { w: 275, r: 8 }, reason: [], why: "", range: { low: 6, high: 8 } });

  it("writes the new target across the working sets, leaving ids and ramps alone", () => {
    const p = plan({ sets: [{ id: "w", w: 45, r: 10, warmup: true }, { id: "p1", w: 275, r: 8 }, { id: "p2", w: 275, r: 8 }] });
    const out = applySuggestion(p, sug({ w: 280, r: 6 }));
    expect(out.sets.map((s) => s.w)).toEqual([45, 280, 280]);
    expect(out.sets[1]!.id).toBe("p1");
    expect(out.sets[0]!.warmup).toBe(true);
  });

  it("never touches a skipped chip, and never changes the set count (rule 5)", () => {
    const p = plan({ sets: [{ id: "p1", w: 275, r: 8 }, { id: "p2", skipped: true }] });
    const out = applySuggestion(p, sug({ w: 280, r: 6 }));
    expect(out.sets).toHaveLength(2);
    expect(out.sets[1]!.skipped).toBe(true);
    expect(out.sets[1]!.w).toBeUndefined();
  });
});
