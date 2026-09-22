import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { posix } from "node:path";

const { join } = posix;
const ROOT = process.cwd().replace(/\\/g, "/");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

// ---------------------------------------------------------------------------
// LAW: THE COLOUR KEY (§AM, Dave 2026-09-22: "The color should be based on
// what it's showing. Make a color key.")
//
// He asked for it after being handed three options for one number and told
// that a law forbade the one he picked. The right answer was never "pick a
// colour for numbers" -- it was that colour means something in this app, and
// nobody had written down what.
//
// WHY THIS IS A LAW AND NOT A SWEEP. In the same breath: "Make sure all of
// these edits are applied to all pages, modals, backend pages, email pages,
// settings, Brain, etc. Literally everywhere. Text boxes, chat boxes,
// previews and FUTURE ADDITIONS."
//
// A sweep cannot reach a screen nobody has written yet. So these assertions
// never look at a screen. They read the stylesheets every screen shares, and
// a new page inherits the key by inheriting the rules -- there is no opt-out,
// because there is nothing to opt out of.
// ---------------------------------------------------------------------------

const SHEETS = ["components.css", "ruled.css", "jarvis-design-system.css",
  "uniformity.css", "editor.css", "mail-rows.css"] as const;

const CATALOG = read("STYLING_CATALOG_V3.md");

/** Every rule in every sheet, comments stripped, as [selector, body, file]. */
function rules(): Array<{ sel: string; body: string; file: string }> {
  const out: Array<{ sel: string; body: string; file: string }> = [];
  for (const f of SHEETS) {
    const css = read("src/styles/" + f).replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of css.matchAll(/([^{}]*)\{([^}]*)\}/g)) {
      const sel = m[1]!.replace(/\s+/g, " ").trim();
      if (!sel || sel.startsWith("@")) continue;
      out.push({ sel, body: m[2]!, file: f });
    }
  }
  return out;
}
const RULES = rules();

const textColour = (body: string) =>
  /(^|[;{\s])color:\s*([^;]+)/.exec(body)?.[2]?.trim() ?? null;

describe("LAW §AM: the colour key", () => {
  it("the catalog carries the key, and every entry in it", () => {
    expect(CATALOG).toMatch(/## §AM\. The Colour Key/);
    expect(CATALOG, "the rule itself, not just the table").toMatch(/Colour is for MEANING/);
    for (const [meaning, token] of [
      ["done", "--good"], ["Needs you soon", "--warn"], ["Late", "--sys-red"],
      ["An estimate", "--cat-sky"], ["Tap this", "--tint"],
      ["no state", "--tx-1"], ["Everything else", "--tx-3"],
    ] as const) {
      expect(CATALOG, meaning + " is in the key").toContain(meaning);
      expect(CATALOG, token + " is named for it").toContain(token);
    }
  });

  // -------------------------------------------------------------------------
  // BRAND RED IS AN AFFORDANCE, NOT A MEANING.
  //
  // This is the one that answers F1. --tint says "this responds to a tap";
  // every other red thing on screen opens something. Rendered, the picked
  // option put four red numbers on one screen and not one of them opened
  // anything. A fact that merely states a value may not wear it, because it
  // promises a tap that is not there.
  // -------------------------------------------------------------------------
  it("a fact never wears the brand red, because the brand red means tap me", () => {
    // Classes whose whole job is to state a value.
    const FACT = /\.(fact|facts|conn-meta|bp-sub|empty-sub|r-goal|area-fact|rdy-why|msg-gist|note-first|row-value|sched-cat|sched-rep|sched-loc|prov-line|input-hint|input-help|input-note)(?![\w-])/;
    // ...unless the thing IS operable. .sched-loc reads like a plain fact
    // and is an <a> to Apple Maps, which no selector can tell you, so it is
    // named here rather than guessed at.
    const OPERABLE = /(button|:active|:hover|:focus|-btn(?![\w-])|\ba\b|\[role="button"\]|\.see-all|\.pill-act|\.row-act|\.quiet-action|\.sched-until|\.sched-open|\.sched-loc|\.link|\.tap)/;
    const bad: string[] = [];
    for (const { sel, body, file } of RULES) {
      if (!FACT.test(sel) || OPERABLE.test(sel)) continue;
      const c = textColour(body);
      if (c && /var\(--(tint|accent|accent-tx|accent-chrome|accent-glyph)\)/.test(c)) {
        bad.push(`${file}: ${sel} -> ${c}`);
      }
    }
    expect(bad, "a value that cannot be tapped must not wear the colour that promises a tap").toEqual([]);
  });

  // -------------------------------------------------------------------------
  // THE SAME GREY, BOLDED, IS NOT A DISTINCTION (§AK V5.2, and the reason F1
  // was asked at all). --tx-2 and --tx-3 are the SAME HEX in both themes, so
  // a <b> painted --tx-2 inside a --tx-3 line is the one grey made heavier.
  // An emphasis steps up to --tx-1, or takes a meaning colour from the key.
  // -------------------------------------------------------------------------
  it("an emphasis inside a quiet line steps up, and never re-states the grey", () => {
    const KEY_INK = /var\(--(tx-1|good|warn|sys-red|red|cat-sky|hl-[a-z]+(-ink)?|accent-tx|tint|on-light-red)\)|currentColor/;
    const bad: string[] = [];
    for (const { sel, body, file } of RULES) {
      // The inline emphasis inside a meta line: `<something> b { ... }`.
      if (!/\bb\s*$/.test(sel)) continue;
      const c = textColour(body);
      if (!c) continue;
      if (KEY_INK.test(c)) continue;
      // An explicitly OFF or finished state is allowed to stay quiet: it is
      // not emphasis, it is the absence of it.
      if (/(\.off|\.rdy-off|\.done|\.completed|\.skipped|\.gone)(?![\w-])/.test(sel)) continue;
      bad.push(`${file}: ${sel} -> ${c}`);
    }
    expect(bad, "--tx-2 is --tx-3; bolding it is the same grey, heavier").toEqual([]);
  });

  // -------------------------------------------------------------------------
  // ONE MEANING, ONE COLOUR. Health runs brighter inks so a line reads at
  // arm's length between sets, but the MEANINGS are the app's. So a Health
  // ink may only appear where Health renders -- inside .ruled.health-ruled,
  // or inside a sheet, which is where its sheets portal to.
  // -------------------------------------------------------------------------
  it("the health inks stay on the health surfaces", () => {
    const SHARED = /\.(fact|facts|conn-meta|conn-name|bp-sub|empty-sub|r-goal|uchip|eyebrow|slide-tag|task-title|task-name|sched-cat|sched-title|row-value|prov-line|urgency)(?![\w-])/;
    const bad: string[] = [];
    for (const { sel, body, file } of RULES) {
      if (!/var\(--hl-[a-z]+-ink\)/.test(body)) continue;
      // Scoped to health, or to a sheet (where health's sheets portal to).
      if (/health-ruled|sheet-scrim/.test(sel)) continue;
      // A class that belongs to a health component is its own vocabulary and
      // renders nowhere else. The stylesheet cannot prove that, so the check
      // is narrowed to the SHARED primitives, which every screen draws with:
      // those are where a borrowed ink actually spreads.
      if (!SHARED.test(sel)) continue;
      bad.push(`${file}: ${sel}`);
    }
    expect(bad, "a health ink outside health is a second vocabulary for one meaning").toEqual([]);
  });

  // -------------------------------------------------------------------------
  // THE CATEGORY RIDES THE DOT. If a category coloured its own words, no row
  // could also carry a green or an amber without two hues fighting for the
  // same line. The hue goes on the mark; the words stay in the ramp.
  // -------------------------------------------------------------------------
  it("a category colours its dot, never the words beside it", () => {
    const factCat = RULES.find((r) => /^\.fact\.cat$/.test(r.sel));
    expect(factCat, ".fact.cat is the category fact").toBeTruthy();
    expect(textColour(factCat!.body), "its words are the row's grey").toMatch(/var\(--tx-3\)/);
    const dot = RULES.find((r) => /^\.fact\.cat \.cd$/.test(r.sel));
    expect(dot, "and the dot is the thing that carries the colour").toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // THE THREE THE KEY FIXED WHEN IT WAS WRITTEN, pinned so they cannot drift
  // back. Each was one meaning wearing two colours.
  // -------------------------------------------------------------------------
  it("the drifts the key closed stay closed", () => {
    const RULED = read("src/styles/ruled.css");
    expect(RULED, "over a limit is the health amber, like the line above it")
      .toMatch(/\.ruled \.vol-n\.vol-under, \.ruled \.vol-n\.vol-over \{ color: var\(--hl-amber-ink\); \}/);
    expect(RULED, "a crossed guard is late, and late is --sys-red")
      .toMatch(/\.ruled\.health-ruled \.se-guard-warn \{ color: var\(--sys-red\)/);
    expect(RULED, "an estimate is the one number with a meaning, and it is sky")
      .toMatch(/\.ruled \.r-goal\.r-est \{[^}]*color: var\(--cat-sky\)/);
  });
});
