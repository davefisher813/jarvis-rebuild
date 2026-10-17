import { describe, it, expect } from "vitest";
import { MUSCLE_GROUPS, MUSCLE_LABEL } from "../gym/muscles";
import { STARTER_EXERCISES, STARTER_MUSCLE_GROUPS, normalizeExerciseName } from "../gym/starterLibrary";

// ---------------------------------------------------------------------------
// LAW: THE PRELOADED EXERCISE LIBRARY NAMES THE MOVEMENT, NEVER THE EQUIPMENT
// (S9, Dave 2026-10-16).
//
// Equipment is a classification the athlete sets on an exercise (classify.ts
// `equipment`), not part of its name: "Bench Press" is one exercise whether
// it is loaded with a bar or a pair of dumbbells, and two names for one
// movement is the duplicate problem the library spends a whole review sheet
// undoing. So no starter name carries an equipment word, no starter entry
// carries an equipment tag, and every muscle a starter names is one of the
// twelve the app counts by.
//
// The list itself is empty until the approved catalog lands; this law holds
// the shape it must land in, and bites on the first name that breaks it.
// ---------------------------------------------------------------------------

const EQUIPMENT_WORDS = /\b(barbell|dumbbell|dumbbells|cable|cables|machine|kettlebell|kettlebells|free weight|free weights|band|bands|smith)\b/i;

describe("LAW: the starter library's names", () => {
  it("no starter name carries an equipment word", () => {
    const bad = STARTER_EXERCISES.filter((e) => EQUIPMENT_WORDS.test(e.name)).map((e) => e.name);
    expect(bad, "equipment is a classification, not a name").toEqual([]);
  });

  it("no starter entry carries an equipment tag", () => {
    const tagged = STARTER_EXERCISES.filter((e) => "equipment" in (e as object) || "tags" in (e as object)).map((e) => e.name);
    expect(tagged).toEqual([]);
  });

  it("every muscle a starter names is one of the app's twelve groups, and the twelve are exactly the app's", () => {
    expect([...STARTER_MUSCLE_GROUPS]).toEqual([...MUSCLE_GROUPS]);
    expect(MUSCLE_GROUPS.map((m) => MUSCLE_LABEL[m])).toEqual([
      "Chest", "Back", "Traps", "Shoulders", "Biceps", "Triceps", "Forearms", "Quads", "Hamstrings", "Glutes", "Calves", "Core",
    ]);
    for (const e of STARTER_EXERCISES) {
      expect(MUSCLE_GROUPS, `${e.name}: primary ${e.primary}`).toContain(e.primary);
      if (e.secondary) expect(MUSCLE_GROUPS, `${e.name}: secondary ${e.secondary}`).toContain(e.secondary);
      expect(e.secondary, `${e.name}: a muscle is primary or secondary, never both`).not.toBe(e.primary);
    }
  });

  it("no two starters share a name once spelling is folded", () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const e of STARTER_EXERCISES) {
      const k = normalizeExerciseName(e.name);
      if (seen.has(k)) dupes.push(`${seen.get(k)} / ${e.name}`);
      seen.set(k, e.name);
    }
    expect(dupes).toEqual([]);
  });

  it("the law bites: a planted equipment name fails it", () => {
    const planted = [{ name: "Barbell Bench Press", primary: "chest", secondary: null }, { name: "Cable Curl", primary: "biceps", secondary: null }];
    expect(planted.filter((e) => EQUIPMENT_WORDS.test(e.name))).toHaveLength(2);
    expect(normalizeExerciseName("  Bench-Press ")).toBe("bench press");
    expect(normalizeExerciseName("bench press")).toBe(normalizeExerciseName("Bench Press"));
  });
});
