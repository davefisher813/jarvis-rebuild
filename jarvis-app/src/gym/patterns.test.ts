import { describe, it, expect } from "vitest";
import type { Program, ProgramDay, Workout, WorkoutData, WorkoutExercise } from "./types";
import { appendWorkoutToDay, dayFromWorkout, isScratch, PATTERN_MIN, similarity, suggestProgram, workoutKeys, workoutOnDay } from "./patterns";
import { readClassStore } from "./classify";
import { SCRATCH_DAY_ID, SCRATCH_DAY_NAME } from "./nextDay";

// THE PROGRAM EMERGES FROM WHAT HE DOES (Dave 2026-10-09, item 4). The rule
// for the opt-in suggestion, and the two ways a finished workout joins a
// program, held to what gym/patterns.ts says they do.

let seq = 0;
const mint = (p: string) => `${p}${++seq}`;
const ex = (name: string, key: string, sets: WorkoutExercise["sets"] = [{ id: "s", w: 100, r: 5 }], extra: Partial<WorkoutExercise> = {}): WorkoutExercise =>
  ({ exerciseId: "x" + key, name, kind: "weight_reps", unit: "lb", exerciseKey: key, sets, ...extra });
const PUSH = [ex("Bench Press", "k-bench"), ex("Overhead Press", "k-ohp"), ex("Dips", "k-dips")];
const scratch = (date: string, exercises: WorkoutExercise[], startedAt = new Date(date + "T08:00:00").getTime()): WorkoutData =>
  ({ programId: "", dayId: SCRATCH_DAY_ID, dayName: SCRATCH_DAY_NAME, date, startedAt, endedAt: startedAt + 3_000_000, exercises });
const saved = (d: WorkoutData, id: string): Workout => ({ id, data: d });
const STORE = readClassStore({
  "k-bench": { primary: ["chest"], secondary: ["triceps"], tags: [] },
  "k-ohp": { primary: ["shoulders"], secondary: [], tags: [] },
  "k-dips": { primary: ["triceps"], secondary: [], tags: [] },
}, undefined);

describe("what counts as the same workout", () => {
  it("is the logged exercises, by library identity, over the larger list", () => {
    expect(workoutKeys([...PUSH, ex("Curl", "k-curl", [{ id: "s", skipped: true }])])).toEqual(["k-bench", "k-ohp", "k-dips"]);
    expect(similarity(["a", "b", "c"], ["a", "b", "c"])).toBe(1);
    expect(similarity(["a", "b", "c"], ["a", "b", "x", "y"])).toBe(0.5);
    expect(similarity([], ["a"])).toBe(0);
  });

  it("a scratch workout is one with no program day", () => {
    expect(isScratch({ programId: "", dayId: SCRATCH_DAY_ID })).toBe(true);
    expect(isScratch({ programId: "p1", dayId: SCRATCH_DAY_ID })).toBe(true);
    expect(isScratch({ programId: "p1", dayId: "d1" })).toBe(false);
  });
});

describe("the Program Suggestion fires on the third similar workout from scratch, and only then", () => {
  const today = scratch("2026-10-10", PUSH);
  const two = [saved(scratch("2026-10-03", PUSH), "w1"), saved(scratch("2026-10-06", PUSH.slice(0, 2).concat(ex("Flys", "k-fly"))), "w2")];

  it(`needs ${PATTERN_MIN}, counting this one`, () => {
    expect(suggestProgram(today, two.slice(0, 1), { store: STORE, programs: [] })).toBeNull();
    const s = suggestProgram(today, two, { store: STORE, programs: [] })!;
    expect(s.count).toBe(3);
    expect(s.name).toBe("Push Day");
    expect(s.title).toBe("Looks Like a Push Day");
    expect(s.muscles).toEqual(["chest", "shoulders", "triceps"]);
  });

  it("counts only similar workouts from scratch inside the window", () => {
    const old = [saved(scratch("2026-07-01", PUSH), "o1"), saved(scratch("2026-07-02", PUSH), "o2")];
    expect(suggestProgram(today, old, { store: STORE, programs: [] })).toBeNull();
    const legs = [saved(scratch("2026-10-03", [ex("Squat", "k-sq"), ex("Leg Curl", "k-lc")]), "l1"), two[0]!];
    expect(suggestProgram(today, legs, { store: STORE, programs: [] })).toBeNull();
    const onDay = [saved({ ...scratch("2026-10-03", PUSH), programId: "p1", dayId: "d1" }, "p"), two[0]!];
    expect(suggestProgram(today, onDay, { store: STORE, programs: [] })).toBeNull();
  });

  it("stays quiet once a program day holds that workout, or after Not Now", () => {
    const day: ProgramDay = { id: "d1", name: "Push", exercises: PUSH.map((e, i) => ({ id: "e" + i, name: e.name, kind: e.kind, exerciseKey: e.exerciseKey, sets: [] })) };
    const program: Program = { id: "p1", data: { name: "Block", weeks: [{ id: "w1", label: "Week 1", days: [day] }] } };
    expect(suggestProgram(today, two, { store: STORE, programs: [program] })).toBeNull();
    const s = suggestProgram(today, two, { store: STORE, programs: [] })!;
    expect(suggestProgram(today, two, { store: STORE, programs: [], declined: [s.signature] })).toBeNull();
  });

  it("never fires for a program day's workout or a one-exercise workout", () => {
    expect(suggestProgram({ ...today, programId: "p1", dayId: "d1" }, two, { store: STORE, programs: [] })).toBeNull();
    const one = [ex("Run", "k-run")];
    expect(suggestProgram(scratch("2026-10-10", one), [saved(scratch("2026-10-01", one), "a"), saved(scratch("2026-10-02", one), "b")], { store: STORE, programs: [] })).toBeNull();
  });

  it("names it only from muscles he classified, else from his own name for it, else My Routine", () => {
    const noMuscles = suggestProgram(today, two, { store: {}, programs: [] })!;
    expect(noMuscles.name).toBe("My Routine");
    expect(noMuscles.title).toBe("Looks Like a Routine");
    expect(noMuscles.muscles).toEqual([]);
    const named = [saved({ ...scratch("2026-10-03", PUSH), dayName: "Upper" }, "n1"), saved({ ...scratch("2026-10-05", PUSH), dayName: "Upper" }, "n2")];
    expect(suggestProgram(today, named, { store: {}, programs: [] })!.name).toBe("Upper");
  });
});

describe("a finished workout becomes a program day, or joins one", () => {
  const done = scratch("2026-10-10", [
    ex("Bench Press", "k-bench", [{ id: "a", w: 95, r: 10, warmup: true }, { id: "b", w: 185, r: 5, at: 1, moved: "clean" }, { id: "c", w: 185, r: 5 }], { equipment: "barbell" }),
    ex("Dips", "k-dips", [{ id: "d", r: 12 }]),
    ex("Curl", "k-curl", [{ id: "e", skipped: true }]),
  ]);

  it("makes a day of what he logged: working sets as the plan, numbers only, equipment kept, skipped exercises left out", () => {
    const day = dayFromWorkout(done, "Push Day", mint);
    expect(day.name).toBe("Push Day");
    expect(day.exercises.map((e) => e.name)).toEqual(["Bench Press", "Dips"]);
    const bench = day.exercises[0]!;
    expect(bench.exerciseKey).toBe("k-bench");
    expect(bench.equipment).toBe("barbell");
    expect(bench.sets.map((s) => [s.w, s.r])).toEqual([[185, 5], [185, 5]]);
    expect(bench.sets.some((s) => "at" in s || "moved" in s)).toBe(false);
  });

  it("adds each exercise once to a day that already has some of them", () => {
    const day: ProgramDay = { id: "d1", name: "Push", exercises: [{ id: "e1", name: "Bench Press", kind: "weight_reps", exerciseKey: "k-bench", sets: [] }] };
    const next = appendWorkoutToDay(day, done, mint);
    expect(next.exercises.map((e) => e.name)).toEqual(["Bench Press", "Dips"]);
    expect(next.exercises[0]!.id).toBe("e1");
  });

  it("points the workout at the day, exercise by exercise, so the day's history reads it", () => {
    const day = dayFromWorkout(done, "Push Day", mint);
    const w = workoutOnDay(done, "p9", day);
    expect(w.programId).toBe("p9");
    expect(w.dayId).toBe(day.id);
    expect(w.dayName).toBe("Push Day");
    expect(w.exercises[0]!.exerciseId).toBe(day.exercises[0]!.id);
    expect(w.exercises[1]!.exerciseId).toBe(day.exercises[1]!.id);
    // The record itself is untouched: same sets, same skipped exercise.
    expect(w.exercises[0]!.sets).toEqual(done.exercises[0]!.sets);
    expect(w.exercises[2]!.exerciseId).toBe(done.exercises[2]!.exerciseId);
  });
});
