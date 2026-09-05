import { describe, it, expect } from "vitest";
import {
  nextCopyName, duplicateExercise, duplicateDay, duplicateProgramData,
  moveExerciseToDay, copyExerciseToDays, extractDay, appendDayToWeek, moveDayBetweenPrograms, applyExerciseEdit,
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

  // GYM-F-05 (2026-09-05): the copy used to arrive as id/name/exercises and
  // nothing else, so a duplicated day had no warm-up, no cool-down and no
  // pairs.
  it("carries the warm-up and cool-down blocks, with their own fresh ids", () => {
    const src: ProgramDay = {
      ...day("d1", "Push Day", [ex("e1", "Bench")]),
      warmUp: [{ id: "b1", name: "Bike, easy", amount: "5 min" }], warmUpMin: 8,
      coolDown: [{ id: "b2", name: "Couch stretch" }], coolDownMin: 5,
    };
    const out = duplicateDay(week("w1", "Week 1", [src]), "d1");
    const copy = out.days[1]!;
    expect(copy.warmUp!.map((b) => b.name)).toEqual(["Bike, easy"]);
    expect(copy.warmUp![0]!.id).not.toBe("b1");
    expect(copy.coolDown!.map((b) => b.name)).toEqual(["Couch stretch"]);
    expect(copy.coolDown![0]!.id).not.toBe("b2");
    expect(copy.warmUpMin).toBe(8);
    expect(copy.coolDownMin).toBe(5);
  });

  it("keeps A1/A2 pairing, remapped onto the copy's own exercise ids", () => {
    const src = day("d1", "Push Day", [ex("e1", "Row", { pairWith: "e2" }), ex("e2", "Curl", { pairWith: "e1" })]);
    const copy = duplicateDay(week("w1", "Week 1", [src]), "d1").days[1]!;
    const [row, curl] = copy.exercises;
    expect(row!.id).not.toBe("e1");
    expect(curl!.id).not.toBe("e2");
    expect(row!.pairWith).toBe(curl!.id);
    expect(curl!.pairWith).toBe(row!.id);
  });

  it("drops the pins: two days in one week on the same weekday would both claim it", () => {
    const src: ProgramDay = { ...day("d1", "Push Day", [ex("e1", "Bench")]), pinDays: [0, 3] };
    const copy = duplicateDay(week("w1", "Week 1", [src]), "d1").days[1]!;
    expect(copy.pinDays).toBeUndefined();
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

  // GYM-F-05 (2026-09-05): "the basis of every new block" arrived with every
  // day stripped of its pins, its blocks and its pairs.
  it("every day keeps its pins, its blocks and its pairs", () => {
    const d: ProgramDay = {
      ...day("d1", "Push", [ex("e1", "Row", { pairWith: "e2" }), ex("e2", "Curl", { pairWith: "e1" })]),
      pinDays: [1], warmUp: [{ id: "b1", name: "Bike, easy" }], warmUpMin: 8,
    };
    const out = duplicateProgramData({ name: "PPL", weeks: [week("w1", "Week 1", [d])] });
    const copy = out.weeks[0]!.days[0]!;
    expect(copy.pinDays).toEqual([1]);
    expect(copy.warmUp!.map((b) => b.name)).toEqual(["Bike, easy"]);
    expect(copy.warmUp![0]!.id).not.toBe("b1");
    expect(copy.warmUpMin).toBe(8);
    expect(copy.exercises[0]!.pairWith).toBe(copy.exercises[1]!.id);
    expect(copy.exercises[1]!.pairWith).toBe(copy.exercises[0]!.id);
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

  // GYM-F-05 (2026-09-05): a day moved to another program arrived without
  // its pins, its blocks or its pairs.
  it("landing in a different program carries the pins, the blocks and the pairs", () => {
    const src: ProgramDay = {
      ...day("d1", "Push", [ex("e1", "Row", { pairWith: "e2" }), ex("e2", "Curl", { pairWith: "e1" })]),
      pinDays: [2], coolDown: [{ id: "b1", name: "Couch stretch" }], coolDownMin: 5,
    };
    const out = appendDayToWeek([week("w2", "Week 1", [])], "w2", src, true);
    const landed = out[0]!.days[0]!;
    expect(landed.pinDays).toEqual([2]);
    expect(landed.coolDown!.map((b) => b.name)).toEqual(["Couch stretch"]);
    expect(landed.coolDown![0]!.id).not.toBe("b1");
    expect(landed.coolDownMin).toBe(5);
    expect(landed.exercises[0]!.pairWith).toBe(landed.exercises[1]!.id);
  });

  it("reordering within the same program keeps the day's own id", () => {
    const { day: extracted } = extractDay([week("w1", "Week 1", [day("d1", "Push", [ex("e1", "Bench")])])], "d1");
    const target = [week("w2", "Week 2", [])];
    const out = appendDayToWeek(target, "w2", extracted!, false);
    expect(out[0]!.days[0]!.id).toBe("d1");
  });

  // GYM-F-12 (2026-09-05): a target with no weeks made the caller mint a
  // week id that nothing here knew, and the day was silently dropped.
  it("a week id the program does not have becomes a new week holding the day", () => {
    const { day: extracted } = extractDay([week("w1", "Week 1", [day("d1", "Speed Work", [ex("e1", "Sprints")])])], "d1");
    const out = appendDayToWeek([], "w-new", extracted!, true);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("w-new");
    expect(out[0]!.label).toBe("Week 1");
    expect(out[0]!.days.map((d) => d.name)).toEqual(["Speed Work"]);
  });
});

// GYM-F-12 (2026-09-05): the two writes of a cross-program move, in the
// order that cannot lose the day. The audit's case: the source write landed,
// the target write threw, the day was in neither program.
describe("moveDayBetweenPrograms (GYM-F-12)", () => {
  const source = () => ({ id: "pA", weeks: [week("w1", "Week 1", [day("d1", "Speed Work", [ex("e1", "Sprints")]), day("d2", "Lift", [])])] });
  const target = () => ({ id: "pB", weeks: [week("w9", "Week 1", [])] });

  it("writes the target BEFORE the source, and both land", async () => {
    const writes: { id: string; weeks: ProgramWeek[] }[] = [];
    const write = async (id: string, weeks: ProgramWeek[]) => { writes.push({ id, weeks }); return true; };
    const outcome = await moveDayBetweenPrograms(write, source(), target(), "d1", "w9");
    expect(outcome).toBe("moved");
    expect(writes.map((w) => w.id)).toEqual(["pB", "pA"]);
    expect(writes[0]!.weeks[0]!.days.map((d) => d.name)).toEqual(["Speed Work"]);
    expect(writes[1]!.weeks[0]!.days.map((d) => d.name)).toEqual(["Lift"]);
  });

  it("a target write that throws changes nothing: the day is still in the source", async () => {
    const writes: string[] = [];
    const write = async (id: string) => { writes.push(id); throw new Error("offline"); };
    const outcome = await moveDayBetweenPrograms(write, source(), target(), "d1", "w9");
    expect(outcome).toBe("failed");
    expect(writes).toEqual(["pB"]);
  });

  it("a source write that fails after the target landed reports a duplicate, never a loss", async () => {
    const write = async (id: string) => { if (id === "pA") throw new Error("flaky"); return true; };
    const outcome = await moveDayBetweenPrograms(write, source(), target(), "d1", "w9");
    expect(outcome).toBe("landed");
  });

  it("a program the store no longer has (write resolves false) is a failure, not a move", async () => {
    const write = async () => false;
    expect(await moveDayBetweenPrograms(write, source(), target(), "d1", "w9")).toBe("failed");
  });

  it("a target with no weeks gets one, and the day is in it", async () => {
    const writes: { id: string; weeks: ProgramWeek[] }[] = [];
    const write = async (id: string, weeks: ProgramWeek[]) => { writes.push({ id, weeks }); return true; };
    const outcome = await moveDayBetweenPrograms(write, source(), { id: "pB", weeks: [] }, "d1", "w-minted");
    expect(outcome).toBe("moved");
    expect(writes[0]!.weeks).toHaveLength(1);
    expect(writes[0]!.weeks[0]!.days.map((d) => d.name)).toEqual(["Speed Work"]);
  });
});

// GYM-F-03 (2026-09-05): editing either half of a pair used to unpair it.
describe("applyExerciseEdit (GYM-F-03)", () => {
  const draft = { name: "Row", kind: "weight_reps" as const, sets: [{ id: "n1", w: 135, r: 10 }], exerciseKey: "ekRow" };

  it("a paired exercise keeps its pairWith after Save", () => {
    const out = applyExerciseEdit(ex("e1", "Row", { pairWith: "e2", exerciseKey: "ekRow" }), draft);
    expect(out.pairWith).toBe("e2");
    expect(out.id).toBe("e1");
    expect(out.sets).toEqual([{ id: "n1", w: 135, r: 10 }]);
  });

  it("an unpaired exercise gains no pairWith key at all", () => {
    const out = applyExerciseEdit(ex("e1", "Row"), draft);
    expect("pairWith" in out).toBe(false);
  });

  it("the sheet still owns every field it renders: a cleared note stays cleared", () => {
    const out = applyExerciseEdit(ex("e1", "Row", { note: "old cue", ramp: true, restSec: 90, pairWith: "e2" }), draft);
    expect(out.note).toBeUndefined();
    expect(out.ramp).toBeUndefined();
    expect(out.restSec).toBeUndefined();
    expect(out.pairWith).toBe("e2");
  });
});
