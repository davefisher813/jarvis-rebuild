import { describe, it, expect } from "vitest";
import { setGroupToday, sessionExercises } from "./liveGroups";
import { nextInGroup, nextTurnInGroup, groupLabels } from "./groups";
import { lastSessionFor } from "./prs";
import type { Exercise, Workout, WorkoutExercise } from "./types";

// ---------------------------------------------------------------------------
// DAVE, 2026-09-27: "I need to be able to merge 2-3 exercises together
// seamlessly for supersets while logging my workouts ... it does not
// automatically go back and forth from exercises during supersets ...
// autofill while logging during workouts should default to the week prior".
// ---------------------------------------------------------------------------

const ex = (id: string, over: Partial<Exercise> = {}): Exercise =>
  ({ id, name: id.toUpperCase(), kind: "weight_reps", sets: [{ id: id + "1" }, { id: id + "2" }, { id: id + "3" }], ...over });
let n = 0;
const fresh = () => "g" + ++n;

describe("setGroupToday: the picker's group, exactly", () => {
  it("puts two or three picked lifts into one fresh group", () => {
    const list = [ex("a"), ex("b"), ex("c"), ex("d")];
    const g = setGroupToday(undefined, ["a", "b", "c"], list, fresh);
    expect(g.a).toBeTruthy();
    expect(g.b).toBe(g.a);
    expect(g.c).toBe(g.a);
    expect(g.d).toBeUndefined();
    const labels = groupLabels(sessionExercises(list.map((e) => ({ exerciseId: e.id, name: e.name, kind: e.kind })), list, g));
    expect([labels.get("a"), labels.get("b"), labels.get("c")]).toEqual(["A1", "A2", "A3"]);
  });

  it("one pick is not a group, and changes nothing", () => {
    expect(setGroupToday({ x: "q" }, ["a"], [ex("a")], fresh)).toEqual({ x: "q" });
  });

  it("a lift taken out of a program pair is released for today, not left in it", () => {
    const list = [ex("a", { groupId: "p" }), ex("b", { groupId: "p" }), ex("c")];
    const g = setGroupToday(undefined, ["a", "c"], list, fresh);
    expect(g.b).toBe("");
    expect(g.a).toBe(g.c);
  });

  it("two lifts left over from an old tri-set stay together", () => {
    const list = [ex("a", { groupId: "p" }), ex("b", { groupId: "p" }), ex("c", { groupId: "p" }), ex("d")];
    const g = setGroupToday(undefined, ["a", "d"], list, fresh);
    expect(g.b).toBe("p");
    expect(g.c).toBe("p");
    expect(g.a).toBe(g.d);
    expect(g.a).not.toBe("p");
  });
});

describe("rotation when a member has no plan (added at the rack)", () => {
  it("a planless partner takes its turn, as far as the group's longest plan", () => {
    const day = [ex("a", { groupId: "g" }), ex("b", { groupId: "g", sets: [] })];
    expect(nextInGroup(day[0]!, day, { a: 1, b: 0 })).toBe("b");
    expect(nextTurnInGroup(day[1]!, day, { a: 1, b: 1 })).toBe("a");
    expect(nextTurnInGroup(day[1]!, day, { a: 3, b: 3 })).toBeNull();
  });

  it("two planless lifts keep alternating for as long as they are logged", () => {
    const day = [ex("a", { groupId: "g", sets: [] }), ex("b", { groupId: "g", sets: [] })];
    expect(nextTurnInGroup(day[0]!, day, { a: 5, b: 4 })).toBe("b");
    expect(nextTurnInGroup(day[1]!, day, { a: 5, b: 5 })).toBe("a");
  });
});

describe("the week prior: this workout day's last session wins", () => {
  const wex = (w: number): WorkoutExercise => ({ exerciseId: "x", name: "Bench", kind: "weight_reps", unit: "lb", sets: [{ id: "s", w, r: 5 }] });
  const wk = (id: string, dayId: string, date: string, w: number): Workout =>
    ({ id, data: { programId: "p", dayId, dayName: dayId, date, startedAt: 0, endedAt: 0, exercises: [wex(w)] } });
  const history = [wk("1", "push", "2026-09-20", 225), wk("2", "extra", "2026-09-24", 185)];
  const bench = { name: "Bench" };

  it("prefers the same day's session over a more recent one of another day", () => {
    expect(lastSessionFor(history, bench, "weight_reps", { preferDayId: "push" })?.sets[0]?.w).toBe(225);
  });
  it("falls back to the most recent session of any day", () => {
    expect(lastSessionFor(history, bench, "weight_reps", { preferDayId: "legs" })?.sets[0]?.w).toBe(185);
    expect(lastSessionFor(history, bench, "weight_reps")?.sets[0]?.w).toBe(185);
  });
});
