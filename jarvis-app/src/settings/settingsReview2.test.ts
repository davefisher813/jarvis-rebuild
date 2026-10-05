import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// THE SETTINGS REVIEW, SECOND PASS (2026-10-05, round 1, the settings list): what the screenshots showed that no class name can, held on the
// stylesheets the real components draw through. Each rule below failed in the capture before the line it asserts existed.

const read = (f: string) => readFileSync(join(__dirname, "../styles", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const body = (css: string, sel: string) =>
  [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => m[1]!.split(",").some((s) => s.trim() === sel)).map((m) => m[2]).join(" ");

describe("the note under a card belongs to the card above it", () => {
  const ruled = read("ruled.css");
  it("takes none of the 16px the generic block gap puts between two .pad-x blocks, so it sits 8px under its card", () => {
    expect(body(ruled, ".ruled .pad-x:has(> .card) + .pad-x:has(> .input-hint)")).toMatch(/margin-top:\s*0/);
    // It has to come after the generic rule, or it loses at the same specificity... and it outranks it besides.
    expect(ruled.indexOf(".ruled .pad-x:has(> .card) + .pad-x:has(> .input-hint)")).toBeGreaterThan(ruled.indexOf(".ruled .pad-x:has(> .card) + .pad-x {"));
    expect(body(ruled, ".ruled .pad-x > .input-hint")).toMatch(/margin-top:\s*var\(--s-2\)/);
  });
  it("leaves a clear 24 before the next head, so the note reads as the card's and not the next section's", () => {
    expect(body(ruled, ".ruled .pad-x:has(> .input-hint) + .sh2")).toMatch(/margin-top:\s*var\(--s-6\)/);
  });
});

describe("the note's own headings step down from its title", () => {
  it("a body heading one is 24 under a 34 title, so position is not the only thing that tells them apart", () => {
    const ed = read("editor.css");
    expect(body(ed, ".doc-write .doc-title")).toMatch(/font-size:\s*var\(--t-h1\)/);
    expect(body(ed, ".doc-write .doc-pm h1")).toMatch(/font-size:\s*calc\(24px \* var\(--type-scale\)\)/);
  });
});

describe("the toast is a card, not a slab", () => {
  const c = read("components.css");
  it("takes the page's 20px gutter, the one 24 radius and 12px of air above the dock", () => {
    expect(body(c, ".toast-dock")).toMatch(/padding:\s*0 var\(--s-4\) var\(--s-3\)/);
    expect(body(c, ".toast")).toMatch(/border-radius:\s*var\(--r-lg\)/);
    expect(body(c, ".toast")).toMatch(/padding:\s*var\(--s-3\) var\(--s-4\)/);
  });
});

describe("the small ones", () => {
  const c = read("components.css");
  it("an off plate wears a hairline so it reads against the card in dark as well as light", () => {
    expect(body(c, ".set-card .chip-wrap-row > .chip:not(.active)")).toMatch(/box-shadow:\s*inset 0 0 0 1px/);
  });
  it("an onboarding step that must wrap breaks evenly, never leaving 'Calendar' alone", () => {
    expect(body(c, ".ob-screen .card > .row > .row-grow > .conn-name")).toMatch(/text-wrap:\s*balance/);
  });
});
