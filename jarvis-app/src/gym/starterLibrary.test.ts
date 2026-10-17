import { describe, it, expect } from "vitest";
import { MUSCLE_GROUPS } from "./muscles";
import { STARTER_EXERCISES, normalizeExerciseName } from "./starterLibrary";

// THE PRELOADED CATALOG IS DAVE'S LIST, VERBATIM (S9, 2026-10-16): 111
// exercises under the app's twelve groups, each with zero to three
// secondaries. These hold the count, the groups and a handful of entries
// against the approved file, so a stray edit to the data cannot pass as a
// data change.

describe("the starter library is the approved catalog", () => {
  it("has exactly 111 entries", () => {
    expect(STARTER_EXERCISES).toHaveLength(111);
  });

  it("every primary is one of the twelve groups", () => {
    for (const e of STARTER_EXERCISES) expect(MUSCLE_GROUPS, e.name).toContain(e.primary);
  });

  it("every secondary is one of the twelve, never the primary, never repeated", () => {
    for (const e of STARTER_EXERCISES) {
      for (const m of e.secondary) {
        expect(MUSCLE_GROUPS, `${e.name}: ${m}`).toContain(m);
        expect(m, `${e.name}: secondary repeats primary`).not.toBe(e.primary);
      }
      expect(new Set(e.secondary).size, `${e.name}: duplicate secondary`).toBe(e.secondary.length);
      expect(e.secondary.length, `${e.name}: the catalog names at most three`).toBeLessThanOrEqual(3);
    }
  });

  it("no two entries share a name, exactly or once spelling is folded", () => {
    const names = STARTER_EXERCISES.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
    const folded = names.map(normalizeExerciseName);
    expect(new Set(folded).size).toBe(folded.length);
  });

  it("the twelve groups appear in the app's order and every group has at least one entry", () => {
    const order: string[] = [];
    for (const e of STARTER_EXERCISES) if (order[order.length - 1] !== e.primary) order.push(e.primary);
    expect(order).toEqual([...MUSCLE_GROUPS]);
  });

  it("spot checks against the file", () => {
    const by = new Map(STARTER_EXERCISES.map((e) => [e.name, e]));
    expect(by.get("Deadlift")).toEqual({ name: "Deadlift", primary: "back", secondary: ["glutes", "hamstrings", "forearms"] });
    expect(by.get("Lateral Raise")).toEqual({ name: "Lateral Raise", primary: "shoulders", secondary: [] });
    expect(by.get("Turkish Get-Up")).toEqual({ name: "Turkish Get-Up", primary: "core", secondary: ["shoulders", "glutes"] });
    expect(by.get("Shrug")).toEqual({ name: "Shrug", primary: "traps", secondary: ["forearms", "shoulders"] });
    expect(by.get("Medicine Ball Rotational Throw")).toEqual({ name: "Medicine Ball Rotational Throw", primary: "core", secondary: ["shoulders"] });
    // The group sizes as the file lists them.
    const count = (g: string) => STARTER_EXERCISES.filter((e) => e.primary === g).length;
    expect([count("chest"), count("back"), count("traps"), count("shoulders"), count("biceps"), count("triceps"),
      count("forearms"), count("quads"), count("hamstrings"), count("glutes"), count("calves"), count("core")])
      .toEqual([9, 16, 1, 11, 7, 7, 5, 18, 9, 5, 5, 18]);
  });
});
