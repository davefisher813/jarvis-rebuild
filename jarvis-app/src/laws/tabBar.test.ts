import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// THE TAB BAR'S FOOT NEVER READS THE PHONE'S INSET (Dave 2026-10-13, round 3; issue 110).
//
// "It's taking up way too much vertical space LOWER IT", three times. Round 1 capped the
// reported bottom inset at 30pt (still 38 to 44pt under the labels); round 2 used the inset
// less 18pt and was proven on an emulated 34pt inset, so on Dave's phone, which reports an
// inset far larger than the home indicator needs, the labels sat 65 to 70pt above the edge.
// Both derived the bar's foot from the one number the phone is free to get wrong. The foot is
// a fixed length now, and this holds it there: a render at 34pt cannot tell a fixed foot from a
// derived one, and that is exactly how it shipped wrong twice.
const STYLES = join(__dirname, "..", "styles");
const files = readdirSync(STYLES).filter((f) => f.endsWith(".css"));
const sheets = files.map((f) => ({ f, css: readFileSync(join(STYLES, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "") }));
const rules = sheets.flatMap(({ f, css }) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ f, sel: m[1]!.trim(), body: m[2]! })),
);
const READS_INSET = /env\(|safe-area|--safe-(top|bottom|left|right)\b/;

describe("the tab bar's foot is a fixed length", () => {
  it("has a rule to hold (the bar and its foot token both exist)", () => {
    expect(rules.filter((r) => /(^|[\s,])\.tab-bar\b/.test(r.sel) && /padding|margin/.test(r.body)).length).toBeGreaterThan(0);
    expect(rules.some((r) => /--tab-clear\s*:/.test(r.body))).toBe(true);
  });

  it("--tab-clear is a plain pixel length, not derived from the inset", () => {
    const defs = rules.flatMap((r) => [...r.body.matchAll(/--tab-clear\s*:\s*([^;]+);?/g)].map((m) => m[1]!.trim()));
    expect(defs.length).toBeGreaterThan(0);
    for (const d of defs) expect(d, `--tab-clear must be a fixed length, found: ${d}`).toMatch(/^\d+(\.\d+)?px$/);
  });

  it("no rule on .tab-bar reads env(), a safe-area name or a --safe-* token", () => {
    for (const r of rules) {
      if (!/\.tab-bar\b/.test(r.sel)) continue;
      expect(r.body, `${r.f}: ${r.sel} reads the phone's inset`).not.toMatch(READS_INSET);
    }
  });

  it("the foot spacing on the bar and the light capsule is built from --tab-clear alone", () => {
    const feet = rules.filter((r) => /(^|[\s,])(html\[data-theme="light"\]\s+)?\.tab-bar$/.test(r.sel.split(",").pop()!.trim()) && /(padding|margin)(-bottom)?\s*:/.test(r.body));
    expect(feet.length).toBeGreaterThan(0);
    const foot = feet.map((r) => r.body).join(";");
    expect(foot).toMatch(/--tab-clear/);
  });

  // THE DOCK JOINS THE ONE RADIUS SYSTEM (Dave 2026-10-19, ruling on the live audit: "round the dock corners like the cards"). The flush bar had
  // square top corners in dark while every card is 24; it takes the card radius on its top corners. The light capsule keeps --r-dock.
  it("the flush bar's top corners are the card radius, and the light capsule keeps its own", () => {
    const ds = readFileSync(join(STYLES, "jarvis-design-system.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const bar = /(?:^|\n)\.tab-bar \{[^}]*border-radius:\s*var\(--r-lg\) var\(--r-lg\) 0 0/.exec(ds);
    expect(bar, "the base .tab-bar rounds its top corners with the card radius").not.toBeNull();
    const light = readFileSync(join(STYLES, "glass-light.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(light).toMatch(/\.tab-bar \{[^}]*border-radius:\s*var\(--r-dock\)/);
  });
});
