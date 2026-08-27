import { describe, it, expect } from "vitest";
import { migrateProgramData, migrateWorkoutData } from "./migrate";
import type { ProgramData, WorkoutData } from "./types";

// MIGRATION (catalog §4.1, §3.1, open question 6): old-shape programs
// (`{ name, days: [{ exercises: [{ sets: number, target }] }] }`) become
// the new shape (`{ name, weeks: [{ days }] }`) with each exercise's
// `sets + target` expanded into a uniform strip. Already-migrated data
// passes through untouched, so this is safe to call unconditionally on
// every read.

describe("migrateProgramData", () => {
  it("wraps an old flat-days program into a single Week 1", () => {
    const old = {
      name: "Push Pull Legs",
      days: [
        {
          id: "d1",
          name: "Push",
          exercises: [
            { id: "e1", name: "Bench", kind: "weight_reps", unit: "lb", sets: 3, target: { w: 135, r: 8 } },
          ],
        },
      ],
    };
    const p = migrateProgramData(old);
    expect(p.weeks).toHaveLength(1);
    expect(p.weeks[0]!.label).toBe("Week 1");
    expect(p.weeks[0]!.days).toHaveLength(1);
    const bench = p.weeks[0]!.days[0]!.exercises[0]!;
    expect(bench.name).toBe("Bench");
    expect(bench.sets).toHaveLength(3);
    expect(bench.sets.every((s) => s.w === 135 && s.r === 8)).toBe(true);
    // every chip gets its own id
    const ids = new Set(bench.sets.map((s) => s.id));
    expect(ids.size).toBe(3);
  });

  it("a done-kind exercise expands into blank chips, no invented numbers", () => {
    const old = {
      name: "Recovery",
      days: [{ id: "d1", name: "Day", exercises: [{ id: "e1", name: "Stretching", kind: "done", sets: 2 }] }],
    };
    const p = migrateProgramData(old);
    const stretch = p.weeks[0]!.days[0]!.exercises[0]!;
    expect(stretch.sets).toHaveLength(2);
    expect(stretch.sets.every((s) => s.w === undefined && s.r === undefined && s.v === undefined && s.t === undefined)).toBe(true);
  });

  it("a missing or zero sets count still produces at least one chip", () => {
    const old = { name: "P", days: [{ id: "d1", name: "Day", exercises: [{ id: "e1", name: "X", kind: "reps" }] }] };
    const p = migrateProgramData(old);
    expect(p.weeks[0]!.days[0]!.exercises[0]!.sets).toHaveLength(1);
  });

  it("preserves order and archived flags", () => {
    const old = { name: "P", days: [], order: 3, archived: true };
    const p = migrateProgramData(old);
    expect(p.order).toBe(3);
    expect(p.archived).toBe(true);
  });

  it("already-migrated data (carries weeks) passes through untouched", () => {
    const migrated: ProgramData = {
      name: "Already New",
      weeks: [{ id: "w1", label: "Week 1", days: [] }],
    };
    const p = migrateProgramData(migrated);
    expect(p).toBe(migrated as unknown as ProgramData);
    expect(p.weeks[0]!.id).toBe("w1");
  });

  it("an exercise already in the new shape (sets is an array) is left alone inside an old-shape program", () => {
    const mixed = {
      name: "P",
      days: [
        {
          id: "d1",
          name: "Day",
          exercises: [
            { id: "e1", name: "Row", kind: "weight_reps", sets: [{ id: "keep-me", w: 100, r: 10 }] },
          ],
        },
      ],
    };
    const p = migrateProgramData(mixed);
    expect(p.weeks[0]!.days[0]!.exercises[0]!.sets).toEqual([{ id: "keep-me", w: 100, r: 10 }]);
  });
});

describe("migrateWorkoutData", () => {
  it("stamps ids onto old bare SetLog entries", () => {
    const old = {
      programId: "p", dayId: "d", dayName: "Push", date: "2026-08-01", startedAt: 0, endedAt: 1,
      exercises: [
        { exerciseId: "e1", name: "Bench", kind: "weight_reps", unit: "lb", sets: [{ w: 135, r: 8 }, { w: 135, r: 7 }] },
      ],
    };
    const w = migrateWorkoutData(old);
    expect(w.exercises[0]!.sets).toHaveLength(2);
    for (const s of w.exercises[0]!.sets) {
      expect(typeof s.id).toBe("string");
      expect(s.id.length).toBeGreaterThan(0);
    }
    expect(w.exercises[0]!.sets[0]).toMatchObject({ w: 135, r: 8 });
  });

  it("carries skipped and done flags through", () => {
    const old = {
      programId: "p", dayId: "d", dayName: "Day", date: "2026-08-01", startedAt: 0, endedAt: 1,
      exercises: [
        { exerciseId: "e1", name: "Row", kind: "weight_reps", sets: [{ skipped: true }] },
        { exerciseId: "e2", name: "Stretch", kind: "done", sets: [{ done: true }] },
      ],
    };
    const w = migrateWorkoutData(old);
    expect(w.exercises[0]!.sets[0]!.skipped).toBe(true);
    expect(w.exercises[1]!.sets[0]!.done).toBe(true);
  });

  it("already-migrated entries (carry an id) pass through without a new id", () => {
    const already: WorkoutData = {
      programId: "p", dayId: "d", dayName: "Day", date: "2026-08-01", startedAt: 0, endedAt: 1,
      exercises: [{ exerciseId: "e1", name: "Bench", kind: "weight_reps", sets: [{ id: "keep-me", w: 135, r: 8 }] }],
    };
    const w = migrateWorkoutData(already);
    expect(w.exercises[0]!.sets[0]!.id).toBe("keep-me");
  });

  it("an exercise with no sets at all migrates to an empty strip, not a throw", () => {
    const old = { programId: "p", dayId: "d", dayName: "Day", date: "2026-08-01", startedAt: 0, endedAt: 1, exercises: [{ exerciseId: "e1", name: "Row", kind: "weight_reps" }] };
    const w = migrateWorkoutData(old);
    expect(w.exercises[0]!.sets).toEqual([]);
  });
});
