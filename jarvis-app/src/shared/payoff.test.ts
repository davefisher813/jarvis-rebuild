import { describe, it, expect } from "vitest";
import { payoffLine } from "./Payoff";

describe("payoff receipt", () => {
  it("says nothing when there is nothing true to say", () => {
    expect(payoffLine({})).toBe("");
    expect(payoffLine({ tasksDone: 0, projectsDone: 0 })).toBe("");
    expect(payoffLine({ days: 40 })).toBe(""); // time alone is not an accomplishment
  });

  it("counts real finished work", () => {
    // Casing sweep 1 (2026-09-26): Title Case by the whole rule (§H2), units spelled "Min".
    expect(payoffLine({ tasksDone: 1 })).toBe("1 Task");
    expect(payoffLine({ tasksDone: 14 })).toBe("14 Tasks");
    expect(payoffLine({ projectsDone: 3, tasksDone: 22 })).toBe("3 Projects and 22 Tasks");
  });

  it("adds the span only when there is work to attach it to", () => {
    expect(payoffLine({ tasksDone: 9, days: 62 })).toBe("9 Tasks Over 62 Days");
    expect(payoffLine({ tasksDone: 9, days: 1 })).toBe("9 Tasks Over 1 Day");
    expect(payoffLine({ tasksDone: 9, days: 0 })).toBe("9 Tasks");
  });

  it("never praises, compares, or mentions streaks", () => {
    const line = payoffLine({ projectsDone: 2, tasksDone: 30, days: 90 }).toLowerCase();
    for (const w of ["great", "amazing", "streak", "record", "faster", "better", "than"]) {
      expect(line).not.toContain(w);
    }
  });
});
