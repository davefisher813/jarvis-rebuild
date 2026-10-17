import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { posix } from "node:path";

// ---------------------------------------------------------------------------
// LAW: THE WORKOUT COLOUR CODE (Dave 2026-10-16, "like Apple Health").
//
// Every colour has ONE fixed meaning on every workout screen and is never
// decoration: RED is now and action (the Log button, the current set, Start);
// GREEN is done; AMBER is warm-up; BLUE is cool-down; PURPLE is a standing
// best; GOLD is a personal record and nothing else; TEAL is last time (the
// previous session's numbers). Everything else sits on the warm neutrals.
//
// Before this the Best chip was lime (it read as gold beside the PR), the
// current set was cyan (chosen in September over red, and overruled), the PR
// mark was lime, plates and drop sets and the guard were amber, and the light
// theme neutralised every chip so a meaning said in dark went unsaid in
// light. These assertions read the stylesheets, so a new workout screen
// inherits the code by inheriting the rules.
// ---------------------------------------------------------------------------

const { join } = posix;
const SRC = join(process.cwd().replace(/\\/g, "/"), "src");
const read = (f: string) => readFileSync(join(SRC, f), "utf8");
const RULED = read("styles/ruled.css").replace(/\/\*[\s\S]*?\*\//g, "");
const COMPONENTS = read("styles/components.css").replace(/\/\*[\s\S]*?\*\//g, "");
const TOKENS = read("styles/jarvis-design-system.css");

/** The body of the first rule whose selector list contains `sel` exactly (as one comma-separated selector). */
function body(css: string, sel: string): string {
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const sels = m[1]!.split(",").map((x) => x.replace(/\s+/g, " ").trim());
    if (sels.includes(sel)) return m[2]!;
  }
  throw new Error(`no rule for ${sel}`);
}
const colour = (css: string, sel: string) => /(^|[;\s])color:\s*([^;]+)/.exec(body(css, sel))?.[2]?.trim() ?? "";
const background = (css: string, sel: string) => /background(?:-color)?:\s*([^;]+)/.exec(body(css, sel))?.[1]?.trim() ?? "";

describe("LAW: the workout colour code", () => {
  it("the two meanings the ramp had no slot for have tokens in both themes, apart from the equipment violet", () => {
    const blocks = { dark: TOKENS.indexOf('[data-theme="dark"] {'), light: TOKENS.indexOf('[data-theme="light"] {') };
    for (const [theme, at] of Object.entries(blocks)) {
      expect(at, `${theme} block`).toBeGreaterThan(-1);
      const block = TOKENS.slice(at, TOKENS.indexOf("\n}", at));
      for (const t of ["--hl-best:", "--hl-best-tint:", "--hl-best-ink:", "--hl-gold:", "--hl-gold-tint:", "--hl-gold-ink:"]) {
        expect(block, `${theme} ${t}`).toContain(t);
      }
      const best = /--hl-best:\s*(#[0-9A-Fa-f]{6})/.exec(block)?.[1];
      const violet = /--hl-violet:\s*(#[0-9A-Fa-f]{6})/.exec(block)?.[1];
      expect(best, "best is its own purple, not the equipment violet").not.toBe(violet);
    }
  });

  it("BEST is purple: the standing best chip and fact", () => {
    expect(colour(RULED, ".ruled.health-ruled .se-chip-best")).toBe("var(--hl-best-ink)");
    expect(background(RULED, ".ruled.health-ruled .se-chip-best")).toBe("var(--hl-best-tint)");
    expect(colour(RULED, ".ruled.health-ruled .fact.best")).toBe("var(--hl-best-ink)");
    // And best no longer shares a rule with done.
    expect(RULED).not.toMatch(/\.se-chip-best,\s*\.ruled\.health-ruled \.se-chip-done/);
  });

  it("GOLD is a PR and nothing else: the PR mark, the PR count, the PR fact", () => {
    expect(background(RULED, ".ruled.health-ruled .se-pr")).toBe("var(--hl-gold)");
    expect(colour(RULED, ".ruled.health-ruled .se-chip-pr")).toBe("var(--hl-gold-ink)");
    expect(colour(RULED, ".ruled.health-ruled .fact.pr")).toBe("var(--hl-gold-ink)");
    const goldUsers = [...RULED.matchAll(/([^{}]+)\{[^}]*--hl-gold[^}]*\}/g)].map((m) => m[1]!.replace(/\s+/g, " ").trim());
    for (const sel of goldUsers) expect(sel, "gold is worn only by a PR rule").toMatch(/se-pr\b|se-chip-pr|fact\.pr/);
    // The PR count on the exercise page is a PR chip, and the PR mark in its sessions list is the gold mark.
    const lift = read("gym/LiftDetailScreen.tsx");
    expect(lift).toContain('className="se-chip se-chip-pr"');
    expect(lift).not.toContain('className="pill pill-good">PR');
  });

  it("RED is now: the current set's ring, kicker, dot, position count and the Now pill", () => {
    expect(body(RULED, ".ruled.health-ruled .setrow-now")).toMatch(/box-shadow:\s*inset 0 0 0 1\.5px var\(--sys-red\)/);
    expect(colour(RULED, ".ruled.health-ruled .se-kick.now")).toBe("var(--sys-red)");
    expect(background(RULED, ".ruled.health-ruled .se-dot.on")).toBe("var(--sys-red)");
    expect(colour(RULED, ".ruled.health-ruled .se-count")).toBe("var(--sys-red)");
    expect(background(RULED, ".ruled.health-ruled .se-now")).toBe("var(--sys-red)");
    expect(colour(RULED, ".ruled.health-ruled .fact.now")).toBe("var(--sys-red)");
    // Nothing that means now wears the September cyan any more.
    for (const sel of [".ruled.health-ruled .setrow-now", ".ruled.health-ruled .se-kick.now", ".ruled.health-ruled .se-dot.on", ".ruled.health-ruled .se-count", ".ruled.health-ruled .se-now"]) {
      expect(body(RULED, sel), sel).not.toMatch(/--hl-cyan/);
    }
  });

  it("GREEN is done: the done chip, the done kicker, the done dot, the Done pill", () => {
    expect(colour(RULED, ".ruled.health-ruled .se-chip-done")).toBe("var(--hl-lime-ink)");
    expect(colour(RULED, ".ruled.health-ruled .se-kick.done")).toBe("var(--hl-lime-ink)");
    expect(background(RULED, ".ruled.health-ruled .se-dot.done")).toBe("var(--hl-lime)");
    expect(colour(RULED, ".ruled.health-ruled .pill-good")).toBe("var(--hl-lime-ink)");
    // A count of sessions is not done: History's session count is the key's white, not the done pill.
    expect(read("gym/HistoryScreen.tsx")).not.toContain('className="pill pill-good">{r.sessions}');
  });

  it("TEAL is last time, and only last time", () => {
    expect(colour(RULED, ".ruled.health-ruled .se-chip-last")).toBe("var(--hl-cyan-ink)");
    expect(colour(RULED, ".ruled.health-ruled .fact.cyan")).toBe("var(--hl-cyan-ink)");
    // The base chip is neutral; the projected finish is an estimate (sky); the rest clock and the meta emphasis are white.
    expect(colour(RULED, ".ruled.health-ruled .se-chip")).toBe("var(--tx-2)");
    expect(colour(RULED, ".ruled.health-ruled .se-chip-time")).toBe("var(--est-ink)");
    expect(colour(RULED, ".ruled.health-ruled .rest-clock")).toBe("var(--tx-1)");
    expect(colour(RULED, ".ruled.health-ruled .conn-meta b")).toBe("var(--tx-1)");
    expect(colour(RULED, ".ruled.health-ruled .se-kick")).toBe("var(--tx-2)");
    // Every rule in the health block that reads the cyan token is a last-time rule or the fact variant that carries it.
    const start = RULED.indexOf(".ruled.health-ruled .btn-primary");
    const health = RULED.slice(start);
    const cyanUsers = [...health.matchAll(/([^{}]+)\{[^}]*--hl-cyan[^}]*\}/g)].map((m) => m[1]!.replace(/\s+/g, " ").trim());
    for (const sel of cyanUsers) {
      expect(sel, "teal is worn only by last time").toMatch(/se-chip-last|fact\.cyan|fact\.st\.cyan|stat-tile|ex-bar|ex-row|ex-check|ins-bar-track|hue-hl-cyan/);
    }
  });

  it("AMBER is warm-up, and only warm-up, on the set strip and the session", () => {
    // The warm-up card and its eyebrow keep the amber.
    expect(body(RULED, ".ruled.health-ruled .eyebrow.eyebrow-warn")).toMatch(/--hl-amber-ink/);
    expect(body(RULED, ".ruled.health-ruled .card.banner-warn:has(.eyebrow-warn)")).toMatch(/--hl-amber-tint/);
    // Nothing that is not warm-up wears it: the drop kicker, the up-next kicker, the skipped dot, the plates, the guard, the grind, the over chip.
    for (const sel of [".ruled.health-ruled .se-kick.drop", ".ruled.health-ruled .se-kick.se-kick-next", ".ruled.health-ruled .se-dot.skip",
      ".ruled.health-ruled .se-plate", ".ruled.health-ruled .se-guard", ".ruled.health-ruled .se-guard em", ".ruled.health-ruled .chip.mv.mv-grind",
      ".ruled.health-ruled .chip.mv.mv-grind.active", ".ruled.health-ruled .se-chip-over"]) {
      expect(body(RULED, sel), sel).not.toMatch(/--hl-amber/);
    }
    expect(body(COMPONENTS, ".sheet-scrim > .card .fit-over"), "the fit sheet's over-budget read").not.toMatch(/--hl-amber|--warn\)/);
    expect(body(COMPONENTS, ".sheet-scrim > .card .fit-under"), "nor its under-budget read in the done green").not.toMatch(/--hl-lime/);
  });

  it("BLUE is cool-down: the cool-down card and its eyebrow", () => {
    expect(body(RULED, ".ruled.health-ruled .banner-cool")).toMatch(/--hl-blue-tint/);
    expect(colour(RULED, ".ruled.health-ruled .eyebrow.eyebrow-cool")).toBe("var(--hl-blue-ink)");
  });

  it("light says what dark says: no light rule neutralises a meaning chip", () => {
    for (const m of RULED.matchAll(/\[data-theme="light"\][^{}]*\{[^}]*\}/g)) {
      const rule = m[0];
      if (!/se-chip-(best|done|last|time|pr|est|over|budget|pair)|\.fact\.(lime|cyan|best|pr|now)/.test(rule)) continue;
      expect(rule, "a light rule strips a chip of its meaning").not.toMatch(/color:\s*var\(--tx-[1-4]\)/);
    }
  });
});
