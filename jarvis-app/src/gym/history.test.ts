import { describe, it, expect } from "vitest";
import { exerciseHistory, trendLine, doneCount, movedFact } from "./history";
import type { Workout, WorkoutExercise, MeasureKind, SetLog } from "./types";

const wk = (date: string, exercises: WorkoutExercise[]): Workout =>
  ({ id: date, data: { programId: "p", dayId: "d", dayName: "Day", date, startedAt: 0, endedAt: 0, exercises } });
// The logged strip is SetEntry[] (each chip carries an id); test fixtures
// still write plain SetLog literals and this stamps an id on the way in.
const wex = (name: string, kind: MeasureKind, sets: SetLog[], unit?: string): WorkoutExercise =>
  ({ exerciseId: "x", name, kind, unit, sets: sets.map((s, i) => ({ id: `s${i}`, ...s })) });

describe("exerciseHistory", () => {
  const workouts = [
    wk("2026-06-09", [wex("Bench", "weight_reps", [{ w: 115, r: 8 }, { w: 115, r: 7 }], "lb")]),
    wk("2026-07-01", [wex("Bench", "weight_reps", [{ w: 125, r: 8 }], "lb"), wex("Stretching", "done", [{}])]),
    wk("2026-08-04", [wex("Bench", "weight_reps", [{ w: 135, r: 8 }], "lb"), wex("40 Yard Dash", "time_faster", [{ v: 4.71 }], "sec")]),
  ];

  it("one row per exercise, most recently trained first, tracking first/best/last", () => {
    const rows = exerciseHistory(workouts);
    expect(rows.map((r) => r.name)).toEqual(["Bench", "40 Yard Dash"]); // Done leaves no numbers
    const bench = rows[0]!;
    expect(bench.sessions).toBe(3);
    expect(bench.first.set).toMatchObject({ w: 115, r: 8 });
    expect(bench.best.set).toMatchObject({ w: 135, r: 8 });
    expect(bench.entries.map((e) => e.date)).toEqual(["2026-08-04", "2026-07-01", "2026-06-09"]);
  });

  it("trendLine tells the honest story in the exercise's own units", () => {
    const rows = exerciseHistory(workouts);
    expect(trendLine(rows[0]!)).toBe("115 lb × 8 → 135 lb × 8 over 8 weeks");
    expect(trendLine(rows[1]!)).toBe("4.71 sec"); // one session: just the fact
  });

  it("a slide is stated as numbers, never as decline language", () => {
    const slid = exerciseHistory([
      wk("2026-07-01", [wex("Squat", "weight_reps", [{ w: 185, r: 5 }], "lb")]),
      wk("2026-07-20", [wex("Squat", "weight_reps", [{ w: 155, r: 5 }], "lb")]),
    ]);
    const line = trendLine(slid[0]!);
    expect(line).toBe("185 lb × 5 → 155 lb × 5 over 3 weeks");
    expect(line.toLowerCase()).not.toMatch(/lost|down|decline|worse/);
    expect(slid[0]!.best.set).toMatchObject({ w: 185, r: 5 }); // the best is still the best
  });
});

describe("doneCount: the `done` blind spot fix (catalog §4.8)", () => {
  const wex2 = (name: string, kind: MeasureKind, sets: SetLog[]): WorkoutExercise =>
    ({ exerciseId: "x", name, kind, sets: sets.map((s, i) => ({ id: `s${i}`, ...s })) });

  it("counts logged done-kind entries by name, across sessions", () => {
    const workouts = [
      wk("2026-07-01", [wex2("Cuff Work", "done", [{ done: true }])]),
      wk("2026-07-08", [wex2("Cuff Work", "done", [{ done: true }])]),
      wk("2026-07-15", [wex2("Cuff Work", "done", [{ skipped: true }])]),
    ];
    expect(doneCount(workouts, "Cuff Work")).toBe(2);
  });

  it("a skipped exercise never counts", () => {
    const workouts = [wk("2026-07-01", [{ ...wex2("Cuff Work", "done", [{ done: true }]), skipped: true }])];
    expect(doneCount(workouts, "Cuff Work")).toBe(0);
  });

  it("a name never logged returns zero, not undefined", () => {
    expect(doneCount([], "Cuff Work")).toBe(0);
  });
});

describe("movedFact: how it moved, as a fact (catalog §4.5)", () => {
  const wex3 = (sets: (SetLog & { moved?: "clean" | "grind" | "missed" })[]): WorkoutExercise =>
    ({ exerciseId: "x", name: "Bench", kind: "weight_reps", sets: sets.map((s, i) => ({ id: `s${i}`, ...s })) });

  it("returns null when nothing was ever marked", () => {
    const workouts = [wk("2026-07-01", [wex3([{ w: 135, r: 8 }])])];
    expect(movedFact(workouts, "Bench")).toBeNull();
  });

  it("counts a grind as a fact, never a percentage or a prescription", () => {
    const workouts = [wk("2026-07-01", [wex3([
      { w: 135, r: 8, moved: "clean" },
      { w: 135, r: 8, moved: "grind" },
      { w: 135, r: 6, moved: "missed" },
    ])])];
    const fact = movedFact(workouts, "Bench");
    expect(fact).toContain("grind");
    expect(fact).toContain("missed");
    expect(fact).not.toMatch(/%/);
  });

  it("all clean reads as a plain fact", () => {
    const workouts = [wk("2026-07-01", [wex3([{ w: 135, r: 8, moved: "clean" }])])];
    expect(movedFact(workouts, "Bench")).toBe("All clean across the last 1 marked sets");
  });
});
