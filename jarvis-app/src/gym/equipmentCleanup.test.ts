import { describe, it, expect } from "vitest";
import { splitEquipmentSuffix } from "./equipment";
import { planEquipmentCleanup, derivedKey, type CleanupInput } from "./equipmentCleanup";
import { buildLibrary } from "./library";
import { libraryRows, libraryKeyOf, invertPatch } from "./libraryEdit";
import { classOf } from "./classify";
import type { Program, Workout, WorkoutExercise } from "./types";

// Pass-off item 5 (Dave 2026-10-09): equipment is a property, so "Chest Flys
// (Machine)" becomes "Chest Flys" with Machine as its equipment. The cleanup
// rides the library's own rename, so history follows the key, the old name
// stays searchable, and nothing the person typed that is not an equipment
// word is ever lost.

describe("splitEquipmentSuffix", () => {
  it("takes a trailing equipment word off and says what it was", () => {
    expect(splitEquipmentSuffix("Chest Flys (Machine)")).toEqual({ name: "Chest Flys", equipment: "stack" });
    expect(splitEquipmentSuffix("Bench Press (Barbell)")).toEqual({ name: "Bench Press", equipment: "barbell" });
    expect(splitEquipmentSuffix("Incline Press (DB)")).toEqual({ name: "Incline Press", equipment: "dumbbell" });
    expect(splitEquipmentSuffix("Curl (dumbbells)")).toEqual({ name: "Curl", equipment: "dumbbell" });
    expect(splitEquipmentSuffix("Squat (Smith Machine)")).toEqual({ name: "Squat", equipment: "smith" });
    expect(splitEquipmentSuffix("Squat ( smith )")).toEqual({ name: "Squat", equipment: "smith" });
    expect(splitEquipmentSuffix("Row (Cable)")).toEqual({ name: "Row", equipment: "cable" });
    expect(splitEquipmentSuffix("Swing (KB)")).toEqual({ name: "Swing", equipment: "kettlebell" });
    expect(splitEquipmentSuffix("Dips (BW)")).toEqual({ name: "Dips", equipment: "bodyweight" });
    expect(splitEquipmentSuffix("Pull Apart (Band)")).toEqual({ name: "Pull Apart", equipment: "band" });
    expect(splitEquipmentSuffix("Leg Press (Plate-Loaded)")).toEqual({ name: "Leg Press", equipment: "machine" });
  });

  it("never touches a name whose brackets are not equipment, or that has nothing left", () => {
    for (const name of ["Row (Wide Grip)", "Press (Paused)", "Bench Press", "(Machine)", "Fly (Cable) (Machine)", "Machine Row", "Chest Flys (Machine) Slow"]) {
      expect(splitEquipmentSuffix(name)).toEqual({ name });
    }
  });

  it("is idempotent: a clean name comes back clean and unchanged", () => {
    const once = splitEquipmentSuffix("Chest Flys (Machine)").name;
    expect(splitEquipmentSuffix(once)).toEqual({ name: once });
  });
});

let n = 0;
const we = (name: string, over: Partial<WorkoutExercise> = {}): WorkoutExercise =>
  ({ exerciseId: "x" + n++, name, kind: "weight_reps", unit: "lb", sets: [{ id: "s" + n++, w: 100, r: 10 }], ...over });
const workout = (id: string, date: string, exercises: WorkoutExercise[]): Workout =>
  ({ id, data: { programId: "p1", dayId: "d1", dayName: "Push", date, startedAt: Date.parse(date), endedAt: Date.parse(date) + 1, exercises } });
const program = (id: string, exercises: { name: string; exerciseKey?: string; equipment?: "cable" }[]): Program => ({
  id,
  data: {
    name: "Block",
    weeks: [{ id: "wk", label: "Week 1", days: [{ id: "d1", name: "Push",
      exercises: exercises.map((x, i) => ({ id: "pe" + i, kind: "weight_reps" as const, unit: "lb", sets: [], ...x })) }] }],
  },
} as Program);

const input = (over: Partial<CleanupInput>): CleanupInput => ({
  workouts: [], programs: [], createdLifts: [], store: {}, aliases: {}, favoriteKeys: [], hiddenKeys: [], dismissedDupes: [],
  goals: [], busy: () => false, ...over,
});

/** The plan applied to the lists, the way GymFlow writes it. */
function apply(ws: Workout[], ps: Program[], plan: NonNullable<ReturnType<typeof planEquipmentCleanup>>) {
  const w = new Map(plan.patch.workouts.map((x) => [x.id, x.exercises] as const));
  const p = new Map(plan.patch.programs.map((x) => [x.id, x.weeks] as const));
  return {
    workouts: ws.map((x) => (w.has(x.id) ? { ...x, data: { ...x.data, exercises: w.get(x.id)! } } : x)),
    programs: ps.map((x) => (p.has(x.id) ? { ...x, data: { ...x.data, weeks: p.get(x.id)! } } : x)),
  };
}

describe("planEquipmentCleanup", () => {
  it("renames every sighting, keeps the key, and files the equipment when nothing said one", () => {
    const workouts = [
      workout("w1", "2026-09-01", [we("Chest Flys (Machine)", { exerciseKey: "k1" })]),
      workout("w2", "2026-09-08", [we("Chest Flys (Machine)", { exerciseKey: "k1" }), we("Bench Press", { exerciseKey: "k2" })]),
    ];
    const programs = [program("p1", [{ name: "Chest Flys (Machine)", exerciseKey: "k1" }])];
    const plan = planEquipmentCleanup(input({ workouts, programs }))!;
    expect(plan.renames).toEqual([{ key: "k1", stampedKey: "k1", from: "Chest Flys (Machine)", to: "Chest Flys", equipment: "stack" }]);
    const after = apply(workouts, programs, plan);
    const names = after.workouts.flatMap((w) => w.data.exercises.map((e) => e.name));
    expect(names).toEqual(["Chest Flys", "Chest Flys", "Bench Press"]);
    // One history: every sighting still carries k1.
    const rows = libraryRows(buildLibrary(after.programs, after.workouts), after.workouts);
    const fly = rows.find((r) => r.name === "Chest Flys")!;
    expect(fly.key).toBe("k1");
    expect(fly.sessions).toBe(2);
    expect(classOf(plan.store, fly).equipment).toBe("stack");
    // The plan takes it too, so the next workout steps like a stack.
    expect(after.programs[0]!.data.weeks[0]!.days[0]!.exercises[0]).toMatchObject({ name: "Chest Flys", equipment: "stack", counted: "total" });
    // Logged records keep the convention they were logged under (none).
    expect(after.workouts[0]!.data.exercises[0]!.equipment).toBeUndefined();
    // And the old name is still searchable.
    expect(plan.aliases.k1).toEqual(["Chest Flys (Machine)"]);
  });

  it("is idempotent: once the names are clean there is nothing to plan", () => {
    const workouts = [workout("w1", "2026-09-01", [we("Row (Cable)", { exerciseKey: "k1" })])];
    const plan = planEquipmentCleanup(input({ workouts }))!;
    const after = apply(workouts, [], plan);
    expect(planEquipmentCleanup(input({ workouts: after.workouts, store: plan.store, aliases: plan.aliases }))).toBeNull();
  });

  it("never replaces an equipment the person already gave", () => {
    const workouts = [workout("w1", "2026-09-01", [we("Fly (Machine)", { exerciseKey: "k1" })])];
    const programs = [program("p1", [{ name: "Fly (Machine)", exerciseKey: "k1", equipment: "cable" }])];
    const plan = planEquipmentCleanup(input({ workouts, programs, store: { k1: { primary: ["chest"], secondary: [], tags: [] } } }))!;
    // A sighting said Cable, so the classification is left to read it.
    expect(plan.store.k1!.equipment).toBeUndefined();
    expect(plan.store.k1!.primary).toEqual(["chest"]);
    const after = apply(workouts, programs, plan);
    expect(after.programs[0]!.data.weeks[0]!.days[0]!.exercises[0]).toMatchObject({ name: "Fly", equipment: "cable" });
  });

  it("stamps a key on a lift that has none, the same key every time, and moves what was filed under the old one", () => {
    const workouts = [workout("w1", "2026-09-01", [we("Curl (Dumbbell)")])];
    const oldKey = libraryKeyOf({ name: "Curl (Dumbbell)", kind: "weight_reps" });
    const store = { [oldKey]: { primary: ["biceps" as const], secondary: [], tags: [] } };
    const plan = planEquipmentCleanup(input({ workouts, store, favoriteKeys: [oldKey], hiddenKeys: [oldKey], dismissedDupes: [`${oldKey}|zz`] }))!;
    const stamped = derivedKey(oldKey);
    expect(plan.renames[0]!.stampedKey).toBe(stamped);
    expect(planEquipmentCleanup(input({ workouts }))!.renames[0]!.stampedKey).toBe(stamped);
    expect(plan.store[oldKey]).toBeUndefined();
    expect(plan.store[stamped]).toMatchObject({ primary: ["biceps"], equipment: "dumbbell", counted: "each_hand" });
    expect(plan.favoriteKeys).toEqual([stamped]);
    expect(plan.hiddenKeys).toEqual([stamped]);
    expect(plan.dismissedDupes).toEqual([stamped < "zz" ? `${stamped}|zz` : `zz|${stamped}`]);
    const after = apply(workouts, [], plan);
    expect(after.workouts[0]!.data.exercises[0]).toMatchObject({ name: "Curl", exerciseKey: stamped });
  });

  it("a retry after a write that only partly landed finishes on the same key, never a fork", () => {
    const workouts = [
      workout("w1", "2026-09-01", [we("Curl (Dumbbell)")]),
      workout("w2", "2026-09-02", [we("Curl (Dumbbell)")]),
    ];
    const plan = planEquipmentCleanup(input({ workouts }))!;
    // Only w1 landed.
    const half = [apply(workouts, [], { ...plan, patch: { workouts: plan.patch.workouts.filter((w) => w.id === "w1"), programs: [] } }).workouts[0]!, workouts[1]!];
    const retry = planEquipmentCleanup(input({ workouts: half }))!;
    const done = apply(half, [], retry).workouts;
    const keys = new Set(done.flatMap((w) => w.data.exercises.map((e) => e.exerciseKey)));
    expect(keys.size).toBe(1);
    expect(libraryRows(buildLibrary([], done), done).filter((r) => r.name === "Curl")).toHaveLength(1);
  });

  it("never merges: two exercises that land on one name stay two, for the duplicate review", () => {
    const workouts = [workout("w1", "2026-09-01", [we("Chest Flys (Machine)", { exerciseKey: "k1" }), we("Chest Flys", { exerciseKey: "k2" })])];
    const plan = planEquipmentCleanup(input({ workouts }))!;
    const after = apply(workouts, [], plan);
    const rows = libraryRows(buildLibrary([], after.workouts), after.workouts).filter((r) => r.name === "Chest Flys");
    expect(rows.map((r) => r.key).sort()).toEqual(["k1", "k2"]);
  });

  it("waits on an exercise in the workout in progress, and on one a goal follows by name alone", () => {
    const workouts = [workout("w1", "2026-09-01", [we("Row (Cable)", { exerciseKey: "k1" }), we("Press (Machine)")])];
    expect(planEquipmentCleanup(input({ workouts, busy: (r) => r.key === "k1", goals: [{ exercise: "Press (Machine)" }] }))).toBeNull();
    // A goal that carries the key follows the rename.
    expect(planEquipmentCleanup(input({ workouts, goals: [{ exercise: "Row (Cable)", exerciseKey: "k1" }] }))!.renames.map((r) => r.to))
      .toEqual(["Row", "Press"]);
  });

  it("renames a seed that has not been done yet", () => {
    const plan = planEquipmentCleanup(input({ createdLifts: [{ key: "k9", name: "Lat Pulldown (Cable)", kind: "weight_reps" }] }))!;
    expect(plan.createdLifts).toEqual([{ key: "k9", name: "Lat Pulldown", kind: "weight_reps" }]);
    expect(plan.store.k9).toMatchObject({ equipment: "cable" });
  });

  it("can be undone exactly, through the library's own inverse", () => {
    const workouts = [workout("w1", "2026-09-01", [we("Row (Cable)", { exerciseKey: "k1" })])];
    const plan = planEquipmentCleanup(input({ workouts }))!;
    const inverse = invertPatch(plan.patch, workouts, []);
    expect(apply(apply(workouts, [], plan).workouts, [], { ...plan, patch: inverse }).workouts).toEqual(workouts);
  });
});
