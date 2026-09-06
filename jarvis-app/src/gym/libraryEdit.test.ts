import { describe, it, expect } from "vitest";
import { libraryRows, libraryKeyOf, renameLift, mergeLifts, isEmptyPatch } from "./libraryEdit";
import { buildLibrary } from "./library";
import type { Program, Workout, WorkoutExercise } from "./types";

// UP-ATH-21 (2026-09-06): the library has known every lift since it shipped
// and nothing rendered it. These are the two repairs a free-text library
// needs, and the rule both of them obey: history follows the KEY, so a
// rename can never fork it (GYM-F-04) and a merge really joins two series.

let n = 0;
const we = (name: string, over: Partial<WorkoutExercise> = {}): WorkoutExercise =>
  ({ exerciseId: "x" + n++, name, kind: "weight_reps", unit: "lb", sets: [{ id: "s" + n++, w: 225, r: 5 }], ...over });

const workout = (id: string, date: string, exercises: WorkoutExercise[]): Workout =>
  ({ id, data: { programId: "p1", dayId: "d1", dayName: "Pull", date, startedAt: Date.parse(date), endedAt: Date.parse(date) + 1, exercises } });

const program = (id: string, names: { name: string; exerciseKey?: string }[]): Program => ({
  id,
  data: {
    name: "Block",
    weeks: [{
      id: "wk", label: "Week 1", days: [{
        id: "d1", name: "Pull",
        exercises: names.map((x, i) => ({ id: "pe" + i, name: x.name, kind: "weight_reps" as const, unit: "lb", sets: [], ...(x.exerciseKey ? { exerciseKey: x.exerciseKey } : {}) })),
      }],
    }],
  },
} as Program);

describe("libraryRows", () => {
  it("counts the sessions a lift really carries, and dates the last one", () => {
    const workouts = [
      workout("w1", "2026-09-01", [we("Trap Bar Deadlift", { exerciseKey: "k1" })]),
      workout("w2", "2026-09-04", [we("Trap Bar Deadlift", { exerciseKey: "k1" }), we("Curl")]),
    ];
    const rows = libraryRows(buildLibrary([], workouts), workouts);
    const dl = rows.find((r) => r.name === "Trap Bar Deadlift")!;
    expect(dl.sessions).toBe(2);
    expect(dl.lastDate).toBe("2026-09-04");
    expect(rows.find((r) => r.name === "Curl")!.sessions).toBe(1);
  });

  it("a lift that only exists in a program has been done zero times, and says so honestly", () => {
    const rows = libraryRows(buildLibrary([program("p1", [{ name: "Front Squat" }])], []), []);
    expect(rows[0]!.sessions).toBe(0);
    expect(rows[0]!.lastDate).toBeNull();
  });

  it("hidden is a fact on the row, never a row that disappears", () => {
    const workouts = [workout("w1", "2026-09-01", [we("Curl")])];
    const library = buildLibrary([], workouts);
    const rows = libraryRows(library, workouts, [library[0]!.key]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.hidden).toBe(true);
  });
});

describe("renameLift", () => {
  it("renames every sighting, in the workouts and in the programs", () => {
    const workouts = [workout("w1", "2026-09-01", [we("Trap bar DL", { exerciseKey: "k1" })])];
    const programs = [program("p1", [{ name: "Trap bar DL", exerciseKey: "k1" }])];
    const rows = libraryRows(buildLibrary(programs, workouts), workouts);
    const patch = renameLift(workouts, programs, rows[0]!, "Trap Bar Deadlift", () => "new");
    expect(patch.workouts[0]!.exercises[0]!.name).toBe("Trap Bar Deadlift");
    expect(patch.programs[0]!.weeks[0]!.days[0]!.exercises[0]!.name).toBe("Trap Bar Deadlift");
  });

  it("a lift with no key of its own is STAMPED with one, so the rename cannot fork its history", () => {
    const workouts = [workout("w1", "2026-09-01", [we("Trap bar DL")])];
    const rows = libraryRows(buildLibrary([], workouts), workouts);
    expect(rows[0]!.exerciseKey).toBeUndefined();
    const patch = renameLift(workouts, [], rows[0]!, "Trap Bar Deadlift", () => "minted");
    const after = patch.workouts[0]!.exercises[0]!;
    expect(after.exerciseKey).toBe("minted");
    // The renamed sighting and the old one now answer the same identity
    // question, which is the whole point.
    expect(libraryKeyOf(after)).toBe("minted");
  });

  it("refuses an empty or unchanged name rather than writing nothing everywhere", () => {
    const workouts = [workout("w1", "2026-09-01", [we("Curl")])];
    const rows = libraryRows(buildLibrary([], workouts), workouts);
    expect(isEmptyPatch(renameLift(workouts, [], rows[0]!, "   ", () => "k"))).toBe(true);
    expect(isEmptyPatch(renameLift(workouts, [], rows[0]!, "Curl", () => "k"))).toBe(true);
  });

  it("leaves every other lift alone", () => {
    const workouts = [workout("w1", "2026-09-01", [we("Trap bar DL"), we("Curl")])];
    const rows = libraryRows(buildLibrary([], workouts), workouts);
    const dl = rows.find((r) => r.name === "Trap bar DL")!;
    const patch = renameLift(workouts, [], dl, "Trap Bar Deadlift", () => "minted");
    const curl = patch.workouts[0]!.exercises.find((e) => e.name === "Curl")!;
    expect(curl.exerciseKey).toBeUndefined();
  });
});

describe("mergeLifts", () => {
  it("folds two names into one series, with one key across both", () => {
    const workouts = [
      workout("w1", "2026-09-01", [we("Trap bar DL")]),
      workout("w2", "2026-09-04", [we("Trap Bar Deadlift")]),
    ];
    const rows = libraryRows(buildLibrary([], workouts), workouts);
    const loser = rows.find((r) => r.name === "Trap bar DL")!;
    const survivor = rows.find((r) => r.name === "Trap Bar Deadlift")!;
    const patch = mergeLifts(workouts, [], loser, survivor, () => "one");
    expect(patch.workouts).toHaveLength(2);
    for (const w of patch.workouts) {
      expect(w.exercises[0]!.name).toBe("Trap Bar Deadlift");
      expect(w.exercises[0]!.exerciseKey).toBe("one");
    }
  });

  it("a workout holding BOTH lifts is rewritten once, and keeps both entries", () => {
    const workouts = [workout("w1", "2026-09-01", [we("Trap bar DL"), we("Trap Bar Deadlift")])];
    const rows = libraryRows(buildLibrary([], workouts), workouts);
    const loser = rows.find((r) => r.name === "Trap bar DL")!;
    const survivor = rows.find((r) => r.name === "Trap Bar Deadlift")!;
    const patch = mergeLifts(workouts, [], loser, survivor, () => "one");
    expect(patch.workouts).toHaveLength(1);
    expect(patch.workouts[0]!.exercises).toHaveLength(2);
    expect(patch.workouts[0]!.exercises.every((e) => e.exerciseKey === "one")).toBe(true);
  });

  it("refuses a merge across measure kinds: those numbers cannot share a series", () => {
    const workouts = [
      workout("w1", "2026-09-01", [we("Sprint", { kind: "time_faster", unit: "sec", sets: [{ id: "z", v: 4.5 }] })]),
      workout("w2", "2026-09-04", [we("Trap Bar Deadlift")]),
    ];
    const rows = libraryRows(buildLibrary([], workouts), workouts);
    const sprint = rows.find((r) => r.name === "Sprint")!;
    const dl = rows.find((r) => r.name === "Trap Bar Deadlift")!;
    expect(isEmptyPatch(mergeLifts(workouts, [], sprint, dl, () => "one"))).toBe(true);
  });

  it("refuses to merge a lift into itself", () => {
    const workouts = [workout("w1", "2026-09-01", [we("Curl")])];
    const rows = libraryRows(buildLibrary([], workouts), workouts);
    expect(isEmptyPatch(mergeLifts(workouts, [], rows[0]!, rows[0]!, () => "one"))).toBe(true);
  });
});
