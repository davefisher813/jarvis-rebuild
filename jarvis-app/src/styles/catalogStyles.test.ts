import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { posix } from "node:path";

// ---------------------------------------------------------------------------
// THE STYLESHEETS HOLD THE CATALOG (Dave, 2026-10-05: "I am sick of this
// shit." A thin grey subtext came back on the live Email card after he had
// spent hours fixing exactly that).
//
// The laws in src/laws read the stylesheets for a roster of class names, and
// a rule that restyled a subtext line through a class they did not list, or
// through a theme selector, slipped past all of them. These checks read every
// rule in the six shared sheets instead of a roster, and each one is the
// structural form of a rule the catalog already states:
//
//   - a weight is a token on the ladder, never a bare number (the type law);
//   - light and dark differ in colour only (Dave 2026-10-04: "same weights,
//     same layout, same everything"), so no light-theme rule restyles type;
//   - a meaning the Colour Key gives a colour (due, late, done, estimate) is
//     never drawn grey in either theme (§AM, R3);
//   - the quiet line under a title is --t-sub at --w-sub, 14 and 400 (§AK,
//     R7), and a custom class may not pick its own numbers;
//   - text is never dimmed with opacity (a state is said in ink, §AM);
//   - colour on WORDS is never a category colour or a raw hex (§AM F1);
//   - a class written as a plain string in a component has a rule.
//
// email.css and hub.css belong to the email and hub passes, and the FEEDBACK
// STYLE block in components.css to the feedback pass; they are not read here.
// ---------------------------------------------------------------------------

const { join } = posix;
const SRC = join(process.cwd().replace(/\\/g, "/"), "src");
const read = (f: string) => readFileSync(join(SRC, f), "utf8");

const SHEETS = ["components.css", "ruled.css", "jarvis-design-system.css",
  "uniformity.css", "editor.css", "mail-rows.css"] as const;

type Rule = { file: string; sel: string; body: string };

// The feedback pass owns its block in components.css; it is cut out by its own
// markers before the rule scan, so a rule in it is judged by its owner.
const FEEDBACK = /\/\* === FEEDBACK STYLE[\s\S]*?=== END FEEDBACK STYLE === \*\//g;

/** Every rule in the six sheets, comments and the feedback block stripped,
 *  at-rules opened so a rule inside @media or @supports is still read. */
const RULES: Rule[] = (() => {
  const out: Rule[] = [];
  for (const file of SHEETS) {
    let css = read("styles/" + file);
    if (file === "components.css") css = css.replace(FEEDBACK, "");
    css = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@(?:media|supports|container|layer)[^{;]*\{/g, "");
    for (const m of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      const sel = (m[1] ?? "").replace(/\s+/g, " ").trim();
      if (!sel || sel.startsWith("@")) continue;
      out.push({ file, sel, body: m[2] ?? "" });
    }
  }
  return out;
})();

const decl = (body: string, prop: string) =>
  new RegExp("(?:^|[;\\s])" + prop + ":\\s*([^;]+)").exec(body)?.[1]?.trim() ?? null;

/** The last compound of each comma-separated selector, pseudo-elements removed. */
const subjects = (sel: string) => sel.split(",").map((one) => {
  const parts = one.trim().split(/[\s>+~]+/).filter(Boolean);
  return (parts[parts.length - 1] ?? "").replace(/::?[a-z-]+(\([^)]*\))?/g, "");
});
const classesOf = (compound: string) => [...compound.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((m) => m[1]!);

describe("CATALOG: the stylesheets hold it (2026-10-05)", () => {
  // -------------------------------------------------------------------------
  // A WEIGHT IS A TOKEN ON THE LADDER. Eleven rules wrote 600 or 700 by hand
  // (the conditioning clock, the receipt table, the editorial title, the
  // insight tiles), which is how a weight drifts off the ladder without a law
  // seeing it. One written number is left, and it is named with its reason:
  // the schedule row's time is also drawn inside the frozen TV guide, and
  // Dave's order is that nothing it contains is restyled.
  // -------------------------------------------------------------------------
  const RAW_WEIGHT_ALLOWED = new Map<string, string>([
    [".ruled .sched-time", "650 is off the ladder, but the row is drawn inside the frozen TV guide (Dave 2026-09-27)"],
  ]);

  it("no rule writes a bare number for a font-weight", () => {
    const bad: string[] = [];
    for (const { file, sel, body } of RULES) {
      const w = decl(body, "font-weight");
      if (!w || !/^\d+$/.test(w)) continue;
      if (RAW_WEIGHT_ALLOWED.has(sel)) continue;
      bad.push(`${file}: ${sel} -> font-weight: ${w}`);
    }
    expect(bad, "a weight is --w-normal, --w-regular, --w-medium, --w-semi, --w-bold or a role token").toEqual([]);
  });

  // -------------------------------------------------------------------------
  // LIGHT AND DARK DIFFER IN COLOUR ONLY (Dave 2026-10-04). The type law holds
  // the weight TOKENS to :root. This holds the RULES: a rule scoped to the
  // light theme may not set a weight, a size, a tracking, a line height, a
  // letter case or a numeral width. Found on 2026-10-05: an area card's count
  // was 700 white in dark and 400 grey in light, a due fact's count was
  // re-weighted in light alone, and tabular numerals were light-only.
  // The one rule left is named with its reason.
  // -------------------------------------------------------------------------
  // Empty and staying empty: the one entry it held (the dock hint's light-only 14) went with the light-only size tokens.
  const LIGHT_TYPE_ALLOWED = new Map<string, string>();
  const TYPE_PROPS = ["font-weight", "font-size", "letter-spacing", "line-height", "font-variant-numeric", "text-transform", "font-style"];

  it("no light-theme rule restyles type", () => {
    const bad: string[] = [];
    for (const { file, sel, body } of RULES) {
      if (!/\[data-theme=["']?light["']?\]/.test(sel)) continue;
      // The token block itself, `[data-theme="light"] { ... }`, sets custom
      // properties only and is judged by the next test.
      if (/^\[data-theme="light"\]$/.test(sel)) continue;
      if (LIGHT_TYPE_ALLOWED.has(sel)) continue;
      for (const p of TYPE_PROPS) if (decl(body, p) !== null) bad.push(`${file}: ${sel} sets ${p}`);
    }
    expect(bad, "light and dark differ in colour only").toEqual([]);
  });

  // The four light-only SIZE tokens are gone (Dave 2026-10-04 "same everything", applied 2026-10-05, the perfect bar:
  // "Quick Wins" wrapped to two lines in light because --t-meta was 15 there and 14 in dark, and every line ran
  // 1 to 12px wider). The light block overrides NO size, weight, tracking, line-height or radius token: a fifth, or
  // the four coming back, fails here.
  it("the light block overrides no type or spacing token", () => {
    const light = RULES.find((r) => r.file === "jarvis-design-system.css" && r.sel === "[data-theme=\"light\"]");
    expect(light, "the light token block exists").toBeTruthy();
    const sizeTokens = [...light!.body.matchAll(/(--(?:t|w|s|r|lh|track)-[a-z0-9-]+)\s*:/g)].map((m) => m[1]).sort();
    expect(sizeTokens).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // A MEANING IS NEVER GREY (§AM, R3). Due is amber, late red, done green, an
  // estimate sky, in both themes. A light-only rule that paints one of them in
  // the row's ink hides the meaning in light alone: a second-line "JARVIS
  // Found 3" and a bill that waits on the person read amber in dark and grey
  // in light.
  // -------------------------------------------------------------------------
  const TONED = /\.fact\.(warn|good|red|est)\b|\.r-goal\.(r-est|r-stalled)\b/;
  const GREY_INK = /var\(--tx-(1|2|3|quiet)\)/;

  it("a toned fact is not drawn in a grey or white ink under the light theme", () => {
    const bad: string[] = [];
    for (const { file, sel, body } of RULES) {
      if (!/\[data-theme=["']?light["']?\]/.test(sel) || !TONED.test(sel)) continue;
      const c = decl(body, "color");
      if (c && GREY_INK.test(c)) bad.push(`${file}: ${sel} -> color: ${c}`);
    }
    expect(bad, "the key's colour shows in both themes").toEqual([]);
  });

  // -------------------------------------------------------------------------
  // THE QUIET LINE IS 14 AT 400 (§AK, §AM F4, R7). A custom class that draws
  // the line under a title picks its own numbers and drifts: the balance line
  // on Money was 13, the hero's label was 500 and then 600, a chat message's
  // provenance 500, a report window's name 600, the header's scope label 15
  // in light. These classes are lines under something, never kickers, so they
  // take the sub size and the sub weight. A caps kicker (uppercase, 11) is a
  // different object and keeps its own.
  // -------------------------------------------------------------------------
  const SUB_LINES = ["money-line", "money-hero-label", "chat-prov", "rep-win-name", "hdr-scope-n"];
  const SUB_SIZES = /^var\(--t-(sub|eyebrow|micro)\)$/;

  it("the lines under a title are --t-sub at --w-sub, whatever their class", () => {
    const bad: string[] = [];
    for (const { file, sel, body } of RULES) {
      if (!subjects(sel).some((s) => classesOf(s).some((c) => SUB_LINES.includes(c)))) continue;
      if (/uppercase/.test(decl(body, "text-transform") ?? "")) continue;
      const size = decl(body, "font-size");
      if (size !== null && !SUB_SIZES.test(size)) bad.push(`${file}: ${sel} -> font-size: ${size}`);
      const weight = decl(body, "font-weight");
      if (weight !== null && weight !== "var(--w-sub)" && weight !== "var(--w-normal)") bad.push(`${file}: ${sel} -> font-weight: ${weight}`);
    }
    expect(bad, "14 at 400, the one subtext size and the one subtext weight").toEqual([]);
  });

  // -------------------------------------------------------------------------
  // TEXT IS NEVER DIMMED WITH OPACITY (§AM: a state is said in ink). A stat
  // tile's label sat at 72%, which measured 3.07:1 for the amber and red
  // labels on their own wash in light, under the 4.5 bar.
  // -------------------------------------------------------------------------
  it("a stat tile's label does not fade itself", () => {
    const bad = RULES.filter(({ sel, body }) =>
      subjects(sel).some((s) => classesOf(s).includes("st-w")) && decl(body, "opacity") !== null)
      .map(({ file, sel }) => `${file}: ${sel}`);
    expect(bad).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // COLOUR ON WORDS IS THE KEY'S, NEVER A CATEGORY'S OR A RAW HEX (§AM F1).
  // -------------------------------------------------------------------------
  it("no fact-slot class paints words in a category colour or a raw hex", () => {
    const bad: string[] = [];
    for (const { file, sel, body } of RULES) {
      if (!subjects(sel).some((s) => classesOf(s).some((c) => /^fact-/.test(c)))) continue;
      const c = decl(body, "color");
      if (c && (/--cat-/.test(c) || /#[0-9a-fA-F]{3,8}\b/.test(c))) bad.push(`${file}: ${sel} -> color: ${c}`);
    }
    expect(bad).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // A CLASS WRITTEN AS A PLAIN STRING HAS A RULE. An unstyled class does
  // nothing and drifts silently: it reads as a state ("set-chip-warm") that
  // the screen never shows. Only fully static className strings are read,
  // which is the one shape that has no false positives; a class built from a
  // value ("cat-bg-" + slot) is out of reach of a source scan.
  // p2 is named: a leftover priority marker on forty task rows with no rule,
  // in files other passes own, reported for removal there.
  // -------------------------------------------------------------------------
  const MARKERS_WITHOUT_A_RULE = new Set(["p2"]);

  it("every class in a plain className string has a CSS rule", () => {
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const name of readdirSync(dir)) {
        if (name === "bench" || name === "testpanel" || name === "laws") continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else out.push(p);
      }
      return out;
    };
    const files = walk(SRC);
    const css = files.filter((f) => f.endsWith(".css"))
      .map((f) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")).join("\n");
    const styled = new Set([...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]!));
    const bad = new Set<string>();
    for (const f of files) {
      if (!f.endsWith(".tsx") || /\.test\.tsx$/.test(f)) continue;
      const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const m of src.matchAll(/className="([^"{}$]*)"/g)) {
        for (const c of (m[1] ?? "").split(/\s+/)) {
          if (c && !styled.has(c) && !MARKERS_WITHOUT_A_RULE.has(c)) bad.add(`${c} (${f.slice(SRC.length + 1)})`);
        }
      }
    }
    expect([...bad].sort(), "a class nothing styles is a state the screen never shows").toEqual([]);
  });
});
