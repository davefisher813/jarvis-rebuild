import { describe, it, expect } from "vitest";
import { ageRuleFacts, isVerdictFree, NATA_SOURCE } from "./ageRule";

describe("ageRuleFacts", () => {
  it("returns one fact per NATA figure, each citing the source", () => {
    const facts = ageRuleFacts({ ageYears: 15, weeklyHours: 12, monthsInSeason: 9, daysOffPerWeek: 1 });
    expect(facts).toHaveLength(3);
    for (const f of facts) expect(f.source).toBe(NATA_SOURCE);
  });

  it("states the actual numbers handed in", () => {
    const facts = ageRuleFacts({ ageYears: 15, weeklyHours: 12, monthsInSeason: 9, daysOffPerWeek: 1 });
    expect(facts.map((f) => f.value).join(" ")).toMatch(/12/);
    expect(facts.map((f) => f.value).join(" ")).toMatch(/15/);
    expect(facts.map((f) => f.value).join(" ")).toMatch(/9/);
  });

  it("is never a verdict, at any input, including numbers past NATA's own figures", () => {
    const facts = ageRuleFacts({ ageYears: 12, weeklyHours: 30, monthsInSeason: 12, daysOffPerWeek: 0 });
    expect(isVerdictFree(facts)).toBe(true);
    for (const f of facts) {
      expect(f.value + " " + f.label).not.toMatch(/too much|overtraining|excessive|dangerous|unsafe/i);
    }
  });
});
