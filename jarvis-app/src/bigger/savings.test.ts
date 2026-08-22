import { describe, it, expect } from "vitest";
import { savedTotal, savingsPct, savingsLine, savedNewestFirst } from "./savings";

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

  it("says honestly when nothing is saved yet", () => {
    expect(savingsLine(2000, [])).toBe("Nothing saved yet · Goal $2,000");
    expect(savingsLine(2000, undefined)).toBe("Nothing saved yet · Goal $2,000");
    expect(savingsLine(2000, entries)).toBe("$650 of $2,000 Saved");
  });

  it("lists receipts newest first without mutating the source", () => {
    const sorted = savedNewestFirst(entries);
    expect(sorted.map((e) => e.d)).toEqual(["2026-07-20", "2026-06-28", "2026-06-06"]);
    expect(entries[0]!.d).toBe("2026-06-06");
  });
});
