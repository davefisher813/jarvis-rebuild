import { describe, it, expect } from "vitest";
import { findDuplicates, normalizeName, pairId } from "./duplicates";
import type { LibraryRow } from "./libraryEdit";

const row = (name: string, over: Partial<LibraryRow> = {}): LibraryRow => ({
  key: over.key ?? name.toLowerCase(),
  name,
  kind: "weight_reps",
  sessions: 0,
  sets: 0,
  lastDate: null,
  firstDate: null,
  hidden: false,
  ...over,
});

const names = (rows: LibraryRow[]) =>
  findDuplicates(rows).map((d) => `${d.fold.name} -> ${d.keep.name}`);

describe("normalizeName", () => {
  it("folds case, punctuation, plurals and gym shorthand", () => {
    expect(normalizeName("DB Press")).toEqual(["dumbbell", "press"]);
    expect(normalizeName("Dumbbell presses")).toEqual(["dumbbell", "press"]);
    expect(normalizeName("Bench Press (Feet up)")).toEqual(["bench", "press", "feet", "up"]);
    expect(normalizeName("Lat Pull-Down")).toEqual(["lat", "pull", "down"]);
  });
});

describe("findDuplicates", () => {
  it("catches Dave's own case: bench and bench press", () => {
    expect(names([row("Bench"), row("Bench Press")])).toEqual(["Bench -> Bench Press"]);
  });

  it("catches the same name written two ways", () => {
    const pairs = findDuplicates([row("DB Press"), row("Dumbbell Press")]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.reason).toBe("same");
  });

  it("catches a typo", () => {
    const pairs = findDuplicates([row("Deadlift"), row("Deadlfit")]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.reason).toBe("typo");
  });

  // THE WHOLE SAFETY MARGIN. A false positive proposes welding two real
  // lifts together and rewriting every session either one appears in.
  it("refuses anything separated by a qualifying word", () => {
    expect(names([row("Bench Press"), row("Incline Bench Press")])).toEqual([]);
    expect(names([row("Squat"), row("Front Squat")])).toEqual([]);
    expect(names([row("Bench Press"), row("Close Grip Bench Press")])).toEqual([]);
    expect(names([row("Row"), row("Single Arm Row")])).toEqual([]);
    expect(names([row("Curl"), row("Reverse Curl")])).toEqual([]);
    expect(names([row("Press"), row("Overhead Press")])).toEqual([]);
    // Two genuinely different lifts that merely rhyme.
    expect(names([row("Squat"), row("Split Squat")])).toEqual([]);
  });

  it("never pairs lifts that log differently, because merge would refuse it", () => {
    expect(names([row("Plank"), row("Plank", { key: "p2", kind: "time_longer" })])).toEqual([]);
  });

  it("keeps the side with more history and folds the thinner one in", () => {
    const pairs = findDuplicates([
      row("Bench", { key: "a", sessions: 1 }),
      row("Bench Press", { key: "b", sessions: 9 }),
    ]);
    expect(pairs[0]!.keep.name).toBe("Bench Press");
    expect(pairs[0]!.fold.name).toBe("Bench");
  });

  it("stays quiet about a fork already reconciled by a rename or merge", () => {
    expect(names([row("Bench", { aliases: ["Bench Press"] }), row("Bench Press")])).toEqual([]);
  });

  it("stays quiet about a pair waved off, whichever order it comes in", () => {
    const rows = [row("Bench", { key: "a" }), row("Bench Press", { key: "b" })];
    expect(findDuplicates(rows, [pairId("b", "a")])).toEqual([]);
  });

  it("says nothing at all about a clean library", () => {
    expect(names([row("Bench Press"), row("Back Squat"), row("Deadlift")])).toEqual([]);
  });
});
