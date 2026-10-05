// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// THE STYLESHEET HALF OF THE 2026-10-05 REVIEW (Email, More, the report, the profile sheets). Each rule below is one
// property a screenshot caught that no component test can see in jsdom (jsdom paints no CSS), so it is pinned where it
// lives: in the rule's own body. Each assertion fails on the stylesheet as it stood before the review.

const STYLES = join(__dirname, "..", "styles");
const read = (f: string) => readFileSync(join(STYLES, f), "utf8");
const COMP = read("components.css");
const MAIL = read("mail-rows.css");
const RULED = read("ruled.css");

/** The body of the FIRST rule whose selector list is exactly `sel` (comments stripped so prose cannot match). */
function body(css: string, sel: string): string {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp("(?:^|\\})\\s*" + esc + "\\s*\\{([^}]*)\\}").exec(bare);
  if (!m) throw new Error("no rule for " + sel);
  return m[1]!;
}

describe("Email rows", () => {
  it("a deadline is plain amber text in the time's slot, never a filled capsule inside a row", () => {
    const due = body(MAIL, ".mdue");
    expect(due).not.toMatch(/border-radius/);
    expect(due).toMatch(/background:\s*none/);
    expect(due).toMatch(/color:\s*var\(--warn\)/);
    // The same letterform as the time it replaces, so the right edge of a list is one kind of element.
    expect(due).toMatch(/text-transform:\s*uppercase/);
    expect(body(MAIL, ".mdue.soft")).not.toMatch(/background/);
  });

  it("the subject under a bold sender is the row's regular-weight subtext, so the sender leads", () => {
    expect(body(MAIL, ".mline2.strong")).toMatch(/font-weight:\s*var\(--w-sub\)/);
    expect(body(MAIL, ".mfrom.strong")).toMatch(/font-weight:\s*var\(--w-bold\)/);
  });

  it("the view row is a quiet tab row: transparent, a 44px box, the ink's underline on the one that is on", () => {
    expect(COMP).toMatch(/\.msg-views > \.chip \{[^}]*background-color:\s*transparent/);
    expect(COMP).toMatch(/\.msg-views > \.chip \{[^}]*min-height:\s*var\(--tap-min\)/);
    expect(COMP).toMatch(/\.msg-views > \.chip\.on::before \{[^}]*background:\s*var\(--tx-1\)/);
  });

  it("the outcome switch's count is the label's own ink at the caption size, never faded with opacity", () => {
    const rule = body(RULED, ".ruled .seg-n");
    expect(rule).not.toMatch(/opacity/);
    expect(rule).toMatch(/font-size:\s*var\(--t-caption\)/);
  });

  it("a head's own estimate is a sky fact, not grey caps", () => {
    const rule = body(COMP, ".sh2 .n.fact.est");
    expect(rule).toMatch(/color:\s*var\(--est-ink\)/);
    expect(rule).toMatch(/text-transform:\s*none/);
  });
});

describe("Tiles and rows", () => {
  it("a tile's glyph wears its fill's own on-colour: black on the light fills, white only on the three dark light-theme slots", () => {
    expect(COMP).toMatch(/\.row-ico\[class\*="cat-bg-"\]:not\(\.cat-bg-brand\) \{ color: var\(--on-fill-dark\); \}/);
    expect(COMP).toMatch(/\[data-theme="light"\] \.row-ico\.cat-bg-purple[^{]*\{ color: #FFFFFF; \}/);
  });

  it("a nav card's row name wears the row-title numbers (16, 700), not the 20 of a card title (More and Settings rows)", () => {
    const rule = body(RULED, ".ruled .nav-card > .lib-row .lib-name");
    expect(rule).toMatch(/font-size:\s*var\(--t-name\)/);
    expect(rule).toMatch(/font-weight:\s*var\(--w-name\)/);
  });

  it("a typed value in a well reads as a field: left-aligned", () => {
    expect(body(RULED, ".ruled .set-field.set-field-well")).toMatch(/text-align:\s*left/);
  });
});

describe("The report and the sheets", () => {
  it("a win's value is pinned to the tile's floor so two tiles of different name length share a baseline", () => {
    expect(body(COMP, ".rep-win")).toMatch(/display:\s*flex/);
    expect(body(COMP, ".rep-win")).toMatch(/flex-direction:\s*column/);
    expect(body(COMP, ".rep-win-val")).toMatch(/margin-top:\s*auto/);
  });

  it("the Cancel card of an action sheet clears the home indicator", () => {
    expect(COMP).toMatch(/\.sheet-scrim > \.card \+ \.card \{ padding-bottom: max\(var\(--s-2\), env\(safe-area-inset-bottom/);
  });
});
