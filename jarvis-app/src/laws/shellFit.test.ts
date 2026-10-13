import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// THE SHELL IS THE SCREEN'S HEIGHT, NEVER A SHORT BOX (Dave 2026-10-13, tab bar rebuild; issue 110).
//
// iOS 26 home-screen apps (viewport-fit=cover, black-translucent status bar) report 100%, 100svh,
// 100dvh and the layout viewport short by the top inset, about 59pt, and paint fixed content only
// inside that short box. A shell sized to it put the bar 82pt above the foot (rounds 1 to 3); round
// 4 stretched the shell past it in JavaScript and iOS clipped the bar to slivers. The answer is
// --app-h: the large viewport in a home-screen launch on iOS, 100dvh everywhere else, and a shell
// that is top-anchored with that height. This holds every part, because a harness frame the shell
// always fills cannot see any of it go wrong.
const STYLES = join(__dirname, "..", "styles");
const files = readdirSync(STYLES).filter((f) => f.endsWith(".css"));
const sheets = files.map((f) => ({ f, css: readFileSync(join(STYLES, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "") }));
const rules = sheets.flatMap(({ f, css }) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ f, sel: m[1]!.trim(), body: m[2]! })),
);
const shellRules = rules.filter((r) => r.sel.split(",").some((s) => s.trim().endsWith(".app-shell")));
const appH = rules.flatMap((r) => [...r.body.matchAll(/--app-h\s*:\s*([^;]+);?/g)].map((m) => ({ sel: r.sel, v: m[1]!.trim() })));

describe("the shell is the screen's height", () => {
  it("the shell is fixed, top-anchored and sized by --app-h, with no bottom edge to land short", () => {
    const pinned = shellRules.filter((r) => /position\s*:\s*fixed/.test(r.body) && /(^|;)\s*top\s*:\s*0/.test(r.body) && /(^|;)\s*height\s*:\s*var\(--app-h\)/.test(r.body));
    expect(pinned.length).toBeGreaterThan(0);
    for (const r of shellRules) {
      expect(r.body, `${r.f}: .app-shell may not be anchored to the short bottom edge`).not.toMatch(/(^|;)\s*(inset|bottom)\s*:/);
      expect(r.body, `${r.f}: .app-shell sizes itself from --app-h only`).not.toMatch(/(^|;)\s*height\s*:\s*[^;]*\b(100vh|100dvh|100svh|100lvh|100%)/);
      expect(r.body, `${r.f}: .app-shell position may only ever be fixed`).not.toMatch(/position\s*:\s*(relative|absolute|static|sticky)/);
    }
  });

  it("--app-h is 100dvh by default and the capped large viewport in a home-screen launch", () => {
    expect(appH.find((d) => d.sel === ":root" && d.v === "100dvh")).toBeTruthy();
    const full = "min(100lvh, calc(100dvh + env(safe-area-inset-top, 0px)))";
    expect(appH.find((d) => d.sel === "html.ios-standalone")?.v).toBe(full);
    expect(appH.filter((d) => d.v === full).length).toBeGreaterThanOrEqual(2);
    // The document is that tall too: iOS pins fixed content to the document's end.
    expect(rules.some((r) => /html\.ios-standalone body/.test(r.sel) && /min-height\s*:\s*var\(--app-h\)/.test(r.body))).toBe(true);
  });

  it("the bar is never squeezed by the column", () => {
    expect(rules.some((r) => /\.app-shell\s*>\s*\.tab-bar/.test(r.sel) && /flex-shrink\s*:\s*0/.test(r.body))).toBe(true);
  });

  it("no script measures and stretches the shell again, and the home-screen mark is wired at boot", () => {
    const viewport = readFileSync(join(__dirname, "..", "shared", "viewport.ts"), "utf8");
    const main = readFileSync(join(__dirname, "..", "main.tsx"), "utf8");
    expect(viewport).not.toMatch(/fitShellToScreen|screen\.height/);
    expect(main).toMatch(/markStandalone\(\)/);
  });

  it("the home-screen mark is set before first paint, by an inline script in the page's head", () => {
    const html = readFileSync(join(__dirname, "..", "..", "index.html"), "utf8");
    const head = html.slice(0, html.indexOf("</head>"));
    expect(head).toMatch(/<script>[\s\S]*classList\.add\("ios-standalone"\)[\s\S]*<\/script>/);
  });
});
