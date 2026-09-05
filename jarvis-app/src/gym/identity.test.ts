import { describe, expect, it } from "vitest";
import { sameLift, sameLiftAnyKind, liftRef } from "./identity";
import { bestBefore, isPR, lastHeader, lastSessionFor } from "./prs";
import { exerciseHistory } from "./history";
import { liftSessions, chartableExercises } from "./chartData";
import { suggestFor } from "./progression";
import { paceFor } from "./pacing";
import { liftMeasureState, trainingMeasureState, type LiftMeasure, type TrainingMeasure } from "./goalMeasures";
import type { Exercise, SetEntry, Workout, WorkoutExercise } from "./types";

// GYM-F-04 (2026-09-05, fork option A). The library mints a stable
// exerciseKey so a rename keeps one history; every derivation ignored it and
// matched by name. Clean up "Trap bar DL" to "Trap Bar Deadlift" and the
// header lost its Last line, the first set wore a "First time" PR pill,
// History showed two rows, the chart restarted, the goal stopped seeing the
// sets, and the suggestion engine had nothing to say.

const KEY = "ekTrap";
let n = 0;
const set = (over: Partial<SetEntry> = {}): SetEntry => ({ id: `s${n++}`, ...over });
const wo = (date: string, exercises: WorkoutExercise[]): Workout =>
  ({ id: `w${n++}`, data: { programId: "p", dayId: "d", dayName: "Pull", date, startedAt: 0, endedAt: 1, exercises } });
const entry = (name: string, sets: SetEntry[], over: Partial<WorkoutExercise> = {}): WorkoutExercise =>
  ({ exerciseId: "e1", name, kind: "weight_reps", unit: "lb", exerciseKey: KEY, sets, ...over });

/** Two sessions under the OLD name, both carrying the library key. */
const before: Workout[] = [
  wo("2026-08-01", [entry("Trap bar DL", [set({ w: 315, r: 5, at: 1_000 }), set({ w: 315, r: 5, at: 121_000, moved: "clean" })])]),
  wo("2026-08-08", [entry("Trap bar DL", [set({ w: 335, r: 5, at: 1_000 }), set({ w: 335, r: 5, at: 121_000, moved: "clean" })])]),
];
/** The same lift, renamed in the program. */
const renamed: Exercise = { id: "e1", name: "Trap Bar Deadlift", kind: "weight_reps", unit: "lb", exerciseKey: KEY, sets: [set({ w: 335, r: 5 })] };

describe("sameLift", () => {
  it("the key settles it when both sides have one", () => {
    expect(sameLift(liftRef(renamed, "weight_reps"), entry("Trap bar DL", []))).toBe(true);
    expect(sameLift(liftRef(renamed, "weight_reps"), entry("Trap bar DL", [], { exerciseKey: "ekOther" }))).toBe(false);
  });

  it("falls back to the name when either side has no key, exactly as before the library", () => {
    expect(sameLift(liftRef("Bench", "weight_reps"), { name: "Bench", kind: "weight_reps" })).toBe(true);
    expect(sameLift(liftRef("Bench", "weight_reps"), { name: "Bench Press", kind: "weight_reps" })).toBe(false);
    // A keyed side against an unkeyed legacy row still matches by name.
    expect(sameLift(liftRef(renamed, "weight_reps"), { name: "Trap Bar Deadlift", kind: "weight_reps" })).toBe(true);
  });

  it("a kind change is still fresh history, key or no key", () => {
    expect(sameLift(liftRef(renamed, "weight_reps"), entry("Trap bar DL", [], { kind: "reps" }))).toBe(false);
    expect(sameLiftAnyKind(renamed, entry("Trap bar DL", [], { kind: "reps" }))).toBe(true);
  });
});

describe("a rename keeps one history", () => {
  it("Last and the header still find the lift", () => {
    expect(lastSessionFor(before, renamed, "weight_reps")).not.toBeNull();
    expect(lastHeader(before, renamed, "weight_reps")!.last).toContain("335");
    // The pre-fix behaviour, still available to a caller with only a name.
    expect(lastSessionFor(before, "Trap Bar Deadlift", "weight_reps")).toBeNull();
  });

  it("the first set after a rename is not a PR", () => {
    expect(bestBefore(before, renamed, "weight_reps")!.set.w).toBe(335);
    expect(isPR(before, renamed, "weight_reps", { w: 300, r: 5 })).toBe(false);
    expect(isPR(before, renamed, "weight_reps", { w: 400, r: 5 })).toBe(true);
  });

  it("History shows one row, wearing the newest name", () => {
    const after = [...before, wo("2026-08-15", [entry("Trap Bar Deadlift", [set({ w: 345, r: 5 })])])];
    const rows = exerciseHistory(after);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("Trap Bar Deadlift");
    expect(rows[0]!.sessions).toBe(3);
    expect(rows[0]!.exerciseKey).toBe(KEY);
  });

  it("the chart keeps its whole series, and the lift is one chartable entry", () => {
    const after = [...before, wo("2026-08-15", [entry("Trap Bar Deadlift", [set({ w: 345, r: 5 })])])];
    expect(liftSessions(after, renamed, "weight_reps")).toHaveLength(3);
    const chartable = chartableExercises(after);
    expect(chartable).toHaveLength(1);
    expect(chartable[0]!.name).toBe("Trap Bar Deadlift");
  });

  it("the suggestion engine still has last session's marks to read", () => {
    expect(suggestFor(before, renamed)).not.toBeNull();
  });

  it("learned pace follows the lift instead of falling back to the default model", () => {
    const many = [before[0]!, before[1]!, wo("2026-08-15", [entry("Trap bar DL", [set({ w: 345, r: 5, at: 1_000 }), set({ w: 345, r: 5, at: 121_000 })])])];
    expect(paceFor(many, renamed).learned).toBe(true);
    expect(paceFor(many, { name: "Trap Bar Deadlift", kind: "weight_reps" }).learned).toBe(false);
  });

  it("a lift goal set before the rename still sees the sets", () => {
    const m: LiftMeasure = { kind: "lift", exercise: "Trap bar DL", exerciseKey: KEY, measureKind: "weight_reps", target: { w: 315, r: 5 }, unit: "lb" };
    const after = [...before, wo("2026-08-15", [entry("Trap Bar Deadlift", [set({ w: 345, r: 5 })])])];
    expect(liftMeasureState(m, after).met).toBe(true);
    expect(liftMeasureState(m, after).done).toBe(345);
  });

  it("a training goal scoped to the lift counts the renamed sessions", () => {
    const m: TrainingMeasure = { kind: "training", per: "block", times: 3, since: "2026-08-01", exercise: "Trap bar DL", exerciseKey: KEY };
    const after = [...before, wo("2026-08-15", [entry("Trap Bar Deadlift", [set({ w: 345, r: 5 })])])];
    expect(trainingMeasureState(m, after, new Date("2026-08-20").getTime()).done).toBe(3);
  });
});

describe("legacy rows, with no key at all, behave exactly as they always did", () => {
  const legacy: Workout[] = [
    wo("2026-08-01", [entry("Bench", [set({ w: 225, r: 5 })], { exerciseKey: undefined })]),
    wo("2026-08-08", [entry("Bench", [set({ w: 235, r: 5 })], { exerciseKey: undefined })]),
  ];

  it("name matching still finds them", () => {
    expect(liftSessions(legacy, "Bench", "weight_reps")).toHaveLength(2);
    expect(bestBefore(legacy, "Bench", "weight_reps")!.set.w).toBe(235);
  });

  it("a keyed exercise still matches its own unkeyed history by name, so nothing splits", () => {
    const keyed: Exercise = { id: "e9", name: "Bench", kind: "weight_reps", exerciseKey: "ekNew", sets: [] };
    expect(liftSessions(legacy, keyed, "weight_reps")).toHaveLength(2);
    expect(exerciseHistory([...legacy, wo("2026-08-15", [entry("Bench", [set({ w: 245, r: 5 })], { exerciseKey: "ekNew" })])])).toHaveLength(1);
  });
});
