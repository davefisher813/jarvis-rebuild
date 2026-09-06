import { describe, it, expect } from "vitest";
import { groupLabels, fillerFor, nextInGroup, groupExercises, ungroupExercise } from "./groups";
import type { Exercise } from "./types";

const ex = (id: string, name: string, over: Partial<Exercise> = {}): Exercise =>
  ({ id, name, kind: "weight_reps", sets: [], ...over });

describe("groupLabels: A1/A2 notation (catalog §4.2), and a pair is a group of two", () => {
  it("labels a symmetric pair A1/A2 in day order", () => {
    const day = [ex("e1", "Bench", { pairWith: "e2" }), ex("e2", "Row", { pairWith: "e1" }), ex("e3", "Curl")];
    const labels = groupLabels(day);
    expect(labels.get("e1")).toBe("A1");
    expect(labels.get("e2")).toBe("A2");
    expect(labels.has("e3")).toBe(false);
  });

  it("labels two separate pairs B after A", () => {
    const day = [
      ex("e1", "Bench", { pairWith: "e2" }), ex("e2", "Row", { pairWith: "e1" }),
      ex("e3", "Squat", { pairWith: "e4" }), ex("e4", "Lunge", { pairWith: "e3" }),
    ];
    const labels = groupLabels(day);
    expect(labels.get("e3")).toBe("B1");
    expect(labels.get("e4")).toBe("B2");
  });

  it("a stale one-sided link (the partner does not point back) gets no label", () => {
    const day = [ex("e1", "Bench", { pairWith: "e2" }), ex("e2", "Row")];
    expect(groupLabels(day).size).toBe(0);
  });
});

describe("fillerFor: catalog §4.2", () => {
  it("offers the filler paired with a lift during its rest", () => {
    const lift = ex("e1", "Bench", { pairWith: "e2", restSec: 120 });
    const filler = ex("e2", "T-Spine Rotations", { pairWith: "e1", filler: true });
    expect(fillerFor(lift, [lift, filler])?.name).toBe("T-Spine Rotations");
  });

  it("an ordinary A1/A2 pair (neither side a filler) offers nothing", () => {
    const a = ex("e1", "Bench", { pairWith: "e2" });
    const b = ex("e2", "Row", { pairWith: "e1" });
    expect(fillerFor(a, [a, b])).toBeNull();
  });

  it("an unpaired exercise offers nothing", () => {
    expect(fillerFor(ex("e1", "Bench"), [ex("e1", "Bench")])).toBeNull();
  });
});

describe("groupExercises / ungroupExercise", () => {
  let n = 0;
  const gid = () => "g" + (++n);

  it("grouping two exercises gives both the same group, and labels them A1/A2", () => {
    const day = groupExercises([ex("e1", "Bench"), ex("e2", "Row"), ex("e3", "Curl")], "e1", ["e2"], gid);
    expect(day.find((e) => e.id === "e1")!.groupId).toBe(day.find((e) => e.id === "e2")!.groupId);
    expect(day.find((e) => e.id === "e3")!.groupId).toBeUndefined();
    expect(groupLabels(day).get("e2")).toBe("A2");
  });

  it("three or more in one group is the whole point: A1, A2, A3", () => {
    const day = groupExercises([ex("e1", "Bench"), ex("e2", "Row"), ex("e3", "Curl")], "e1", ["e2", "e3"], gid);
    const labels = groupLabels(day);
    expect([labels.get("e1"), labels.get("e2"), labels.get("e3")]).toEqual(["A1", "A2", "A3"]);
  });

  it("regrouping one side drops the link it had, leaving nobody half-joined", () => {
    const day = groupExercises([ex("e1", "Bench"), ex("e2", "Row"), ex("e3", "Curl")], "e1", ["e2"], gid);
    const again = groupExercises(day, "e1", ["e3"], gid);
    expect(again.find((e) => e.id === "e2")!.groupId).toBeUndefined();
    expect(again.find((e) => e.id === "e1")!.groupId).toBe(again.find((e) => e.id === "e3")!.groupId);
  });

  it("ungrouping the last two clears both, because one member is not a group", () => {
    const day = groupExercises([ex("e1", "Bench"), ex("e2", "Row")], "e1", ["e2"], gid);
    const out = ungroupExercise(day, "e1");
    expect(out.find((e) => e.id === "e1")!.groupId).toBeUndefined();
    expect(out.find((e) => e.id === "e2")!.groupId).toBeUndefined();
  });

  it("ungrouping one of three leaves the other two grouped", () => {
    const day = groupExercises([ex("e1", "Bench"), ex("e2", "Row"), ex("e3", "Curl")], "e1", ["e2", "e3"], gid);
    const out = ungroupExercise(day, "e1");
    expect(out.find((e) => e.id === "e1")!.groupId).toBeUndefined();
    expect(out.find((e) => e.id === "e2")!.groupId).toBe(out.find((e) => e.id === "e3")!.groupId);
  });

  it("a legacy pairWith is read as a group of two, so nothing has to migrate", () => {
    const day = [
      ex("e1", "Bench", { pairWith: "e2", sets: [{ id: "x1" }, { id: "x2" }] }),
      ex("e2", "Row", { pairWith: "e1", sets: [{ id: "y1" }, { id: "y2" }] }),
    ];
    expect(groupLabels(day).get("e2")).toBe("A2");
    expect(nextInGroup(day[0]!, day, { e1: 1, e2: 0 })).toBe("e2");
  });

  it("joining a group clears the legacy pairing on both sides of it", () => {
    const day = [ex("e1", "Bench", { pairWith: "e2" }), ex("e2", "Row", { pairWith: "e1" }), ex("e3", "Curl")];
    const out = groupExercises(day, "e1", ["e3"], gid);
    expect(out.find((e) => e.id === "e1")!.pairWith).toBeUndefined();
    expect(out.find((e) => e.id === "e2")!.pairWith).toBeUndefined();
    expect(out.find((e) => e.id === "e2")!.groupId).toBeUndefined();
  });
});

// SUPERSET FLOW (D8-C, approved 2026-08-31). Hevy calls it smart superset
// scrolling: after A1's set the session offers A2, and the rest belongs to
// the GROUP, not to any one member. UP-ATH-17 widened the pair to a group;
// every case below is the pair case it was, unchanged, because a pair is a
// group of two, plus the rotation a circuit needs.
describe("nextInGroup", () => {
  const ex = (id: string, over: Partial<Exercise> = {}): Exercise =>
    ({ id, name: id, kind: "weight_reps", sets: [{ id: id + "s1" }, { id: id + "s2" }], ...over });

  it("sends you to the partner when it is behind", () => {
    const a = ex("a", { pairWith: "b" }), b = ex("b", { pairWith: "a" });
    expect(nextInGroup(a, [a, b], { a: 1, b: 0 })).toBe("b");
  });

  it("comes back to you once the partner has caught up", () => {
    const a = ex("a", { pairWith: "b" }), b = ex("b", { pairWith: "a" });
    expect(nextInGroup(a, [a, b], { a: 1, b: 1 })).toBeNull();
  });

  it("never sends you to a partner with no sets left", () => {
    const a = ex("a", { pairWith: "b" }), b = ex("b", { pairWith: "a" });
    expect(nextInGroup(a, [a, b], { a: 2, b: 2 })).toBeNull();
  });

  it("an ungrouped exercise has no next half", () => {
    const a = ex("a");
    expect(nextInGroup(a, [a], { a: 1 })).toBeNull();
  });

  it("a stale one-sided link is not a group", () => {
    const a = ex("a", { pairWith: "b" }), b = ex("b");
    expect(nextInGroup(a, [a, b], { a: 1, b: 0 })).toBeNull();
  });

  it("a filler is offered during rest, not interleaved as a group member", () => {
    const a = ex("a", { pairWith: "b" }), b = ex("b", { pairWith: "a", filler: true });
    expect(nextInGroup(a, [a, b], { a: 1, b: 0 })).toBeNull();
  });
});

// UP-ATH-17 (2026-09-06): the rotation a circuit needs. A1 A2 A3 A1 A2 A3
// falls out of the counts, in day order, with no stored pointer.
describe("nextInGroup rotates a circuit", () => {
  const three = () => {
    const mk = (id: string, gid: string): Exercise =>
      ({ id, name: id, kind: "weight_reps", sets: [{ id: id + "1" }, { id: id + "2" }], groupId: gid });
    return [mk("a", "g1"), mk("b", "g1"), mk("c", "g1")];
  };

  it("goes A1 to A2 to A3 and back to A1", () => {
    const day = three();
    const [a, b, c] = day as [Exercise, Exercise, Exercise];
    expect(nextInGroup(a, day, { a: 1, b: 0, c: 0 })).toBe("b");
    expect(nextInGroup(b, day, { a: 1, b: 1, c: 0 })).toBe("c");
    expect(nextInGroup(c, day, { a: 1, b: 1, c: 1 })).toBeNull();
  });

  it("skips a member with nothing left and offers the one that still has work", () => {
    const day = three();
    const [a] = day as [Exercise];
    expect(nextInGroup(a, day, { a: 2, b: 2, c: 1 })).toBe("c");
  });

  it("a group of one is no group at all", () => {
    const lonely: Exercise[] = [{ id: "a", name: "a", kind: "weight_reps", sets: [{ id: "a1" }], groupId: "g9" }];
    expect(nextInGroup(lonely[0]!, lonely, { a: 1 })).toBeNull();
    expect(groupLabels(lonely).size).toBe(0);
  });
});
