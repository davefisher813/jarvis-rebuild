import { describe, it, expect } from "vitest";
import {
  nextCopyName, duplicateExercise, duplicateDay, duplicateProgramData,
  moveExerciseToDay, copyExerciseToDays, extractDay, appendDayToWeek, ensureExerciseKey,
} from "./edit";
import type { Exercise, ProgramData, ProgramDay, ProgramWeek } from "./types";

const ex = (id: string, name: string, over: Partial<Exercise> = {}): Exercise =>
  ({ id, name, kind: "weight_reps", sets: [{ id: id + "s1", w: 100, r: 5 }], ...over });
const day = (id: string, name: string, exercises: Exercise[]): ProgramDay => ({ id, name, exercises });
const week = (id: string, label: string, days: ProgramDay[]): ProgramWeek => ({ id, label, days });

describe("nextCopyName", () => {
  it("appends 2 to a plain name", () => {
    expect(nextCopyName("Push Day")).toBe("Push Day 2");
  });
  it("bumps a trailing number instead of piling on another one", () => {
    expect(nextCopyName("Push Day 2")).toBe("Push Day 3");
  });
});

describe("duplicateExercise (catalog §3.3)", () => {
  it("inserts a copy right after the original, same name, fresh ids", () => {
    const d = day("d1", "Push", [ex("e1", "Bench"), ex("e2", "Row")]);
    const out = duplicateExercise(d, "e1");
    expect(out.exercises.map((e) => e.name)).toEqual(["Bench", "Bench", "Row"]);
    expect(out.exercises[1]!.id).not.toBe("e1");
    expect(out.exercises[1]!.sets[0]!.id).not.toBe(out.exercises[0]!.sets[0]!.id);
  });

  it("a copy carries no pairing -- its old partner is still paired to the original", () => {
    const d = day("d1", "Push", [ex("e1", "Bench", { pairWith: "e2" }), ex("e2", "Row", { pairWith: "e1" })]);
    const out = duplicateExercise(d, "e1");
    expect(out.exercises[1]!.pairWith).toBeUndefined();
  });

  it("no-ops on an unknown id", () => {
    const d = day("d1", "Push", [ex("e1", "Bench")]);
    expect(duplicateExercise(d, "nope")).toBe(d);
  });
});

describe("duplicateDay (catalog §3.3)", () => {
  it("appends a named copy right after, with fresh exercise and set ids", () => {
    const w = week("w1", "Week 1", [day("d1", "Push Day", [ex("e1", "Bench")])]);
    const out = duplicateDay(w, "d1");
    expect(out.days.map((d) => d.name)).toEqual(["Push Day", "Push Day 2"]);
    expect(out.days[1]!.id).not.toBe("d1");
    expect(out.days[1]!.exercises[0]!.id).not.toBe("e1");
  });
});

describe("duplicateProgramData (catalog §3.3)", () => {
  it("copies the whole tree with fresh ids and a bumped name, never archived", () => {
    const data: ProgramData = {
      name: "PPL", archived: true,
      weeks: [week("w1", "Week 1", [day("d1", "Push", [ex("e1", "Bench")])])],
    };
    const out = duplicateProgramData(data);
    expect(out.name).toBe("PPL 2");
    expect(out.archived).toBeUndefined();
    expect(out.weeks[0]!.id).not.toBe("w1");
    expect(out.weeks[0]!.days[0]!.id).not.toBe("d1");
    expect(out.weeks[0]!.days[0]!.exercises[0]!.id).not.toBe("e1");
  });
});

describe("moveExerciseToDay (catalog §3.4)", () => {
  it("removes from the source day and appends to the target, same id and sets", () => {
    const weeks = [week("w1", "Week 1", [
      day("d1", "Push", [ex("e1", "Bench")]),
      day("d2", "Pull", [ex("e2", "Row")]),
    ])];
    const out = moveExerciseToDay(weeks, "d1", "e1", "d2");
    expect(out[0]!.days[0]!.exercises).toHaveLength(0);
    expect(out[0]!.days[1]!.exercises.map((e) => e.id)).toEqual(["e2", "e1"]);
  });

  it("drops any pairing the moved exercise carried", () => {
    const weeks = [week("w1", "Week 1", [
      day("d1", "Push", [ex("e1", "Bench", { pairWith: "e2" }), ex("e2", "Filler", { pairWith: "e1" })]),
      day("d2", "Pull", []),
    ])];
    const out = moveExerciseToDay(weeks, "d1", "e1", "d2");
    expect(out[0]!.days[1]!.exercises[0]!.pairWith).toBeUndefined();
  });
});

describe("copyExerciseToDays (catalog §3.4)", () => {
  it("leaves the original untouched and gives every target day its own fresh copy", () => {
    const weeks = [week("w1", "Week 1", [
      day("d1", "Push", [ex("e1", "Arm Care")]),
      day("d2", "Pull", []),
      day("d3", "Legs", []),
    ])];
    const out = copyExerciseToDays(weeks, "d1", "e1", ["d2", "d3"]);
    expect(out[0]!.days[0]!.exercises).toHaveLength(1); // source untouched
    expect(out[0]!.days[1]!.exercises[0]!.name).toBe("Arm Care");
    expect(out[0]!.days[2]!.exercises[0]!.name).toBe("Arm Care");
    expect(out[0]!.days[1]!.exercises[0]!.id).not.toBe(out[0]!.days[2]!.exercises[0]!.id);
  });
});

describe("extractDay / appendDayToWeek: move a day to another program (catalog §3.4)", () => {
  it("removes the day from its week and hands it back intact", () => {
    const weeks = [week("w1", "Week 1", [day("d1", "Push", [ex("e1", "Bench")])])];
    const { weeks: left, day: extracted } = extractDay(weeks, "d1");
    expect(left[0]!.days).toHaveLength(0);
    expect(extracted!.id).toBe("d1");
    expect(extracted!.exercises[0]!.id).toBe("e1");
  });

  it("landing in a different program mints a fresh day id and fresh exercise ids", () => {
    const { day: extracted } = extractDay([week("w1", "Week 1", [day("d1", "Push", [ex("e1", "Bench")])])], "d1");
    const target = [week("w2", "Week 1", [])];
    const out = appendDayToWeek(target, "w2", extracted!, true);
    expect(out[0]!.days[0]!.id).not.toBe("d1");
    expect(out[0]!.days[0]!.exercises[0]!.id).not.toBe("e1");
    expect(out[0]!.days[0]!.name).toBe("Push");
  });

  it("reordering within the same program keeps the day's own id", () => {
    const { day: extracted } = extractDay([week("w1", "Week 1", [day("d1", "Push", [ex("e1", "Bench")])])], "d1");
    const target = [week("w2", "Week 2", [])];
    const out = appendDayToWeek(target, "w2", extracted!, false);
    expect(out[0]!.days[0]!.id).toBe("d1");
  });
});

describe("ensureExerciseKey", () => {
  it("mints a key when there is none", () => {
    const withKey = ensureExerciseKey(ex("e1", "Bench"));
    expect(withKey.exerciseKey).toBeTruthy();
  });
  it("leaves an existing key alone", () => {
    const withKey = ensureExerciseKey(ex("e1", "Bench", { exerciseKey: "ek1" }));
    expect(withKey.exerciseKey).toBe("ek1");
  });
});
