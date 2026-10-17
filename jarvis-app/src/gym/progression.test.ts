import { describe, it, expect } from "vitest";
import { suggestFor, applySuggestion, inSessionAdjust, weekPicture, weekTrigger } from "./progression";
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
    expect(s.addSet, "no load step, but no week before it to show no misses (rule 5)").toBeUndefined();
    const lastWeekClean = wk("2026-10-03", [wex("Curl", [{ w: 30, r: 11 }, { w: 30, r: 10 }])]);
    const withWeek = suggestFor([lastWeekClean, curl], plan({ name: "Curl", sets: [{ id: "p1", w: 30, r: 10 }, { id: "p2", w: 30, r: 12 }] }), { smallestJump: 5 })!;
    expect(withWeek.addSet, "no load step this week and a clean week before it, so a set may be added").toBe(true);
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
    const hard = suggestFor([bench("2026-10-03", 275, [8, 8, 7]), bench("2026-10-10", 275, [8, 8, 8], [undefined, undefined, "missed"])], plan())!;
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

  // THE RANGE HOLDS STILL ACROSS STEPS (2026-10-17). A step wrote the bottom
  // of the range into every working set, and rangeOf read a uniform plan of r
  // as r-2 to r: 6, 8, 8 (6 to 8) became 6, 6, 6 and read as 4 to 6, and the
  // next step read 4, 4, 4 as 2 to 4. The range crept down one step per
  // accepted step. The plan keeps its range now, and three steps in a row
  // keep it at 6 to 8 while the load climbs each time.
  it("three accepted steps in a row keep the plan's range and climb the load each time", () => {
    let p = plan(); // 275 for 6, 8, 8: the range is 6 to 8
    const history: Workout[] = [];
    const loads = [275, 280, 285];
    for (const [i, load] of loads.entries()) {
      history.push(bench(`2026-10-0${i + 1}`, load, [8, 8, 8]));
      const s = suggestFor(history, p, { smallestJump: 5 })!;
      expect(s.kind, `step ${i + 1}`).toBe("bump");
      expect(s.range, `step ${i + 1} reads the plan's own range`).toEqual({ low: 6, high: 8 });
      expect(s.next, `step ${i + 1}`).toEqual({ w: load + 5, r: 6 });
      expect(s.reason[1], `step ${i + 1}`).toBe("All at the Top of 6 to 8");
      p = applySuggestion(p, s);
      expect(p.sets.map((x) => x.r), "reps reset to the bottom (rule 2)").toEqual([6, 6, 6]);
      expect(p.repRange).toEqual({ low: 6, high: 8 });
    }
    expect(p.sets.map((x) => x.w)).toEqual([290, 290, 290]);
  });

  it("a hold inside the kept range reads the same range, and the extended range (rule 2) is kept too", () => {
    // After a step the plan is 280 for 6, 6, 6 with the range kept; a session
    // of 7, 7, 6 at 280 is below the top of 6 to 8, not of 4 to 6.
    const stepped = applySuggestion(plan(), suggestFor([bench("2026-10-01", 275, [8, 8, 8])], plan(), { smallestJump: 5 })!);
    const hold = suggestFor([bench("2026-10-08", 280, [7, 7, 6])], stepped, { smallestJump: 5 })!;
    expect(hold.kind).toBe("hold");
    expect(hold.reason).toEqual(["Last Time 280 × 7, 7, 6", "Below the Top of 6 to 8", "Hold 280, Add Reps to 8"]);
    // A jump over 7 percent of the load widens the range by three instead of
    // stepping; the widened range is what the plan keeps.
    const light = plan({ sets: [{ id: "p1", w: 30, r: 6 }, { id: "p2", w: 30, r: 8 }] });
    const ext = suggestFor([wk("2026-10-01", [wex("Bench", [{ w: 30, r: 8 }, { w: 30, r: 8 }])])], light, { smallestJump: 5 })!;
    expect(ext.kind).toBe("extend");
    const widened = applySuggestion(light, ext);
    expect(widened.repRange).toEqual({ low: 6, high: 11 });
    expect(suggestFor([wk("2026-10-08", [wex("Bench", [{ w: 30, r: 9 }, { w: 30, r: 9 }])])], widened, { smallestJump: 5 })!.range).toEqual({ low: 6, high: 11 });
  });

  it("a hand edit that leaves the kept range is a new plan: the range derives from the reps again", () => {
    const stepped = applySuggestion(plan(), suggestFor([bench("2026-10-01", 275, [8, 8, 8])], plan(), { smallestJump: 5 })!);
    const edited = { ...stepped, sets: stepped.sets.map((s) => ({ ...s, r: 5 })) };
    expect(suggestFor([bench("2026-10-08", 280, [5, 5, 5])], edited, { smallestJump: 5 })!.range).toEqual({ low: 3, high: 5 });
  });
});

// ---------------------------------------------------------------------------
// THE BRIEF'S REMAINING RULES (2026-10-17, Progressive Overload Design v2,
// sections 1, 3, 4 and 5), each a pure rule here and a fact on the Why row.
// Weeks are Monday to Sunday: 2026-10-10 is a Saturday, so 10-05 to 10-11 is
// "this week" when today is 10-10, 09-28 to 10-04 "last week", 09-21 to 09-27
// "the week before".
// ---------------------------------------------------------------------------

/** A whole workout on `date`: several lifts, each as [name, load, reps[], marks?]. */
const day = (date: string, lifts: [string, number, number[], ("clean" | "grind" | "missed" | undefined)[]?][]) =>
  wk(date, lifts.map(([name, w, reps, marks]) => wex(name, reps.map((r, i) => ({ w, r, ...(marks?.[i] ? { moved: marks[i] } : {}) })))), "full");
/** A seasoned lifter: twelve Bench sessions in May and June, all inside the range, then a lighter one on 10-03 so the
 *  accumulation count (rule 4) starts over. */
const seasonedBench = () => [
  ...Array.from({ length: 12 }, (_, i) => bench(`2026-0${i < 9 ? 5 : 6}-${String(i < 9 ? i * 3 + 1 : (i - 9) * 3 + 2).padStart(2, "0")}`, 255, [8, 8, 8])),
  bench("2026-10-03", 225, [8, 8]),
];

describe("rule 5: sets are a block-level variable", () => {
  it("one more set is offered only after a week of this lift with no misses, and the reason says recovery is his call", () => {
    const h = [bench("2026-10-03", 275, [8, 8, 7]), bench("2026-10-10", 275, [8, 8, 8], [undefined, undefined, "missed"])];
    const s = suggestFor(h, plan())!;
    expect(s.addSet).toBe(true);
    expect(s.addSetWhy).toEqual(["No Misses Last Week", "Only If You Feel Recovered"]);
  });

  it("a miss last week, by reps or by his mark, withholds it", () => {
    const byReps = [bench("2026-10-03", 275, [8, 5, 5]), bench("2026-10-10", 275, [8, 8, 8], [undefined, undefined, "missed"])];
    expect(suggestFor(byReps, plan())!.addSet).toBeUndefined();
    const byMark = [bench("2026-10-03", 275, [8, 8, 7], [undefined, undefined, "missed"]), bench("2026-10-10", 275, [8, 8, 8], [undefined, undefined, "missed"])];
    expect(suggestFor(byMark, plan())!.addSet).toBeUndefined();
  });

  it("at most one set a week: a session this week already up a set takes the offer with it", () => {
    const h = [bench("2026-10-03", 275, [8, 8, 7]), bench("2026-10-08", 275, [8, 8, 8, 8]), bench("2026-10-10", 275, [8, 8, 8], [undefined, undefined, "missed"])];
    const s = suggestFor(h, plan({ sets: [{ id: "p1", w: 275, r: 6 }, { id: "p2", w: 275, r: 8 }, { id: "p3", w: 275, r: 8 }, { id: "p4", w: 275, r: 8 }] }))!;
    expect(s.kind).toBe("hold");
    expect(s.addSet).toBeUndefined();
  });

  it("never beside a load step", () => {
    const h = [bench("2026-10-03", 275, [8, 8, 8]), bench("2026-10-10", 275, [8, 8, 8])];
    const s = suggestFor(h, plan(), { smallestJump: 5 })!;
    expect(s.kind).toBe("bump");
    expect(s.addSet).toBeUndefined();
  });

  it("counts weeks from the session's own date when it is given", () => {
    const h = [bench("2026-10-03", 275, [8, 8, 7]), bench("2026-10-10", 275, [8, 8, 8], [undefined, undefined, "missed"])];
    // Read on 10-13: last week is 10-05 to 10-11, whose one session carries his missed mark.
    expect(suggestFor(h, plan(), { today: "2026-10-13" })!.addSet).toBeUndefined();
    expect(suggestFor(h, plan(), { today: "2026-10-10" })!.addSet).toBe(true);
  });
});

describe("rule 4: last week's own picture asks for a lighter week early", () => {
  const p = plan();
  const full = (date: string) => day(date, [["Bench", 275, [8, 8, 8]], ["Squat", 315, [8, 8, 8]], ["Row", 185, [10, 10, 10]], ["Press", 135, [8, 8, 8]], ["Curl", 30, [12, 12]]]);

  it("two in five of last week's lifts missed: every suggestion this week is a lighter one, and says so", () => {
    // Last week (09-28 to 10-04): Squat and Row lost two or more reps at the same load as the week before; Bench lost one, a flat day.
    const h = [full("2026-09-26"), day("2026-10-03", [["Bench", 275, [8, 8, 7]], ["Squat", 315, [8, 6, 5]], ["Row", 185, [10, 8, 7]], ["Press", 135, [8, 8, 8]], ["Curl", 30, [12, 12]]])];
    const s = suggestFor(h, p, { smallestJump: 5, today: "2026-10-06" })!;
    expect(s.kind).toBe("lighter");
    expect(s.reason).toEqual(["Last Time 275 × 8, 8, 7", "2 of 5 Lifts Missed Last Week", "Lighter Week 245 × 6, 2 Sets, Nothing to Failure"]);
    expect(s.sets).toBe(2);
    // Another lift read the same week carries the same trigger, and so does a later day of the week.
    const squat = suggestFor(h, plan({ name: "Squat", sets: [{ id: "q1", w: 315, r: 6 }, { id: "q2", w: 315, r: 8 }, { id: "q3", w: 315, r: 8 }] }), { smallestJump: 5, today: "2026-10-09" })!;
    expect(squat.kind).toBe("lighter");
    expect(squat.reason[1]).toBe("2 of 5 Lifts Missed Last Week");
    // Without today, the latest workout's own week is "this week", so the picture is of the week before it.
    expect(suggestFor(h, p, { smallestJump: 5 })!.kind).toBe("hold");
  });

  it("a mark of missed counts as a miss for a lift the plan is not read for", () => {
    const three = (date: string, marks: ("missed" | undefined)[][] = []) => day(date, [["Bench", 275, [8, 8, 8]], ["Squat", 315, [8, 8, 8], marks[0]], ["Row", 185, [10, 10, 10], marks[1]]]);
    const one = [three("2026-09-26"), three("2026-10-03", [[undefined, undefined, "missed"]])];
    expect(suggestFor(one, p, { smallestJump: 5, today: "2026-10-06" })!.kind, "one of three is under two in five").toBe("bump");
    const two = [three("2026-09-26"), three("2026-10-03", [[undefined, undefined, "missed"], ["missed"]])];
    expect(suggestFor(two, p, { smallestJump: 5, today: "2026-10-06" })!.reason[1]).toBe("2 of 3 Lifts Missed Last Week");
  });

  it("tonnage down a tenth on the week before, with as many sessions, is the other trigger", () => {
    const h = [full("2026-09-26"), day("2026-10-03", [["Bench", 275, [8, 8, 8]], ["Squat", 205, [8, 8, 8]], ["Row", 185, [10, 10, 10]], ["Press", 135, [8, 8, 8]], ["Curl", 30, [12, 12]]])];
    const s = suggestFor(h, p, { smallestJump: 5, today: "2026-10-06" })!;
    expect(s.kind).toBe("lighter");
    expect(s.reason[1]).toBe("Tonnage Down 11% Last Week");
  });

  it("fewer workouts is not a lighter week, and a drop after a drop does not ask twice", () => {
    const lighter = (date: string) => day(date, [["Bench", 245, [6, 6]], ["Squat", 285, [6, 6]], ["Row", 165, [8, 8]], ["Press", 120, [6, 6]], ["Curl", 25, [10]]]);
    // The week before had two workouts, last week one: the comparison is of training done, not fatigue.
    const fewer = [full("2026-09-22"), full("2026-09-25"), full("2026-10-02")];
    expect(suggestFor(fewer, p, { smallestJump: 5, today: "2026-10-06" })!.kind).toBe("bump");
    // A lighter week after a drop: the drop asked for it, so it is not asked for again.
    const twice = [full("2026-09-19"), day("2026-09-26", [["Bench", 275, [8, 8, 8]], ["Squat", 205, [8, 8, 8]], ["Row", 185, [10, 10, 10]], ["Press", 135, [8, 8, 8]], ["Curl", 30, [12, 12]]]), lighter("2026-10-03")];
    expect(suggestFor(twice, p, { smallestJump: 5, today: "2026-10-06" })!.kind).not.toBe("lighter");
  });

  it("a week of one or two lifts is those lifts' own story: rules 1 to 3 speak, the week does not", () => {
    const h = [bench("2026-09-26", 275, [8, 8, 8]), bench("2026-10-03", 275, [6, 5, 4])];
    const s = suggestFor(h, p, { today: "2026-10-06" })!;
    expect(s.kind).toBe("hold");
    expect(s.reason[1]).toBe("Under 6 Once");
  });

  it("the program's back-off flag outranks the week's picture in the reason", () => {
    const h = [full("2026-09-26"), day("2026-10-03", [["Bench", 275, [8, 8, 8]], ["Squat", 205, [8, 8, 8]], ["Row", 185, [10, 10, 10]], ["Press", 135, [8, 8, 8]], ["Curl", 30, [12, 12]]])];
    expect(suggestFor(h, p, { smallestJump: 5, backOffWeek: true, today: "2026-10-06" })!.reason[1]).toBe("Back-Off Week");
  });

  it("weekPicture and weekTrigger are pure and read every workout", () => {
    expect(weekPicture([])).toBeNull();
    expect(weekTrigger(null)).toBeNull();
    const h = [full("2026-09-26"), day("2026-10-03", [["Bench", 275, [8, 8, 8]], ["Squat", 205, [8, 8, 8]], ["Row", 185, [10, 10, 10]], ["Press", 135, [8, 8, 8]], ["Curl", 30, [12, 12]]])];
    const pic = weekPicture(h, undefined, "2026-10-06")!;
    expect(pic).toMatchObject({ lifts: 5, missed: 0, sessions: 1, sessionsPrior: 1, tonnagePrior2: 0 });
    expect(pic.tonnage).toBe(275 * 24 + 205 * 24 + 185 * 30 + 135 * 24 + 30 * 24);
    expect(pic.tonnagePrior).toBe(275 * 24 + 315 * 24 + 185 * 30 + 135 * 24 + 30 * 24);
  });
});

describe("rule 2, Each Set on Its Own (overloadTargets)", () => {
  const p = plan();
  it("a position at the top steps for that position only; the rest hold and add reps", () => {
    const h = [...seasonedBench(), bench("2026-10-10", 275, [8, 8, 6])];
    const s = suggestFor(h, p, { smallestJump: 5, targets: "perSet" })!;
    expect(s.kind).toBe("bump");
    expect(s.perSet).toEqual([{ w: 280, r: 6 }, { w: 280, r: 6 }, { w: 275, r: 8 }]);
    expect(s.next).toEqual({ w: 280, r: 6 });
    expect(s.reason).toEqual(["Last Time 275 × 8, 8, 6", "Sets 1 and 2 at the Top of 6 to 8", "Step Sets 1 and 2 to 280 × 6, Hold the Rest at 275"]);
    expect(s.expect).toBe("Expect 6 to 7");
    // applySuggestion writes each working position its own target.
    const out = applySuggestion(p, s);
    expect(out.sets.map((x) => [x.w, x.r])).toEqual([[280, 6], [280, 6], [275, 8]]);
  });

  it("the default, every set at the top, is unchanged: the same log holds", () => {
    const h = [...seasonedBench(), bench("2026-10-10", 275, [8, 8, 6])];
    const s = suggestFor(h, p, { smallestJump: 5 })!;
    expect(s.kind).toBe("hold");
    expect(s.perSet).toBeUndefined();
  });

  it("a beginner is read all-sets whatever the setting says", () => {
    const s = suggestFor([bench("2026-10-10", 275, [8, 8, 6])], p, { smallestJump: 5, targets: "perSet" })!;
    expect(s.kind).toBe("hold");
    expect(s.perSet).toBeUndefined();
  });

  it("all at the top is still the ordinary step, and a miss is still a strike", () => {
    const h = [...seasonedBench(), bench("2026-10-10", 275, [8, 8, 8])];
    expect(suggestFor(h, p, { smallestJump: 5, targets: "perSet" })!.perSet).toBeUndefined();
    const m = [...seasonedBench(), bench("2026-10-10", 275, [8, 5, 5])];
    expect(suggestFor(m, p, { smallestJump: 5, targets: "perSet" })!.reason[1]).toBe("Under 6 Once");
  });
});

describe("rule 7: inside a session, set one decides the rest", () => {
  const p = plan({ sets: [{ id: "p1", w: 275, r: 8 }, { id: "p2", w: 275, r: 8 }, { id: "p3", w: 275, r: 8 }] });
  const set = (over: Partial<SetEntry>): SetEntry => ({ id: "l1", w: 275, r: 8, ...over });

  it("two or more reps short of the target drops the rest 5 percent, to the jump, at least one jump", () => {
    const s = inSessionAdjust([], p, [set({ r: 6 })], { smallestJump: 5 })!;
    expect(s.kind).toBe("drop");
    expect(s.next).toEqual({ w: 260, r: 8 });
    expect(s.reason).toEqual(["Set 1 275 × 6", "2 Reps Short of 8", "Drop to 260 × 8 for the Rest"]);
    expect(s.basis!.source).toBe("Set 1 of Today");
    expect(inSessionAdjust([], p, [set({ w: 100, r: 6 })], { smallestJump: 5 })!.next.w).toBe(95);
  });

  it("a set marked hard drops the rest too, whatever the reps", () => {
    const s = inSessionAdjust([], p, [set({ r: 8, moved: "missed" })], { smallestJump: 5 })!;
    expect(s.kind).toBe("drop");
    expect(s.reason[1]).toBe("Marked Hard");
  });

  it("one rep short, or on target, is nothing: no adjustment", () => {
    expect(inSessionAdjust([], p, [set({ r: 7 })])).toBeNull();
    expect(inSessionAdjust([], p, [set({ r: 8 })])).toBeNull();
    expect(inSessionAdjust([], p, [set({ r: 8, moved: "grind" })])).toBeNull();
  });

  it("set one at the top and marked easy offers 2.5 percent more for the rest, never under twelve sessions", () => {
    const easy = [set({ r: 8, moved: "clean" })];
    expect(inSessionAdjust([], p, easy, { smallestJump: 5 }), "a beginner never sees the upward offer").toBeNull();
    const s = inSessionAdjust(seasonedBench(), p, easy, { smallestJump: 5 })!;
    expect(s.kind).toBe("up");
    expect(s.next).toEqual({ w: 280, r: 8 });
    expect(s.reason).toEqual(["Set 1 275 × 8", "Top of 6 to 8, Marked Easy", "Try 280 × 8 for the Rest"]);
    // Easy but under the top: nothing.
    expect(inSessionAdjust(seasonedBench(), p, [set({ r: 7, moved: "clean" })], { smallestJump: 5 })).toBeNull();
  });

  it("reads the first WORKING set, never a warm-up, and is silent in Manual, on a timed lift, or before set one", () => {
    expect(inSessionAdjust([], p, [set({ w: 135, r: 10, warmup: true }), set({ r: 5 })], { smallestJump: 5 })!.reason[0]).toBe("Set 1 275 × 5");
    expect(inSessionAdjust([], p, [set({ r: 5 })], { mode: "manual" })).toBeNull();
    expect(inSessionAdjust([], p, [])).toBeNull();
    const timed = plan({ kind: "time_longer", unit: "sec", sets: [{ id: "t1", v: 60 }] });
    expect(inSessionAdjust([], timed, [{ id: "l1", v: 40 }])).toBeNull();
  });
});

// PREFILL, AND THE APP NEVER ARGUES TWICE (Dave, 2026-10-17). A step he
// changed when it was filled in is remembered on the set he logged instead.
describe("never argues twice", () => {
  const p = plan();
  it("the same step he turned down last session comes back flagged declined", () => {
    const h = [wk("2026-10-10", [wex("Bench", [{ w: 275, r: 8, declined: { w: 280, r: 6 } }, { w: 275, r: 8 }, { w: 275, r: 8 }])])];
    const s = suggestFor(h, p, { smallestJump: 5 })!;
    expect(s.next).toEqual({ w: 280, r: 6 });
    expect(s.declined).toBe(true);
  });

  it("a different step is not the one he turned down", () => {
    const h = [wk("2026-10-10", [wex("Bench", [{ w: 280, r: 8, declined: { w: 285, r: 6 } }, { w: 280, r: 8 }, { w: 280, r: 8 }])]),
      wk("2026-10-14", [wex("Bench", [{ w: 285, r: 8 }, { w: 285, r: 8 }, { w: 285, r: 8 }])])];
    expect(suggestFor(h, p, { smallestJump: 5 })!.declined).toBeUndefined();
  });

  it("set one logged instead of a filled-in step gets no 'a little more' on top of it", () => {
    const easy = { id: "l1", w: 275, r: 8, moved: "clean" as const };
    expect(inSessionAdjust(seasonedBench(), p, [easy], { smallestJump: 5 })!.kind).toBe("up");
    expect(inSessionAdjust(seasonedBench(), p, [{ ...easy, declined: { w: 280, r: 6 } }], { smallestJump: 5 })).toBeNull();
  });
});
