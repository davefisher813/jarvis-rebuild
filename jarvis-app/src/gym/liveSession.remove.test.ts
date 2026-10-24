import { describe, it, expect } from "vitest";
import { removeExercise, restoreExercise, type LiveSession } from "./liveSession";
import type { WorkoutExercise } from "./types";

const ex = (id: string, sets = 0): WorkoutExercise => ({ exerciseId: id, name: id, kind: "weight_reps", unit: "lb", sets: Array.from({ length: sets }, (_, i) => ({ id: `${id}-${i}`, w: 100, r: 5 })) });
const live = (n: number, idx = 0): LiveSession => ({ programId: "p", dayId: "d", dayName: "Aux", date: "2026-10-24", startedAt: 1, idx, exercises: Array.from({ length: n }, (_, i) => ex("e" + i, i)) });

describe("remove from today (Dave 2026-10-24): this session only, with a way back", () => {
  it("drops that exercise and nothing else", () => {
    const s = removeExercise(live(4), 2);
    expect(s.exercises.map((e) => e.exerciseId)).toEqual(["e0", "e1", "e3"]);
  });
  it("keeps him on the same exercise when one before it goes", () => {
    expect(removeExercise(live(4, 2), 0).idx).toBe(1);
    expect(removeExercise(live(4, 1), 3).idx).toBe(1);
  });
  it("when the one he is on goes, the next slides into its place, clamped to the end", () => {
    expect(removeExercise(live(4, 1), 1).idx).toBe(1);
    expect(removeExercise(live(4, 3), 3).idx).toBe(2);
  });
  it("never empties the session, and ignores an index that is not there", () => {
    const one = live(1);
    expect(removeExercise(one, 0)).toBe(one);
    const s = live(3);
    expect(removeExercise(s, 9)).toBe(s);
  });
  it("Undo puts it back in its slot with its logged sets, and him back where he stood", () => {
    const before = live(4, 2);
    const gone = before.exercises[1]!;
    const after = removeExercise(before, 1);
    const back = restoreExercise(after, gone, 1, before.idx);
    expect(back.exercises).toEqual(before.exercises);
    expect(back.idx).toBe(2);
    expect(back.exercises[1]!.sets).toHaveLength(1);
  });
  it("a late or second Undo does not add it twice", () => {
    const before = live(3);
    const gone = before.exercises[1]!;
    const once = restoreExercise(removeExercise(before, 1), gone, 1, 0);
    expect(restoreExercise(once, gone, 1, 0).exercises).toHaveLength(3);
  });
  it("Undo of the last slot, and of a slot past the end of a shortened list, lands at the end", () => {
    const before = live(3);
    const gone = before.exercises[2]!;
    expect(restoreExercise(removeExercise(before, 2), gone, 2, 0).exercises.map((e) => e.exerciseId)).toEqual(["e0", "e1", "e2"]);
    expect(restoreExercise(live(1), gone, 7, 0).exercises.map((e) => e.exerciseId)).toEqual(["e0", "e2"]);
  });
  it("never touches the program: nothing but the session's own list changes", () => {
    const before = live(3);
    const s = removeExercise(before, 1);
    expect({ ...s, exercises: before.exercises, idx: before.idx }).toEqual(before);
  });
});
