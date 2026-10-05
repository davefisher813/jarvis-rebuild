import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The initials the flow hands the bar: letters from the name, and nothing at all when there is no name. A source read,
// because the expression is a one-liner inside a 4,000-line component; the DOM half is TodayPage.test.tsx.
describe("TodayFlow initials", () => {
  const src = readFileSync(join(__dirname, "TodayFlow.tsx"), "utf8");
  it("has no invented fallback letters", () => {
    expect(src).not.toMatch(/\|\|\s*"JV"/);
    expect(src).toMatch(/const initials = name\.trim\(\)/);
  });
});
