import { describe, it, expect } from "vitest";
import { savedTotal, savingsPct, savingsLine, savedNewestFirst, savedRows, editSavedAt, removeSavedAt } from "./savings";

// Money v1 savings: progress is derived from logged entries and nothing else.

describe("savings derivation", () => {
  const entries = [
    { d: "2026-06-06", amount: 200 },
    { d: "2026-07-20", amount: 150 },
    { d: "2026-06-28", amount: 300 },
  ];

  it("sums entries and caps the bar at 100", () => {
    expect(savedTotal(entries)).toBe(650);
    expect(savingsPct(2000, entries)).toBe(33);
    expect(savingsPct(500, entries)).toBe(100);
    expect(savingsPct(0, entries)).toBe(0);
  });

  // §AM F3 (2026-09-26): the zero reads in the same shape as any other
  // amount, with no middle dot typed into the line.
  it("says honestly when nothing is saved yet", () => {
    expect(savingsLine(2000, [])).toBe("$0 of $2,000 Saved");
    expect(savingsLine(2000, undefined)).toBe("$0 of $2,000 Saved");
    expect(savingsLine(2000, entries)).toBe("$650 of $2,000 Saved");
    expect(savingsLine(2000, [])).not.toContain("·");
  });

  it("lists receipts newest first without mutating the source", () => {
    const sorted = savedNewestFirst(entries);
    expect(sorted.map((e) => e.d)).toEqual(["2026-07-20", "2026-06-28", "2026-06-06"]);
    expect(entries[0]!.d).toBe("2026-06-06");
  });

  // Dave 2026-10-01: an entry can be corrected, so a row must name the exact
  // entry it is. Two $50s on one day are the same thing to everything but
  // their place in the stored list.
  it("rows carry their place in the stored list, same day newest logged first", () => {
    const two = [{ d: "2026-07-01", amount: 50 }, { d: "2026-07-01", amount: 75 }, { d: "2026-06-01", amount: 10 }];
    expect(savedRows(two).map((r) => r.index)).toEqual([1, 0, 2]);
  });

  it("editing changes one amount, keeps its day, and never touches the source", () => {
    const src = [{ d: "2026-07-01", amount: 50 }, { d: "2026-07-01", amount: 50 }];
    const next = editSavedAt(src, 1, 500)!;
    expect(next).toEqual([{ d: "2026-07-01", amount: 50 }, { d: "2026-07-01", amount: 500 }]);
    expect(src[1]!.amount).toBe(50);
    expect(savedTotal(next)).toBe(550);
  });

  it("a stale index or a bad amount writes nothing", () => {
    const src = [{ d: "2026-07-01", amount: 50 }];
    expect(editSavedAt(src, 3, 10)).toBeNull();
    expect(editSavedAt(src, -1, 10)).toBeNull();
    expect(editSavedAt(src, 0, 0)).toBeNull();
    expect(editSavedAt(src, 0, -5)).toBeNull();
    expect(editSavedAt(src, 0, Number.NaN)).toBeNull();
    expect(editSavedAt(undefined, 0, 10)).toBeNull();
    expect(removeSavedAt(src, 1)).toBeNull();
    expect(removeSavedAt(undefined, 0)).toBeNull();
  });

  it("removing drops exactly one entry and the total follows", () => {
    const src = [{ d: "2026-07-01", amount: 50 }, { d: "2026-07-01", amount: 50 }, { d: "2026-06-01", amount: 10 }];
    const next = removeSavedAt(src, 0)!;
    expect(next).toHaveLength(2);
    expect(savedTotal(next)).toBe(60);
    expect(src).toHaveLength(3);
    expect(removeSavedAt([{ d: "2026-07-01", amount: 50 }], 0)).toEqual([]);
  });
});
