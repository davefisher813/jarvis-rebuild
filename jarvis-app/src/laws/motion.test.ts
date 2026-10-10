import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// LAW: THE MOTION VOCABULARY (Dave 2026-10-09, pass-off item 17). The reward
// moments "look terrible"; take them to "as high end of a feel as possible",
// never childish. The bar is Apple, Linear, Arc and Things 3: no stock
// confetti, no cartoon bounce, no generic praise popups, nothing over 500 ms.
//
// One vocabulary of durations and curves lives in jarvis-design-system.css
// (:root, ANIMATION TIMING and THE MOTION VOCABULARY), and this holds every
// stylesheet to it:
//   - every motion token is 500 ms or less, and no curve but the press
//     overshoots (the press's spring is Dave's own pick, pinned by
//     laws/warmPalette; on a .97 scale it moves under half a pixel)
//   - every animation and transition in the app's stylesheets runs 500 ms or
//     less, delay included; a loop that never ends (a spinner, a skeleton, the
//     TV guide) is an indicator, not a moment, and is not timed
//   - nothing swells: a keyframe that scales anything past 1.02 must fade it
//     out as it grows (an accent leaving the check), or it is a bounce
//   - the childish moments cannot come back by name
//   - the app's own Motion setting stills the whole app, as the phone's does
//
// EXCEPTIONS, each named with its reason. A new one needs Dave's word.
const LONG_OK: Record<string, string> = {
  rdyRowFocus: "Brain's landing highlight, a marker of where a tap landed and not a reward; Dave set 'gone in a second and a quarter' himself (2026-10-05) and brain/brainReview.test.tsx pins it. Raised with him under the 500 ms rule.",
};
const SWELL_OK: Record<string, string> = {
  "cf-pulse": "the gym conditioning clock's number arriving (.cf-num, .cf-lead); the gym screens belong to the workout rebuild running alongside this one. Raised for that build.",
};

const STYLES = join(__dirname, "..", "styles");
const SHEETS = readdirSync(STYLES).filter((f) => f.endsWith(".css"));
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const read = (f: string) => strip(readFileSync(join(STYLES, f), "utf8"));
const DS = read("jarvis-design-system.css");
const ROOT = DS.slice(DS.indexOf(":root"), DS.indexOf("}", DS.indexOf("--dur-fast")));

const tokenMs = (name: string): number => {
  const m = new RegExp(name + ":\\s*([\\d.]+)(m?s)").exec(ROOT);
  if (!m) return NaN;
  return Number(m[1]) * (m[2] === "s" ? 1000 : 1);
};
const timeMs = (w: string): number | null => {
  const tok = /^var\((--dur-[a-z-]+)(?:,\s*[\d.]+m?s)?\)$/.exec(w);
  if (tok) return tokenMs(tok[1]!);
  const m = /^([\d.]+)(m?s)$/.exec(w);
  return m ? Number(m[1]) * (m[2] === "s" ? 1000 : 1) : null;
};
// Split a declaration value on its top-level commas.
const layers = (v: string): string[] => {
  const out: string[] = []; let depth = 0; let cur = "";
  for (const ch of v) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch; }
  out.push(cur.trim());
  return out.filter(Boolean);
};
// A layer's words, with var(...) kept whole.
const words = (layer: string): string[] => layer.match(/var\([^)]*\)|cubic-bezier\([^)]*\)|[^\s]+/g) ?? [];

describe("LAW: the motion vocabulary", () => {
  it("has a vocabulary to hold the app to", () => {
    for (const t of ["--dur-fast", "--dur-normal", "--dur-slow", "--dur-press", "--dur-enter", "--dur-check", "--dur-swipe",
      "--dur-nav", "--dur-nav-back", "--dur-settle", "--dur-celebrate"]) {
      expect(tokenMs(t), t).toBeGreaterThan(0);
    }
    expect(ROOT).toContain("--ease-draw:");
  });

  it("every motion token is 500 ms or less", () => {
    const toks = [...ROOT.matchAll(/(--dur-[a-z-]+):\s*([\d.]+m?s)/g)];
    expect(toks.length).toBeGreaterThanOrEqual(11);
    for (const [, name, v] of toks) expect(timeMs(v!), name).toBeLessThanOrEqual(500);
  });

  it("no curve but the press overshoots, so nothing the app moves bounces", () => {
    const curves = [...ROOT.matchAll(/(--ease-[a-z-]+):\s*cubic-bezier\(([^)]*)\)/g)];
    expect(curves.length).toBeGreaterThanOrEqual(5);
    for (const [, name, args] of curves) {
      if (name === "--ease-press") continue;
      const [, y1, , y2] = args!.split(",").map((n) => Number(n.trim()));
      expect(y1, name).toBeGreaterThanOrEqual(0); expect(y1, name).toBeLessThanOrEqual(1);
      expect(y2, name).toBeGreaterThanOrEqual(0); expect(y2, name).toBeLessThanOrEqual(1);
    }
  });

  it("every animation and transition in the app's stylesheets is over by 500 ms", () => {
    const bad: string[] = [];
    for (const f of SHEETS) {
      const css = read(f).replace(/@keyframes[^{]+\{(?:[^{}]|\{[^}]*\})*\}/g, "");
      for (const m of css.matchAll(/(?<![-\w])(animation|transition)\s*:\s*([^;}]+)/g)) {
        for (const layer of layers(m[2]!)) {
          const w = words(layer);
          if (w[0] === "none" || w.includes("infinite")) continue;
          if (LONG_OK[w[0]!]) continue;
          const times = w.map(timeMs).filter((n): n is number => n !== null);
          const total = times.reduce((t, n) => t + n, 0);
          if (Number.isNaN(total) || total > 500) bad.push(`${f}: ${m[1]}: ${layer}`);
        }
      }
      for (const m of css.matchAll(/(?<![-\w])(animation|transition)-duration\s*:\s*([^;}]+)/g)) {
        for (const layer of layers(m[2]!)) {
          const n = timeMs(layer.replace(/\s*!important$/, ""));
          if (n === null || n > 500) bad.push(`${f}: ${m[1]}-duration: ${layer}`);
        }
      }
    }
    expect(bad, "a moment longer than 500 ms").toEqual([]);
  });

  it("nothing swells: a keyframe that grows anything past 1.02 fades it out as it grows", () => {
    const bad: string[] = [];
    for (const f of SHEETS) {
      for (const m of read(f).matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]|\{[^}]*\})*)\}/g)) {
        const [, name, body] = m;
        if (SWELL_OK[name!]) continue;
        const grows = [...body!.matchAll(/scale\(\s*([^)]+)\)/g)].some(([, v]) => {
          const n = Number(v!.split(",")[0]);
          return Number.isNaN(n) ? true : n > 1.02;
        });
        if (!grows) continue;
        const last = /(?:100%|to)\s*\{([^}]*)\}/.exec(body!)?.[1] ?? "";
        if (!/opacity:\s*0\b/.test(last)) bad.push(`${f}: @keyframes ${name}`);
      }
    }
    expect(bad, "a bounce: something swells and settles back").toEqual([]);
  });

  it("the childish moments cannot come back by name", () => {
    const gone = ["checkPop", "burstFly", "ringPop", "fbPulse", "cvSpark", "cvLift", "taskDoneFlash", "confetti"];
    for (const f of SHEETS) {
      const css = read(f);
      for (const g of gone) expect(css, `${f} brings back ${g}`).not.toMatch(new RegExp("\\b" + g + "\\b"));
    }
    const burst = readFileSync(join(__dirname, "..", "shared", "Burst.tsx"), "utf8");
    expect(burst, "the Burst throws no pieces").not.toMatch(/<i\s*\/>/);
  });

  it("a button gives once: the old transform press no longer stacks on the token press", () => {
    expect(read("components.css")).not.toMatch(/\.btn:active\s*\{\s*transform:\s*scale\(/);
  });

  it("the app's own Motion setting stills the whole app, the way the phone's does", () => {
    const rule = /html\[data-motion="reduce"\][^{]*\*::before[^{]*\{([^}]*)\}/.exec(DS)?.[1] ?? "";
    expect(rule).toMatch(/animation-duration:\s*0\.001ms !important/);
    expect(rule).toMatch(/transition-duration:\s*0\.001ms !important/);
    // and the TV guide is left to its own rules (CLAUDE.md, frozen)
    expect(DS).toMatch(/html\[data-motion="reduce"\] \*:not\(\.ticker-track\)/);
  });

  it("a swiped row glides home: the press rule that outranks each row's own transition carries the swipe settle", () => {
    expect(DS).toMatch(/\[role="button"\] \{\s*transition: scale var\(--dur-press\) var\(--ease-press\), background-color var\(--dur-fast\) var\(--ease-out\),\s*transform var\(--dur-swipe\) var\(--ease-spring\);/);
    expect(DS).toMatch(/\[role="button"\]:is\(\.swiping, \.dragging\) \{\s*transition: none;/);
  });
});
