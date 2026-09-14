import { describe, expect, it } from "vitest";
import { asRoles, coverageGap, hardSetRows, muscleMapFrom, volumeBreakdown } from "./insights";
import type { Program, SetEntry, Workout, WorkoutExercise } from "./types";
import type { MuscleGroup } from "./muscles";

// Dave, 2026-09-14: "insights are providing virtually nothing and I can't
// even click on them."

let n = 0;
const set = (extra: Partial<SetEntry> = {}): SetEntry => ({ id: `s${n++}`, w: 100, r: 8, ...extra });
const workout = (date: string, exercises: WorkoutExercise[]): Workout =>
  ({ id: `w${n++}`, data: { programId: "p1", dayId: "d1", dayName: "Push", date, startedAt: 0, endedAt: 0, exercises } });
const ex = (name: string, sets: SetEntry[], exerciseKey?: string): WorkoutExercise =>
  ({ exerciseId: name, name, kind: "weight_reps", unit: "lb", sets, ...(exerciseKey ? { exerciseKey } : {}) });

const program = (id: string, exercises: { name: string; muscleGroup?: string; exerciseKey?: string }[]): Program => ({
  id,
  data: {
    name: id,
    weeks: [{ id: "w1", days: [{ id: "d1", name: "Push", exercises: exercises.map((e, i) => ({ id: `e${i}`, kind: "weight_reps" as const, sets: [], ...e })) }] }],
  },
} as unknown as Program);

const NOW = new Date("2026-09-14T12:00:00").getTime();
const today = "2026-09-14";

describe("muscleMapFrom", () => {
  it("reads every program, not just the first", () => {
    // The old builder took programs[0], so a lift tagged anywhere else
    // counted for nothing and the card went quiet about it.
    const map = muscleMapFrom([program("a", [{ name: "Bench", muscleGroup: "chest" }]), program("b", [{ name: "Squat", muscleGroup: "quads" }])]);
    expect(map.get("Bench")).toEqual(["chest"]);
    expect(map.get("Squat")).toEqual(["quads"]);
  });

  it("lets the per-lift tags win, and indexes them by key", () => {
    const map = muscleMapFrom([program("a", [{ name: "Bench", muscleGroup: "chest", exerciseKey: "k1" }])], { k1: ["chest", "triceps"] });
    expect(map.get("k1")).toEqual(["chest", "triceps"]);
  });

  it("drops a stored value that is not a muscle", () => {
    expect(muscleMapFrom([], { k1: ["chest", "nonsense"] }).get("k1")).toEqual(["chest"]);
  });
});

describe("hard sets count direct whole and indirect half", () => {
  it("gives the first muscle the set and the rest half of it", () => {
    const map = muscleMapFrom([], { k1: ["back", "biceps"] });
    const h = [workout(today, [ex("Row", [set(), set(), set(), set()], "k1")])];
    const rows = hardSetRows(h, map, NOW);
    expect(rows.find((r) => r.muscle === "back")!.sets).toBe(4);
    expect(rows.find((r) => r.muscle === "biceps")!.sets).toBe(2);
  });

  it("finds a renamed lift by its key, which the name-only join could not", () => {
    const map = muscleMapFrom([], { k1: ["chest"] });
    // Logged under the OLD name; the key is what carries the tag.
    const h = [workout(today, [ex("Bench", [set(), set()], "k1")])];
    expect(hardSetRows(h, map, NOW)[0]).toMatchObject({ muscle: "chest", sets: 2 });
  });
});

describe("volumeBreakdown: what is behind the number", () => {
  it("names the lifts, the days and whether each counted whole or half", () => {
    const map = muscleMapFrom([], { k1: ["quads"], k2: ["glutes", "quads"] });
    const h = [
      workout(today, [ex("Squat", [set(), set(), set()], "k1")]),
      workout("2026-09-12", [ex("Hip Thrust", [set(), set()], "k2")]),
    ];
    const out = volumeBreakdown(h, map, "quads", NOW);
    expect(out.map((x) => [x.name, x.sets, x.primary])).toEqual([
      ["Squat", 3, true],
      ["Hip Thrust", 1, false],
    ]);
  });

  it("stops at the same seven-day window the card counts", () => {
    const map = muscleMapFrom([], { k1: ["quads"] });
    const h = [workout("2026-08-20", [ex("Squat", [set()], "k1")])];
    expect(volumeBreakdown(h, map, "quads", NOW)).toEqual([]);
  });
});

describe("coverageGap: why the card is thin", () => {
  it("names the untagged lifts and the sets they hide", () => {
    const map = muscleMapFrom([], { k1: ["chest"] });
    const h = [workout(today, [
      ex("Bench", [set(), set()], "k1"),
      ex("Barbell Curl", [set(), set(), set()], "k9"),
      ex("Calf Raise", [set()], "k8"),
    ])];
    const gap = coverageGap(h, map, NOW)!;
    expect(gap.tagged).toBe(1);
    expect(gap.hiddenSets).toBe(4);
    expect(gap.untagged.map((u) => u.name)).toEqual(["Barbell Curl", "Calf Raise"]);
  });

  it("disappears for good once everything trained is tagged", () => {
    const map = muscleMapFrom([], { k1: ["chest"] });
    expect(coverageGap([workout(today, [ex("Bench", [set()], "k1")])], map, NOW)).toBeNull();
  });

  it("says nothing about a week with no training in it", () => {
    expect(coverageGap([], new Map(), NOW)).toBeNull();
  });

  it("ignores warm-ups and skipped sets, the way the count above it does", () => {
    const h = [workout(today, [ex("Bench", [set({ warmup: true }), set({ skipped: true })], "k1")])];
    expect(coverageGap(h, new Map(), NOW)).toBeNull();
  });
});

// --- PRIMARY IS A LIST, AND NO SET IS EVER COUNTED TWICE -------------------
//
// (2026-09-14 second pass, handoff §4: "Keep primary and secondary muscle
// contributions distinct. Do not count a set multiple times in total
// working-set counts.")
//
// The old shape was one ordered array where position carried the meaning:
// first entry primary, the rest half. That cannot say "a deadlift has two
// prime movers", and it cannot carry the window a correction applies to.
describe("muscle roles", () => {
  const w = (date: string, name: string, n: number): Workout => ({
    id: "w" + date + name,
    data: {
      programId: "p", dayId: "d", dayName: "Day", date, startedAt: 0, endedAt: 1,
      exercises: [{ exerciseId: "e", name, kind: "weight_reps", unit: "lb", sets: Array.from({ length: n }, (_, i) => ({ id: name + date + i, w: 135, r: 8 })) }],
    },
  } as unknown as Workout);
  const NOW = new Date("2026-09-14T09:00:00").getTime();

  it("counts every primary muscle a whole set, not just the first", () => {
    const map = new Map([["Deadlift", { primary: ["back", "hamstrings"] as MuscleGroup[], secondary: ["glutes"] as MuscleGroup[] }]]);
    const rows = hardSetRows([w("2026-09-12", "Deadlift", 4)], map, NOW);
    expect(rows.find((r) => r.muscle === "back")!.sets).toBe(4);
    expect(rows.find((r) => r.muscle === "hamstrings")!.sets).toBe(4);
    expect(rows.find((r) => r.muscle === "glutes")!.sets).toBe(2);
  });

  it("still reads the old flat array exactly as it always meant", () => {
    const rows = hardSetRows([w("2026-09-12", "Row", 4)], new Map([["Row", ["back", "biceps"] as MuscleGroup[]]]), NOW);
    expect(rows.find((r) => r.muscle === "back")!.sets).toBe(4);
    expect(rows.find((r) => r.muscle === "biceps")!.sets).toBe(2);
  });

  it("never counts a session's set twice, however many muscles it is under", () => {
    // Four sets logged. Back reads 4, biceps reads 2, and the session still
    // holds four sets: these are per-muscle columns, not a set count.
    const rows = hardSetRows([w("2026-09-12", "Row", 4)], new Map([["Row", { primary: ["back"] as MuscleGroup[], secondary: ["biceps", "core"] as MuscleGroup[] }]]), NOW);
    const summed = rows.reduce((n, r) => n + r.sets, 0);
    expect(summed).toBe(4 + 2 + 2);
    // and nothing in the rows claims that 8 sets were done.
    expect(rows.every((r) => r.sets <= 4)).toBe(true);
  });

  it("a muscle in both roles is counted once, as a primary", () => {
    const rows = hardSetRows([w("2026-09-12", "Row", 4)], new Map([["Row", { primary: ["back"] as MuscleGroup[], secondary: ["back"] as MuscleGroup[] }]]), NOW);
    expect(rows.filter((r) => r.muscle === "back")).toHaveLength(1);
    expect(rows[0]!.sets).toBe(4);
  });

  it("honours a from-here-on correction: earlier sessions do not carry it", () => {
    const workouts = [w("2026-09-09", "Press", 3), w("2026-09-13", "Press", 3)];
    const map = new Map([["Press", { primary: ["shoulders"] as MuscleGroup[], secondary: [] as MuscleGroup[], from: "2026-09-12" }]]);
    expect(hardSetRows(workouts, map, NOW).find((r) => r.muscle === "shoulders")!.sets).toBe(3);
    // Without the window, both sessions count.
    const all = new Map([["Press", { primary: ["shoulders"] as MuscleGroup[], secondary: [] as MuscleGroup[] }]]);
    expect(hardSetRows(workouts, all, NOW).find((r) => r.muscle === "shoulders")!.sets).toBe(6);
  });

  it("honours an existing-records-only correction", () => {
    const workouts = [w("2026-09-09", "Press", 3), w("2026-09-13", "Press", 3)];
    const map = new Map([["Press", { primary: ["shoulders"] as MuscleGroup[], secondary: [] as MuscleGroup[], until: "2026-09-10" }]]);
    expect(hardSetRows(workouts, map, NOW).find((r) => r.muscle === "shoulders")!.sets).toBe(3);
  });

  it("an out-of-window exercise reads as untagged to the coverage card", () => {
    const workouts = [w("2026-09-09", "Press", 3)];
    const map = new Map([["Press", { primary: ["shoulders"] as MuscleGroup[], secondary: [] as MuscleGroup[], from: "2026-09-12" }]]);
    const gap = coverageGap(workouts, map, NOW);
    expect(gap!.untagged.map((u) => u.name)).toEqual(["Press"]);
  });

  it("the breakdown says which role each contribution came from", () => {
    const map = new Map([["Row", { primary: ["back"] as MuscleGroup[], secondary: ["biceps"] as MuscleGroup[] }]]);
    const back = volumeBreakdown([w("2026-09-12", "Row", 4)], map, "back", NOW);
    expect(back[0]).toMatchObject({ sets: 4, primary: true });
    const biceps = volumeBreakdown([w("2026-09-12", "Row", 4)], map, "biceps", NOW);
    expect(biceps[0]).toMatchObject({ sets: 2, primary: false });
  });
});

// The classification store is the third hand-set source muscleMapFrom reads.
describe("muscleMapFrom reads the classification store", () => {
  it("takes primary and secondary as two lists, with the scope window", () => {
    const map = muscleMapFrom([], {}, { bench: { primary: ["chest"], secondary: ["triceps"], from: "2026-01-01" } });
    expect(asRoles(map.get("bench"))).toEqual({ primary: ["chest"], secondary: ["triceps"], from: "2026-01-01" });
  });

  it("lets the classification win over the older flat list", () => {
    const map = muscleMapFrom([], { bench: ["back"] }, { bench: { primary: ["chest"], secondary: [] } });
    expect(asRoles(map.get("bench")).primary).toEqual(["chest"]);
  });

  it("stores nothing for a classification that names no muscle", () => {
    const map = muscleMapFrom([], {}, { bench: { primary: [], secondary: [] } });
    expect(map.has("bench")).toBe(false);
  });
});
