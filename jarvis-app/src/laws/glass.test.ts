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

// DARK POLISH (Dave 2026-10-05): "I don't want any other colors in there.
// The black and red and white are the Jarvis colors." The dark file is held
// to the same structural promises, and to that palette.
const dcss = readFileSync(join(SRC, "styles/glass-dark.css"), "utf8");
const dNoComments = dcss.replace(/\/\*[\s\S]*?\*\//g, "");
const dRules = [...dNoComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));

describe("glass-dark.css", () => {
  it("is imported by the app", () => {
    expect(readFileSync(join(SRC, "main.tsx"), "utf8")).toMatch(/styles\/glass-dark\.css/);
  });
  it("is dark only: every selector sits under html[data-theme=\"dark\"]", () => {
    for (const r of dRules) {
      if (r.sel.startsWith("@")) continue;
      for (const s of r.sel.split(",").map((x) => x.trim())) {
        expect(s, `selector escapes the dark theme: ${s}`).toMatch(/^html\[data-theme="dark"\]/);
      }
    }
  });
  it("is black, red and white only: every literal colour is a neutral, the red comes from the token", () => {
    expect(dNoComments).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    for (const m of dNoComments.matchAll(/rgba?\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})/g)) {
      const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
      expect(Math.max(r, g, b) - Math.min(r, g, b), `a colour crept in: ${r},${g},${b}`).toBeLessThanOrEqual(6);
    }
    for (const m of dNoComments.matchAll(/color-mix\(in srgb, ([^ ,]+)/g)) expect(m[1]).toBe("var(--accent-fill)");
  });
  it("blurs only the sheet, never a card, chip or the dock", () => {
    for (const r of dRules) {
      if (!/backdrop-filter:\s*(?!none\b)[a-z]/.test(r.body)) continue;
      expect(r.sel, "backdrop-filter on something other than the sheet").toMatch(/sheet-scrim/);
    }
  });
  it("keeps the tab bar docked and nothing on a card repositioned", () => {
    for (const r of dRules) {
      if (/\.tab-bar/.test(r.sel)) expect(r.body).not.toMatch(/margin|border-radius|position/);
      if (/\.card\b/.test(r.sel) && !/sheet-scrim/.test(r.sel)) expect(r.body).not.toMatch(/position\s*:|z-index\s*:/);
    }
  });
  it("does not replay an entrance on screen open, and leaves the TV guide alone", () => {
    expect(dNoComments).not.toMatch(/animation\s*:|@keyframes/);
    expect(dcss).not.toMatch(/sched-ticker/);
    expect(dcss.includes(String.fromCharCode(0x2014))).toBe(false);
  });
});

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

// THE DOUBLED PILL (Dave 2026-10-05, on the preview: "it looks like there's a
// bug ... they're overlapping the old ones"). .pill-act paints at 34px and
// takes taps across 44px with transparent borders and background-clip:
// padding-box. A `background` shorthand resets the clip and an outer
// box-shadow draws around the 44px box; both drew a second pill. These hold
// the fix, and the promise that the finish is the same on every button.
describe("the button finish", () => {
  const files = { light: rules, dark: dRules };
  const sels = (rs: typeof rules, test: (body: string) => boolean) =>
    rs.filter((r) => !r.sel.startsWith("@") && test(r.body)).flatMap((r) => r.sel.split(",").map((s) => s.trim().replace(/^html\[data-theme="\w+"\]\s*/, "")));

  it("never fills a .pill-act with the background shorthand, and never draws outside it with an outer box-shadow", () => {
    for (const [name, rs] of Object.entries(files)) {
      for (const r of rs) {
        if (!/\.pill-act/.test(r.sel)) continue;
        expect(r.body, `${name}: background shorthand on ${r.sel}`).not.toMatch(/(^|[;\s])background\s*:/);
        const shadow = r.body.match(/box-shadow\s*:\s*([^;]+)/)?.[1];
        if (shadow && shadow.trim() !== "none") {
          for (const part of shadow.split(/,(?![^(]*\))/)) expect(part, `${name}: outer shadow on ${r.sel}`).toMatch(/inset/);
        }
        if (/background-image/.test(r.body)) expect(r.body, `${name}: clip not restated on ${r.sel}`).toMatch(/background-clip:\s*padding-box/);
      }
    }
  });

  it("gives the red family and the quiet family the same members in both themes, except the two that already differ by theme", () => {
    const red = (rs: typeof rules) => new Set(sels(rs, (b) => /background-color:\s*var\(--accent-fill\)/.test(b)));
    const quiet = (rs: typeof rules) => new Set(sels(rs, (b) => /background-image/.test(b) && /filter:\s*drop-shadow/.test(b) && !/--accent-fill/.test(b)));
    const perTheme = new Set([".row-act", ".ruled .card .row.row-act", ".ruled .h-hero .pill-act"]);
    const same = (a: Set<string>, b: Set<string>) => [...a].filter((x) => !perTheme.has(x) && !b.has(x));
    expect(same(red(rules), red(dRules)), "red in light but not dark").toEqual([]);
    expect(same(red(dRules), red(rules)), "red in dark but not light").toEqual([]);
    expect(same(quiet(rules), quiet(dRules)), "capsule in light but not dark").toEqual([]);
    expect(same(quiet(dRules), quiet(rules)), "capsule in dark but not light").toEqual([]);
    for (const must of [".pill-act.pill-go", ".btn-primary", ".plan-cta:not(.plan-cta-ghost)", ".hdr-controls .tasks-focus"]) expect(red(rules).has(must), must).toBe(true);
    for (const must of [".pill-act:not(.pill-go)", ".see-all.pill-action", ".btn-secondary", ".quiet-action", ".plan-cta.plan-cta-ghost"]) expect(quiet(rules).has(must), must).toBe(true);
    expect(red(rules).has(".row-act") && quiet(dRules).has(".row-act"), "Focus: red in light, capsule in dark").toBe(true);
  });

  it("puts no ring on a capsule (§AL: a fill and no ring)", () => {
    for (const [name, rs] of Object.entries(files)) {
      for (const r of rs) {
        if (!/filter:\s*drop-shadow/.test(r.body) || /--accent-fill/.test(r.body)) continue;
        expect(r.body, `${name}: ring on ${r.sel}`).not.toMatch(/(^|,)\s*0 0 0 [\d.]+px/);
      }
    }
  });

  it("leaves the swipe rail alone: Dismiss is not a capsule", () => {
    expect(noComments).not.toMatch(/notice-dismiss/);
    expect(dNoComments).not.toMatch(/notice-dismiss/);
  });

  it("never paints a stepped-down (ghost) button red: it keeps its grey and its ink (Dave 2026-10-05: no red with black text)", () => {
    for (const [name, rs] of Object.entries(files)) {
      for (const r of rs) {
        if (!/accent-fill/.test(r.body) || !/background-color/.test(r.body)) continue;
        for (const sel of r.sel.split(",").map((x) => x.trim())) {
          if (/ghost/.test(sel.replace(/:not\([^)]*ghost[^)]*\)/g, ""))) expect(false, `${name}: ghost painted red by ${sel}`).toBe(true);
          if (/^html\[data-theme="\w+"\] \.plan-cta$/.test(sel)) expect(false, `${name}: bare .plan-cta in the red family (must exclude the ghost): ${sel}`).toBe(true);
        }
      }
    }
  });
});
