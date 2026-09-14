import { describe, expect, it } from "vitest";
import { coverageGap, hardSetRows, muscleMapFrom, volumeBreakdown } from "./insights";
import type { Program, SetEntry, Workout, WorkoutExercise } from "./types";

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
