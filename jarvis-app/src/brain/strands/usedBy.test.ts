import { describe, it, expect } from "vitest";
import { USED_BY, usedBy } from "./usedBy";
import { STRAND_CATEGORY_LABEL, type StrandCategory } from "./types";

describe("usedBy (C-43)", () => {
  it("every category names at least one surface, in Title Case, no sentences", () => {
    for (const c of Object.keys(STRAND_CATEGORY_LABEL) as StrandCategory[]) {
      const list = usedBy(c);
      expect(list.length, c).toBeGreaterThan(0);
      for (const s of list) expect(s).toMatch(/^[A-Z][A-Za-z]*( [A-Z][A-Za-z]*)*$/);
    }
  });
  it("says what the build master says", () => {
    expect(USED_BY.energy).toEqual(["Schedule", "Plan My Day", "Your Move"]);
    expect(USED_BY.writing).toEqual(["Email"]);
    expect(USED_BY.values).toEqual(["Your Move", "Schedule", "Decisions"]);
  });
});
