import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A SHEET DRAWN INSIDE THE PAGE MUST NOT HAVE THE DOCK PAINT OVER ITS ACTIONS (live audit, 2026-10-19).
//
// The Brain's filed-entry sheet is rendered inline, inside .app-scroll's stacking layer, not portalled to the body. The dock is a later
// sibling at the same layer, so its lightning and search circles and its dark fade painted over the sheet's middle actions ("Edit",
// "Yes, Forget" drew as faint dark pills with no label) while only the Add Anything pill and the tab bar stepped aside. A scrim inside the
// scroller now hides the whole dock and the return pill, hidden and not removed so the page keeps its height.
const css = readFileSync(join(__dirname, "..", "styles", "uniformity.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("a sheet inside the page hides the dock", () => {
  it("hides the whole dock and the return pill under a scrim in the scroller", () => {
    const m = /body:has\(\.app-scroll \.sheet-scrim\)\s*:is\(([^)]*)\)\s*\{([^}]*)\}/.exec(css);
    expect(m, "the rule exists").not.toBeNull();
    expect(m![1]).toMatch(/\.voice-dock/);
    expect(m![1]).toMatch(/\.return-pill/);
    expect(m![2]).toMatch(/visibility:\s*hidden/);
    expect(m![2], "hidden, never removed: the page keeps its height").not.toMatch(/display:\s*none/);
  });
  it("keeps the older rule for the Add Anything pill and the tab bar", () => {
    expect(css).toMatch(/body:has\(\.sheet-scrim\) \.voice-bar[^{]*\.tab-bar[^{]*\{\s*visibility:\s*hidden/);
  });
});
