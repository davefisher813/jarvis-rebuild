import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setCategoryRegistry, goalTone } from "./categories";

// GOAL GLYPHS WEAR THE GOAL'S AREA (Dave 2026-08-31, Your Life screenshot:
// "the purple icons should be color coated based on category and default to
// Jarvis red"). One rule, one place: first tag naming a live category wins
// (the same rule Your Life files goals with, so glyph and section can never
// disagree); no home means brand red, never graphite -- graphite is what a
// DEAD tag used to leak, and a dead tag is exactly "no home".
describe("goalTone: category color, brand-red default", () => {
  it("homes by the first LIVE tag and speaks its color", () => {
    setCategoryRegistry([
      { id: "fam", name: "Family", color: "pink" },
      { id: "biz", name: "Ridgeley", color: "sky" },
    ]);
    expect(goalTone(["biz", "fam"])).toBe("cat-fg-sky");
    // A dead first tag does not steal the home from a live second one.
    expect(goalTone(["gone", "fam"])).toBe("cat-fg-pink");
  });

  it("defaults to brand red, and never to graphite, when nothing is live", () => {
    setCategoryRegistry([{ id: "fam", name: "Family", color: "pink" }]);
    expect(goalTone(undefined)).toBe("cat-fg-brand");
    expect(goalTone([])).toBe("cat-fg-brand");
    // The trap: catColor answers "graphite" for a dead id, and routing an
    // orphan through it would dress the orphan grey instead of brand red.
    expect(goalTone(["deleted-category-id"])).toBe("cat-fg-brand");
  });

  it("inherits the red-to-orange remap: a category never wears the alarm color", () => {
    setCategoryRegistry([{ id: "legacy", name: "Old Red", color: "red" }]);
    expect(goalTone(["legacy"])).toBe("cat-fg-orange");
  });

  it("every goal-glyph surface reads through goalTone; none hardcodes purple", () => {
    const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
    for (const p of ["bigger/BiggerPicturePage.tsx", "money/MoneyFlow.tsx"]) {
      expect(src(p)).toContain("goalTone(g.data.tags)");
      expect(src(p)).not.toMatch(/row-glyph cat-fg-purple/);
    }
    // Today's goal nudge card too (its OTHER purple cards -- revisit, the
    // monthly report -- are the reflective tone and stay purple on purpose).
    expect(src("today/TodayFlow.tsx")).toContain("goalTone(untouched.data.tags)");
    // And the brand fallback actually exists in the stylesheet, as glyph AND
    // as the fill NoticeCard derives by swapping fg for bg.
    const css = src("styles/components.css");
    expect(css).toMatch(/\.cat-fg-brand\s*\{\s*color:\s*var\(--accent-glyph\)/);
    expect(css).toMatch(/\.cat-bg-brand\s*\{\s*background:\s*var\(--accent-glyph\)/);
  });
});
