import { describe, it, expect } from "vitest";
import { buildLibrary, searchLibrary, searchLibraryByKind, newExerciseKey, draftFromLibrary } from "./library";
import type { Program, Workout } from "./types";

function program(over: Partial<Program["data"]> = {}): Program {
  return {
    id: "p1",
    data: {
      name: "Push Pull Legs",
      weeks: [{
        id: "w1", label: "Week 1", days: [{
          id: "d1", name: "Push", exercises: [
            { id: "e1", name: "Trap Bar Deadlift", kind: "weight_reps", unit: "lb", exerciseKey: "ek1", sets: [{ id: "s1", w: 225, r: 5 }] },
          ],
        }],
      }],
      ...over,
    },
  };
}

function workout(startedAt: number, name: string, exerciseKey?: string): Workout {
  return {
    id: "wo" + startedAt,
    data: {
      programId: "p1", dayId: "d1", dayName: "Push", date: "2026-08-01",
      startedAt, endedAt: startedAt + 60000,
      exercises: [{ exerciseId: "e1", name, kind: "weight_reps", unit: "lb", exerciseKey, sets: [{ id: "s2", w: 235, r: 5 }] }],
    },
  };
}

describe("buildLibrary", () => {
  it("carries the program's exercise forward, keyed by its exerciseKey", () => {
    const lib = buildLibrary([program()], []);
    expect(lib).toHaveLength(1);
    expect(lib[0]!.exerciseKey).toBe("ek1");
    expect(lib[0]!.name).toBe("Trap Bar Deadlift");
  });

  it("a workout using the SAME exerciseKey updates the entry rather than forking it", () => {
    const lib = buildLibrary([program()], [workout(1000, "Trap Bar Deadlift", "ek1")]);
    expect(lib).toHaveLength(1);
    expect(lib[0]!.lastSets[0]).toMatchObject({ w: 235, r: 5 });
  });

  it("two names with no shared key produce two entries -- the fork the library exists to prevent going forward", () => {
    const lib = buildLibrary([program()], [workout(1000, "Trap bar DL")]);
    expect(lib).toHaveLength(2);
  });

  it("includes exercises even from an archived program -- real history, not lost history", () => {
    const p = program({ archived: true });
    const lib = buildLibrary([p], []);
    expect(lib).toHaveLength(1);
  });

  it("the most recently logged workout wins the displayed name for a shared key (a rename propagates)", () => {
    const lib = buildLibrary([program()], [
      workout(1000, "Trap Bar Deadlift", "ek1"),
      workout(2000, "Trap Bar Deadlift (Straps)", "ek1"),
    ]);
    expect(lib).toHaveLength(1);
    expect(lib[0]!.name).toBe("Trap Bar Deadlift (Straps)");
  });
});

describe("searchLibrary", () => {
  const lib = buildLibrary([program()], [workout(1000, "Goblet Squat")]);

  it("matches case-insensitively as a substring", () => {
    expect(searchLibrary(lib, "trap").map((e) => e.name)).toEqual(["Trap Bar Deadlift"]);
    expect(searchLibrary(lib, "SQUAT").map((e) => e.name)).toEqual(["Goblet Squat"]);
  });

  it("an empty query returns the most recently used entries, not nothing", () => {
    expect(searchLibrary(lib, "")).toHaveLength(2);
  });

  it("respects the limit", () => {
    expect(searchLibrary(lib, "", 1)).toHaveLength(1);
  });
});

describe("searchLibraryByKind", () => {
  it("only offers a substitute that logs the same way (catalog §3.9)", () => {
    const lib = buildLibrary([program()], [{
      id: "wo3", data: {
        programId: "p1", dayId: "d1", dayName: "Push", date: "2026-08-01",
        startedAt: 3000, endedAt: 3060000,
        exercises: [{ exerciseId: "e2", name: "40 Yard Dash", kind: "time_faster", unit: "sec", sets: [{ id: "s3", v: 4.6 }] }],
      },
    }]);
    expect(searchLibraryByKind(lib, "", "weight_reps").map((e) => e.name)).toEqual(["Trap Bar Deadlift"]);
    expect(searchLibraryByKind(lib, "", "time_faster").map((e) => e.name)).toEqual(["40 Yard Dash"]);
  });
});

describe("newExerciseKey", () => {
  it("never repeats", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newExerciseKey()));
    expect(ids.size).toBe(50);
  });
});

describe("draftFromLibrary", () => {
  it("carries name, kind, unit and key forward with re-minted set ids", () => {
    const lib = buildLibrary([program()], []);
    const draft = draftFromLibrary(lib[0]!, [{ id: "orig", w: 225, r: 5 }]);
    expect(draft.name).toBe("Trap Bar Deadlift");
    expect(draft.kind).toBe("weight_reps");
    expect(draft.exerciseKey).toBe("ek1");
    expect(draft.sets[0]!.w).toBe(225);
  });

  it("mints a fresh key for a legacy entry with none", () => {
    const lib = buildLibrary([program()], [workout(1000, "Ungrouped Lift")]);
    const legacy = lib.find((e) => e.name === "Ungrouped Lift")!;
    expect(legacy.exerciseKey).toBeUndefined();
    const draft = draftFromLibrary(legacy, []);
    expect(draft.exerciseKey).toBeTruthy();
  });
});
