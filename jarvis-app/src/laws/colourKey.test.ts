import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { TAP_RED } from "./reds";

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

/** Every rule in every sheet, comments stripped, as [selector, body, file].
 *  AMENDED 2026-09-26 (round-4 review, the lead): at-rules are opened before
 *  the split. The wrapper's selector starts with "@" and was dropped, and its
 *  brace swallowed the first rule inside it, so every rule inside @media or
 *  @supports went unread: `.fact.x { color: var(--tint) }` inside a contrast
 *  query passed the key. F-04 and the capsule rings check open them the same
 *  way ("a rule inside an at-rule block is still a rule"). Every rule read
 *  before is still read. */
function rules(): Array<{ sel: string; body: string; file: string }> {
  const out: Array<{ sel: string; body: string; file: string }> = [];
  for (const f of SHEETS) {
    const css = read("src/styles/" + f).replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/@(?:media|supports|container|layer)[^{;]*\{/g, "");
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
    // AMENDED 2026-09-26 (§AM): the schedule time that cannot be tapped
    // (.sched-until without the button) joined the list; it states a time.
    const FACT = /\.(fact|facts|conn-meta|bp-sub|empty-sub|r-goal|area-fact|rdy-why|msg-gist|note-first|row-value|sched-cat|sched-rep|sched-until|sched-loc|prov-line|input-hint|input-help|input-note)(?![\w-])/;
    // ...unless the thing IS operable. .sched-loc reads like a plain fact
    // and is an <a> to Apple Maps, which no selector can tell you, so it is
    // named here rather than guessed at.
    // AMENDED 2026-09-26 (§AM, round-1 review): `\.sched-until` had no
    // boundary, so it exempted the plain time as well as its button, and the
    // whole selector list was judged at once, so one tappable sibling in a
    // list exempted every fact beside it. Both rules the phase rewrote were
    // skipped that way. Now only the button form is operable, each
    // comma-separated selector is judged on its own, and a class named only
    // inside :not() says what the thing is NOT, so it exempts nothing.
    const OPERABLE = /(button|:active|:hover|:focus|-btn(?![\w-])|\ba\b|\[role="button"\]|\.see-all|\.pill-act|\.row-act|\.quiet-action|\.sched-until-btn(?![\w-])|\.sched-open|\.sched-loc|\.link|\.tap)/;
    // AMENDED 2026-09-26 (round-2 review, the lead): the brand red is every
    // token that resolves to it, not five of them. The list left out
    // --on-light-red (the brand's words red in light, R3) and --tint-on-sheet,
    // and the phase moved many tap words onto those two, so a fact painted
    // either passed. Every --tint* and --accent* token counts now, plus
    // --on-light-red. Measured on the sheets that day: it matches only the
    // two operable rules already exempt above, so nothing new fails.
    // AMENDED 2026-09-26 (round-3 review, the lead): the pattern only matched
    // a token with its closing paren straight after, so a fact painted
    // `var(--tint, #FF2B3C)` (a fallback) passed, and it left out
    // --danger-tx, the words red F-04 already named (#CC051B in light). The
    // brand red is read from the one shared definition now (laws/reds.ts),
    // the same one F-04 and L1 read: every token above, --danger-tx, a
    // reference followed by a fallback, and the brand's hexes. Every token
    // it matched before still matches. Measured on the sheets that day: it
    // still matches only the operable rules exempt above.
    const BRAND_RED = TAP_RED;
    const bad: string[] = [];
    for (const { sel, body, file } of RULES) {
      const c = textColour(body);
      if (!c || !BRAND_RED.test(c)) continue;
      for (const one of sel.split(",").map((x) => x.trim())) {
        const positive = one.replace(/:not\([^)]*\)/g, "");
        if (!FACT.test(positive) || OPERABLE.test(positive)) continue;
        bad.push(`${file}: ${one} -> ${c}`);
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
    // AMENDED 2026-09-26 (Dave's pick): an estimate wears --est-ink now (the
    // sky slot in dark, #006592 in light), so it is a key ink beside
    // --cat-sky. Nothing else joins.
    const KEY_INK = /var\(--(tx-1|good|warn|sys-red|red|cat-sky|est-ink|hl-[a-z]+(-ink)?|accent-tx|tint|on-light-red)\)|currentColor/;
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
    // AMENDED 2026-09-26 (Dave's pick): the estimate's sky is its own token,
    // --est-ink. In dark it is the sky slot, so nothing moved there; in
    // light it is the darker sky #006592, because Apple's cyan as text was
    // 2.28:1 on the light page. The token and both values are pinned, so
    // light cannot drift back to the category cyan and dark cannot drift
    // off the sky slot.
    expect(RULED, "an estimate is the one number with a meaning, and it is sky")
      .toMatch(/\.ruled \.r-goal\.r-est \{[^}]*color: var\(--est-ink\)/);
    const COMP = read("src/styles/components.css");
    expect(COMP, "in dark the estimate ink is the sky slot").toMatch(/:root \{ --est-ink: var\(--cat-sky\); \}/);
    expect(COMP, "in light it is the darker sky Dave picked").toMatch(/\[data-theme="light"\] \{ --est-ink: #006592; \}/);
    expect(COMP, "and the shared estimate fact wears it").toMatch(/\.fact\.est \{ color: var\(--est-ink\);/);
  });

  // -------------------------------------------------------------------------
  // DAVE'S PICKS, 2026-09-26 (the sixteen questions the sweep held for him).
  // Each one settles a place the key was read two ways; pinned so the
  // reading he chose is the one that stays.
  // -------------------------------------------------------------------------
  it("his 2026-09-26 picks hold: plain Health card, tap-red fold labels, amber countdowns", () => {
    const RULED = read("src/styles/ruled.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const EDITOR = read("src/styles/editor.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const COMP = read("src/styles/components.css").replace(/\/\*[\s\S]*?\*\//g, "");
    // The Health area card is plain like every area card: its colour is on
    // its tile, never a wash, a rim or a chip tint.
    const health = /\.ruled \.area-card-health \{([^}]*)\}/.exec(RULED)?.[1] ?? "";
    expect(health, "the Health card rule exists").not.toBe("");
    expect(health, "no wash behind it").not.toMatch(/background/);
    expect(health, "no green rim").not.toMatch(/border/);
    expect(RULED, "its sub is the area grey, not a white of its own").not.toMatch(/\.ruled \.area-card-health \.area-sub/);
    expect(RULED, "its chips carry no green").not.toMatch(/\.ruled \.health-chip[^{]*\{[^}]*--good/);
    // A fold label opens something, so it is the tap red, the words red in
    // light (the sheet forms take the sheet twin, pinned in browserWalk).
    expect(EDITOR).toMatch(/\.exp-more summary \{[^}]*color: var\(--tint\);/);
    expect(EDITOR).toMatch(/\[data-theme="light"\] \.exp-more summary \{ color: var\(--on-light-red\); \}/);
    expect(RULED).toMatch(/\.ruled\.health-ruled \.ins-table summary \{[^}]*color: var\(--tint\);/);
    expect(RULED).toMatch(/\[data-theme="light"\] \.ruled\.health-ruled \.ins-table summary \{ color: var\(--on-light-red\); \}/);
    expect(COMP, "no fold label is put back to grey").not.toMatch(/\.rem-more > summary \{[^}]*color/);
    // A count of days still running is needs you soon, amber; slipped is late.
    expect(COMP).toMatch(/\.qd-hot \{ color: var\(--sys-red\); \}/);
    expect(COMP).toMatch(/\.qd-soon \{ color: var\(--warn\); \}/);
  });
});
