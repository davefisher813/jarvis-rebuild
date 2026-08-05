import { describe, it, expect } from "vitest";
import { payoffLine } from "./Payoff";

describe("payoff receipt", () => {
  it("says nothing when there is nothing true to say", () => {
    expect(payoffLine({})).toBe("");
    expect(payoffLine({ tasksDone: 0, projectsDone: 0 })).toBe("");
    expect(payoffLine({ days: 40 })).toBe(""); // time alone is not an accomplishment
  });

  it("counts real finished work", () => {
    expect(payoffLine({ tasksDone: 1 })).toBe("1 task.");
    expect(payoffLine({ tasksDone: 14 })).toBe("14 tasks.");
    expect(payoffLine({ projectsDone: 3, tasksDone: 22 })).toBe("3 projects and 22 tasks.");
  });

  it("adds the span only when there is work to attach it to", () => {
    expect(payoffLine({ tasksDone: 9, days: 62 })).toBe("9 tasks over 62 days.");
    expect(payoffLine({ tasksDone: 9, days: 1 })).toBe("9 tasks over 1 day.");
    expect(payoffLine({ tasksDone: 9, days: 0 })).toBe("9 tasks.");
  });

  it("never praises, compares, or mentions streaks", () => {
    const line = payoffLine({ projectsDone: 2, tasksDone: 30, days: 90 }).toLowerCase();
    for (const w of ["great", "amazing", "streak", "record", "faster", "better", "than"]) {
      expect(line).not.toContain(w);
    }
  });
});
