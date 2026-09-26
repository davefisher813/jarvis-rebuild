import { describe, it, expect } from "vitest";
import {
  EMPTY_CLASS, classConflicts, classOf, coversDate, identityLine, isBlank, mergeClass,
  muscleListOf, needsMuscles, planBatch, readClass, readClassStore, rowChips, scopeOf,
  valueLine, withScope, type ClassStore, type Classification,
} from "./classify";

// WHAT AN EXERCISE IS: the schema, its migration, and the two writes that can
// go wrong quietly (a batch, and a merge).

const c = (over: Partial<Classification> = {}): Classification => ({ ...EMPTY_CLASS, ...over });

describe("readClass: a store is never trusted", () => {
  it("reads an empty classification out of anything unrecognisable", () => {
    expect(readClass(null)).toEqual(EMPTY_CLASS);
    expect(readClass("nope")).toEqual(EMPTY_CLASS);
    expect(readClass(7)).toEqual(EMPTY_CLASS);
  });

  it("drops values no menu could ever show", () => {
    const got = readClass({
      primary: ["chest", "spleen"], secondary: ["triceps", 4],
      equipment: "trebuchet", movement: "flap", type: "strength", execution: "bilateral",
      measure: "weight_reps", tags: ["comp", "", "comp"],
    });
    expect(got.primary).toEqual(["chest"]);
    expect(got.secondary).toEqual(["triceps"]);
    expect(got.equipment).toBeUndefined();
    expect(got.movement).toBeUndefined();
    expect(got.type).toBe("strength");
    expect(got.execution).toBe("bilateral");
    expect(got.measure).toBe("weight_reps");
    expect(got.tags).toEqual(["comp"]);
  });

  it("never lets one muscle hold both roles", () => {
    const got = readClass({ primary: ["back"], secondary: ["back", "biceps"] });
    expect(got.primary).toEqual(["back"]);
    expect(got.secondary).toEqual(["biceps"]);
  });
});

describe("readClassStore: nothing set this morning is lost this afternoon", () => {
  it("lifts the old flat muscle list into primary and secondary", () => {
    const store = readClassStore(undefined, { row: ["back", "biceps", "core"] });
    expect(store.row).toMatchObject({ primary: ["back"], secondary: ["biceps", "core"] });
  });

  it("prefers the newer full classification for the same key", () => {
    const store = readClassStore({ row: { primary: ["lats" ], secondary: [] } }, { row: ["back"] });
    // "lats" is not a muscle group in this app, so the newer record reads as
    // no muscles -- and still wins, because it is the newer statement.
    expect(store.row!.primary).toEqual([]);
  });

  it("keeps keys the old store has and the new one does not", () => {
    const store = readClassStore({ a: { primary: ["chest"], secondary: [] } }, { b: ["quads"] });
    expect(store.a!.primary).toEqual(["chest"]);
    expect(store.b!.primary).toEqual(["quads"]);
  });
});

describe("classOf: the honest fallbacks", () => {
  const store: ClassStore = { bench: c({ primary: ["chest"], equipment: "barbell" }) };

  it("finds the classification by key, then by exerciseKey, then by name", () => {
    expect(classOf(store, { key: "bench" }).primary).toEqual(["chest"]);
    expect(classOf(store, { key: "x", exerciseKey: "bench" }).primary).toEqual(["chest"]);
    expect(classOf(store, { key: "x", name: "bench" }).primary).toEqual(["chest"]);
  });

  it("shows the sighting's equipment when nothing has been classified", () => {
    const got = classOf({}, { key: "row", kind: "weight_reps" }, { equipment: "stack", counted: "total" });
    expect(got.equipment).toBe("stack");
    expect(got.measure).toBe("weight_reps");
  });

  it("never lets a sighting override a stored answer", () => {
    const got = classOf(store, { key: "bench" }, { equipment: "smith" });
    expect(got.equipment).toBe("barbell");
  });
});

describe("the row's own reading", () => {
  it("marks primary and secondary apart", () => {
    const chips = rowChips(c({ primary: ["back"], secondary: ["biceps"], equipment: "barbell" }));
    expect(chips.map((x) => [x.label, x.tone])).toEqual([
      ["Back", "primary"], ["Biceps", "secondary"], ["Barbell", "plain"],
    ]);
  });

  it("says the muscles as roles, never as one flat list", () => {
    expect(valueLine(c({ primary: ["back"], secondary: ["biceps"] }), "muscles")).toBe("Back, also Biceps");
    expect(valueLine(c({ primary: ["back", "glutes"] }), "muscles")).toBe("Back, Glutes");
    expect(valueLine(c(), "muscles")).toBeNull();
  });

  it("only spells out the reading when the equipment leaves it open", () => {
    expect(valueLine(c({ equipment: "stack" }), "equipment")).toBe("Selectorized Machine");
    expect(valueLine(c({ equipment: "dumbbell", counted: "each_hand" }), "equipment")).toBe("Dumbbells");
    expect(valueLine(c({ equipment: "dumbbell", counted: "total" }), "equipment")).toBe("Dumbbells, The Whole Load");
  });

  it("names the machine when it has been named", () => {
    expect(identityLine(c())).toBeNull();
    expect(identityLine(c({ gym: "Home", machineId: "3" }))).toBe("Home, 3");
  });

  it("nags about muscles and nothing else", () => {
    expect(needsMuscles(c())).toBe(true);
    expect(needsMuscles(c({ secondary: ["core"] }))).toBe(true);
    expect(needsMuscles(c({ primary: ["chest"] }))).toBe(false);
  });

  it("knows when there is nothing worth storing", () => {
    expect(isBlank(c())).toBe(true);
    expect(isBlank(c({ tags: ["x"] }))).toBe(false);
    expect(isBlank(c({ archived: true }))).toBe(false);
  });

  it("speaks the old flat list for anything still reading it", () => {
    expect(muscleListOf(c({ primary: ["back", "glutes"], secondary: ["core"] }))).toEqual(["back", "glutes", "core"]);
  });
});

describe("the scope window", () => {
  it("is all records by default", () => {
    expect(scopeOf(c())).toBe("all");
    expect(coversDate(c(), "1999-01-01")).toBe(true);
  });

  it("stamps one end only, never both", () => {
    const future = withScope(c({ until: "2020-01-01" }), "future", "2026-09-14");
    expect(future.from).toBe("2026-09-14");
    expect(future.until).toBeUndefined();
    const existing = withScope(future, "existing", "2026-09-14");
    expect(existing.until).toBe("2026-09-14");
    expect(existing.from).toBeUndefined();
    const all = withScope(existing, "all", "2026-09-14");
    expect("from" in all).toBe(false);
    expect("until" in all).toBe(false);
  });

  it("excludes records outside the window", () => {
    const fut = withScope(c({ primary: ["chest"] }), "future", "2026-09-14");
    expect(coversDate(fut, "2026-09-13")).toBe(false);
    expect(coversDate(fut, "2026-09-14")).toBe(true);
    const old = withScope(c({ primary: ["chest"] }), "existing", "2026-09-14");
    expect(coversDate(old, "2026-09-15")).toBe(false);
    expect(coversDate(old, "2026-09-14")).toBe(true);
  });
});

describe("planBatch: Add, Replace and Clear are three different verbs", () => {
  const rows = [{ key: "a", name: "Bench" }, { key: "b", name: "Row" }];
  const store: ClassStore = {
    a: c({ primary: ["chest"], equipment: "barbell", tags: ["comp"] }),
    b: c({ primary: ["back"], movement: "pull_h" }),
  };

  it("adds without losing what is there", () => {
    const plan = planBatch(store, rows, "secondary", "add", ["core"]);
    expect(plan.next.a!.primary).toEqual(["chest"]);
    expect(plan.next.a!.secondary).toEqual(["core"]);
    expect(plan.next.b!.secondary).toEqual(["core"]);
    expect(plan.changes).toHaveLength(2);
  });

  it("replaces only the field it names", () => {
    const plan = planBatch(store, rows, "primary", "replace", ["quads"]);
    expect(plan.next.a!.primary).toEqual(["quads"]);
    expect(plan.next.a!.equipment).toBe("barbell");
    expect(plan.next.a!.tags).toEqual(["comp"]);
    expect(plan.next.b!.movement).toBe("pull_h");
  });

  it("clears only the field it names", () => {
    const plan = planBatch(store, rows, "primary", "clear", []);
    expect(plan.next.a!.primary).toEqual([]);
    expect(plan.next.a!.equipment).toBe("barbell");
  });

  it("counts an exercise that already says it as unchanged, not as a change", () => {
    const plan = planBatch(store, rows, "primary", "replace", ["chest"]);
    expect(plan.changes.map((x) => x.key)).toEqual(["b"]);
    expect(plan.unchanged).toBe(1);
  });

  it("carries a before and an after for the preview", () => {
    const plan = planBatch(store, rows, "primary", "replace", ["quads"]);
    expect(plan.changes[0]).toMatchObject({ name: "Bench", before: "Chest", after: "Quads" });
  });

  it("never leaves a reading that the new equipment cannot take", () => {
    const withHand: ClassStore = { a: c({ equipment: "dumbbell", counted: "each_hand" }) };
    const plan = planBatch(withHand, [{ key: "a", name: "Curl" }], "equipment", "replace", ["stack"]);
    expect(plan.next.a!.equipment).toBe("stack");
    expect(plan.next.a!.counted).toBe("total");
  });

  it("promoting a muscle to primary takes it out of secondary", () => {
    const both: ClassStore = { a: c({ primary: ["back"], secondary: ["biceps"] }) };
    const plan = planBatch(both, [{ key: "a", name: "Row" }], "primary", "add", ["biceps"]);
    expect(plan.next.a!.primary).toEqual(["back", "biceps"]);
    expect(plan.next.a!.secondary).toEqual([]);
  });

  it("deletes a classification a batch emptied rather than storing an empty one", () => {
    const only: ClassStore = { a: c({ primary: ["chest"] }) };
    const plan = planBatch(only, [{ key: "a", name: "Bench" }], "primary", "clear", []);
    expect(plan.next.a).toBeUndefined();
  });
});

describe("classConflicts and mergeClass", () => {
  const keep = c({ primary: ["chest"], equipment: "barbell", movement: "push_h", tags: ["comp"] });
  const fold = c({ primary: ["shoulders"], equipment: "smith", type: "strength", tags: ["rehab"], machineName: "Rack 2" });

  it("only calls it a conflict when both sides answered differently", () => {
    const got = classConflicts(keep, fold);
    expect(got.map((x) => x.field).sort()).toEqual(["equipment", "primary"]);
    // Only fold answered Type, so it is not a question, it is the answer.
    expect(got.find((x) => x.field === "type")).toBeUndefined();
  });

  it("keeps the survivor's answers and fills its blanks from the other", () => {
    const got = mergeClass(keep, fold);
    expect(got.primary).toEqual(["chest"]);
    expect(got.equipment).toBe("barbell");
    expect(got.movement).toBe("push_h");
    expect(got.type).toBe("strength");
    expect(got.machineName).toBe("Rack 2");
  });

  it("unions the tags, because neither copy of a tag is wrong", () => {
    expect(mergeClass(keep, fold).tags.sort()).toEqual(["comp", "rehab"]);
  });

  it("takes the folded answer for a field resolved that way in the review", () => {
    const got = mergeClass(keep, fold, ["equipment", "primary"]);
    expect(got.equipment).toBe("smith");
    expect(got.primary).toEqual(["shoulders"]);
  });
});
