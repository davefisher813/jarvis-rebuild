import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// PEARL GLASS (Dave 2026-10-05): "I like the pearl effect", haze Sunrise,
// finish Ultimate. The look lives in one file and these are the promises it
// makes, held where a later edit cannot drift past them quietly.
const SRC = join(__dirname, "..");
const css = readFileSync(join(SRC, "styles/glass-light.css"), "utf8");
const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [...noComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));

describe("glass-light.css", () => {
  it("is imported by the app", () => {
    expect(readFileSync(join(SRC, "main.tsx"), "utf8")).toMatch(/styles\/glass-light\.css/);
  });

  it("is light only: every selector sits under html[data-theme=\"light\"]", () => {
    for (const r of rules) {
      if (r.sel.startsWith("@")) continue;
      for (const s of r.sel.split(",").map((x) => x.trim())) {
        expect(s, `selector escapes the light theme: ${s}`).toMatch(/^html\[data-theme="light"\]/);
      }
    }
  });

  it("has no purple: no violet, lilac or purple, and no hue that leans blue-violet", () => {
    expect(noComments).not.toMatch(/violet|lilac|purple|lavender/i);
    // r,g,b triplets and rgba() literals: purple is blue high, red above green.
    for (const m of noComments.matchAll(/(\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})/g)) {
      const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (r > 255 || g > 255 || b > 255) continue;
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      if (sat < 40) continue; // greys and near-whites
      expect(b > r && b > g && r > g, `purple-leaning colour ${r},${g},${b}`).toBe(false);
    }
  });

  it("blurs only where content really passes under glass: the sheet, never a card or chip", () => {
    for (const r of rules) {
      if (!/backdrop-filter/.test(r.body)) continue;
      expect(r.sel, "backdrop-filter on something other than the sheet").toMatch(/sheet-scrim/);
    }
  });

  it("does not replay an entrance on every screen open (Dave 2026-07-29: cards re-animating on a tab switch read as jank)", () => {
    expect(noComments).not.toMatch(/animation\s*:/);
    expect(noComments).not.toMatch(/@keyframes/);
  });

  it("keeps the cards the grey they were: the pane is a grey wash, never white or tinted", () => {
    const pane = css.match(/--gl-pane:\s*([^;]+);/)![1]!;
    for (const m of pane.matchAll(/rgba\((\d+),\s*(\d+),\s*(\d+)/g)) {
      const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
      expect(Math.max(r, g, b) - Math.min(r, g, b), `pane tinted ${r},${g},${b}`).toBeLessThanOrEqual(8);
      expect(r, "pane lighter than the page").toBeLessThan(255);
    }
  });

  it("never moves anything that was placed: no position or z-index on a card", () => {
    for (const r of rules) {
      if (!/\.card\b/.test(r.sel) || /sheet-scrim/.test(r.sel)) continue;
      expect(r.body, `card rule repositions: ${r.sel}`).not.toMatch(/position\s*:|z-index\s*:/);
    }
  });

  it("leaves the frozen TV guide alone", () => {
    expect(css).not.toMatch(/sched-ticker/);
  });

  it("writes no em dash", () => {
    expect(css.includes(String.fromCharCode(0x2014))).toBe(false);
  });
});
