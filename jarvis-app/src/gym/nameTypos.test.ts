import { describe, it, expect } from "vitest";
import { fixNameTypos, cleanExerciseName } from "./equipment";
import { planEquipmentCleanup, type CleanupInput } from "./equipmentCleanup";
import { buildLibrary } from "./library";
import { libraryRows } from "./libraryEdit";
import type { Program, Workout, WorkoutExercise } from "./types";

// PASS-OFF ITEM 6 (Dave 2026-10-09): "Tri Entension" reads "Tri Extension".
// No file in the repo spells it that way: it is a name Dave saved. So it is
// put right where a saved name is put right, the library's own rename door
// (the same once-per-visit cleanup that takes equipment out of names), which
// keeps the exercise's key so its history follows, and at the save door, so a
// new one never lands misspelled.

describe("fixNameTypos", () => {
  it("puts the misspelling right, in the case it was typed", () => {
    expect(fixNameTypos("Tri Entension")).toBe("Tri Extension");
    expect(fixNameTypos("tri entension")).toBe("tri extension");
    expect(fixNameTypos("TRI ENTENSION")).toBe("TRI EXTENSION");
    expect(fixNameTypos("Overhead Entensions")).toBe("Overhead Extensions");
  });

  it("never touches a correct name, or a word that only contains the letters", () => {
    for (const name of ["Tri Extension", "Leg Extension", "Bench Press", "Pretension Row", ""]) expect(fixNameTypos(name)).toBe(name);
  });

  it("runs before the equipment split, so both come off in one pass", () => {
    expect(cleanExerciseName("Tri Entension (Cable)")).toEqual({ name: "Tri Extension", equipment: "cable" });
    expect(cleanExerciseName("Tri Entension")).toEqual({ name: "Tri Extension" });
  });
});

let n = 0;
const we = (name: string, over: Partial<WorkoutExercise> = {}): WorkoutExercise =>
  ({ exerciseId: "x" + n++, name, kind: "weight_reps", unit: "lb", sets: [{ id: "s" + n++, w: 50, r: 12 }], ...over });
const workout = (id: string, date: string, exercises: WorkoutExercise[]): Workout =>
  ({ id, data: { programId: "p1", dayId: "d1", dayName: "Push", date, startedAt: Date.parse(date), endedAt: Date.parse(date) + 1, exercises } });
const program = (id: string, names: { name: string; exerciseKey?: string }[]): Program => ({
  id,
  data: { name: "Block", weeks: [{ id: "wk", label: "Week 1", days: [{ id: "d1", name: "Push",
    exercises: names.map((x, i) => ({ id: "pe" + i, kind: "weight_reps" as const, unit: "lb", sets: [], ...x })) }] }] },
} as Program);
const input = (over: Partial<CleanupInput>): CleanupInput => ({
  workouts: [], programs: [], createdLifts: [], store: {}, aliases: {}, favoriteKeys: [], hiddenKeys: [], dismissedDupes: [],
  goals: [], busy: () => false, ...over,
});

describe("the saved name is renamed through the library's door", () => {
  it("renames every sighting, keeps one history, files no equipment, and keeps the old spelling searchable", () => {
    const workouts = [
      workout("w1", "2026-09-01", [we("Tri Entension", { exerciseKey: "kt" })]),
      workout("w2", "2026-09-08", [we("Tri Entension", { exerciseKey: "kt" })]),
    ];
    const programs = [program("p1", [{ name: "Tri Entension", exerciseKey: "kt" }])];
    const plan = planEquipmentCleanup(input({ workouts, programs }))!;
    expect(plan.renames).toEqual([{ key: "kt", stampedKey: "kt", from: "Tri Entension", to: "Tri Extension" }]);
    const w = new Map(plan.patch.workouts.map((x) => [x.id, x.exercises] as const));
    const p = new Map(plan.patch.programs.map((x) => [x.id, x.weeks] as const));
    const afterW = workouts.map((x) => (w.has(x.id) ? { ...x, data: { ...x.data, exercises: w.get(x.id)! } } : x));
    const afterP = programs.map((x) => (p.has(x.id) ? { ...x, data: { ...x.data, weeks: p.get(x.id)! } } : x));
    const rows = libraryRows(buildLibrary(afterP, afterW), afterW);
    expect(rows.map((r) => r.name)).toEqual(["Tri Extension"]);
    expect(rows[0]!.sessions).toBe(2);
    expect(afterP[0]!.data.weeks[0]!.days[0]!.exercises[0]).toMatchObject({ name: "Tri Extension", exerciseKey: "kt" });
    expect(afterP[0]!.data.weeks[0]!.days[0]!.exercises[0]!.equipment).toBeUndefined();
    expect(plan.store.kt).toBeUndefined();
    expect(plan.aliases.kt).toEqual(["Tri Entension"]);
    // And once it is right there is nothing more to do.
    expect(planEquipmentCleanup(input({ workouts: afterW, programs: afterP, aliases: plan.aliases }))).toBeNull();
  });

  it("renames a seed that has not been done yet", () => {
    const plan = planEquipmentCleanup(input({ createdLifts: [{ key: "k9", name: "Tri Entension", kind: "weight_reps" }] }))!;
    expect(plan.createdLifts).toEqual([{ key: "k9", name: "Tri Extension", kind: "weight_reps" }]);
  });

  it("waits while the exercise is in the workout in progress", () => {
    const workouts = [workout("w1", "2026-09-01", [we("Tri Entension", { exerciseKey: "kt" })])];
    expect(planEquipmentCleanup(input({ workouts, busy: (r) => r.key === "kt" }))).toBeNull();
  });
});
