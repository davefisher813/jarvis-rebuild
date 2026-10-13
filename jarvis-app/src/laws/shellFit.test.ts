import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// THE SHELL IS NAILED TO THE VIEWPORT'S EDGES (Dave 2026-10-13, tab bar round 4;
// issue 110). Rounds 1 to 3 fixed the tab bar's foot three times and the bar
// never moved on Dave's phone, because the bar sits at the foot of .app-shell
// and the shell's height was a measurement (100dvh) that his phone reports
// short: the labels ended 82pt above the screen's foot while the bar's own
// foot was a fixed 16pt. A harness whose frame the shell always fills cannot
// see that gap, which is how it shipped wrong three times. The shell is
// position: fixed with inset: 0 now, so its edges are the viewport's edges,
// and shared/viewport.ts (fitShellToScreen) stretches it to the physical
// screen when a standalone window's layout viewport itself stops short.
// This holds both halves: nothing may quietly give the shell back a measured
// height or a lesser position, and the fit guard may not be unwired.
const STYLES = join(__dirname, "..", "styles");
const files = readdirSync(STYLES).filter((f) => f.endsWith(".css"));
const sheets = files.map((f) => ({ f, css: readFileSync(join(STYLES, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "") }));
const rules = sheets.flatMap(({ f, css }) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ f, sel: m[1]!.trim(), body: m[2]! })),
);
const shellRules = rules.filter((r) => r.sel.split(",").some((s) => s.trim().endsWith(".app-shell")));

describe("the shell is nailed to the viewport's edges", () => {
  it("has a rule to hold (the shell is positioned fixed, inset 0)", () => {
    const pinned = shellRules.filter((r) => /position\s*:\s*fixed/.test(r.body) && /inset\s*:\s*0/.test(r.body));
    expect(pinned.length).toBeGreaterThan(0);
  });

  it("no rule on .app-shell gives it back a measured height or a lesser position", () => {
    for (const r of shellRules) {
      expect(r.body, `${r.f}: .app-shell must not size itself from a viewport measurement`).not.toMatch(/height\s*:\s*[^;]*\b(100vh|100dvh|100svh|100lvh)\b/);
      expect(r.body, `${r.f}: .app-shell position may only ever be fixed`).not.toMatch(/position\s*:\s*(relative|absolute|static|sticky)/);
    }
  });

  it("the fit guard stays wired: standalone-only, screen-measured, called at boot", () => {
    const viewport = readFileSync(join(__dirname, "..", "shared", "viewport.ts"), "utf8");
    const main = readFileSync(join(__dirname, "..", "main.tsx"), "utf8");
    expect(viewport).toMatch(/export function fitShellToScreen/);
    expect(viewport).toMatch(/display-mode: standalone/);
    expect(viewport).toMatch(/screen\.height/);
    expect(main).toMatch(/fitShellToScreen\(\)/);
  });
});
