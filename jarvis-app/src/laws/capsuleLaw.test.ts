import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { posix } from "node:path";

const { join } = posix;
const ROOT = process.cwd().replace(/\\/g, "/");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

// ---------------------------------------------------------------------------
// LAW: THE CAPSULE, SETTLED (§AL, Dave 2026-09-22, from the Control Catalog —
// every rung, capsule, unanimous).
//
// THIS FILE EXISTS BECAUSE THE RULING BEFORE IT WAS NEVER WRITTEN DOWN. The
// row pill went outlined (§O.5), then capsule (§X2), then capsule again
// (§AJ C1, "34 tall... on press-3, red when it acts"), and then on 2026-09-21
// a contrast fix replaced it with a 1px brand ring that was recorded ONLY in
// a CSS comment. For a day the catalog said capsule and the app drew a ring,
// and nothing failed. Dave, on the shipped app: "I hate this... the shape
// sucks too", and of the Focus button, "these were never supposed to change."
//
// So the point of these assertions is not that a capsule is prettier than a
// ring. It is that a control this app has re-litigated four times now has a
// test standing next to its catalog section, and the next pass that wants to
// change it has to change both on purpose.
// ---------------------------------------------------------------------------

const CSS = read("src/styles/components.css");
const DS = read("src/styles/jarvis-design-system.css");
const RULED = read("src/styles/ruled.css");
const CATALOG = read("STYLING_CATALOG_V3.md");

/** The body of the first rule whose selector list contains `sel`. */
function ruleBody(css: string, sel: string): string {
  const i = css.indexOf(sel);
  if (i < 0) return "";
  const open = css.indexOf("{", i);
  const close = css.indexOf("}", open);
  return open < 0 || close < 0 ? "" : css.slice(open + 1, close);
}

/** The body of the rule whose WHOLE selector is `sel`, comments stripped
 *  (2026-09-26). `ruleBody` finds the first substring match, so a scoped
 *  rule that happens to end in the same words is read in the base rule's
 *  place; this reads the one rule that is exactly that selector. */
function exactRule(css: string, sel: string): string {
  const want = sel.replace(/\s+/g, " ").trim();
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of bare.matchAll(/([^{}]*)\{([^}]*)\}/g)) {
    if (m[1]!.replace(/\s+/g, " ").trim() === want) return m[2]!;
  }
  return "";
}

describe("LAW §AL: the capsule, settled", () => {
  it("the catalog carries the ruling, and names what it supersedes", () => {
    expect(CATALOG).toMatch(/## §AL\. The Capsule, Settled/);
    expect(CATALOG, "the ring is named as retired, not quietly dropped")
      .toMatch(/The ring is retired/);
    expect(CATALOG, "and the reason this section exists at all is stated")
      .toMatch(/NOT WRITTEN DOWN/);
  });

  it("the action pill carries a fill and no ring", () => {
    const body = ruleBody(CSS, ".pill-act:not(.pill-quiet):not(.pill-neutral)");
    expect(body, "the pill has a fill").toMatch(/background-color:\s*var\(--capsule-fill\)/);
    expect(body, "and no ring: Option D's inset shadow is gone").toMatch(/box-shadow:\s*none/);
    expect(body, "the label is the action red").toMatch(/color:\s*var\(--tint\)/);
  });

  it("the in-list create takes the same capsule, and the quiet action does NOT", () => {
    const rowAct = ruleBody(CSS, ".row-act, .ruled .card .row.row-act");
    expect(rowAct).toMatch(/background-color:\s*var\(--capsule-fill\)/);
    expect(rowAct).toMatch(/box-shadow:\s*none/);
    // .quiet-action was swept into the ring rule by selector proximity, which
    // put a brand ring around 43 call sites of the QUIET option. It is not a
    // red verb; it must never share a rule with one again.
    expect(CSS, "the quiet action is not glued to the row action's rule")
      .not.toMatch(/\.row-act,\s*\.quiet-action/);
    const quiet = ruleBody(CSS, ".quiet-action {");
    expect(quiet, "and it keeps secondary ink, not the action red")
      .toMatch(/color:\s*var\(--tx-2\)/);
  });

  // THE SMALL PILL IS A CAPSULE BY NAME (§AL; settled by the lead
  // 2026-09-26). The comment on its rule says §AL binds it, and until today
  // nothing but that comment did: this law pinned .pill-act and .row-act
  // only, so the next pass could hand .btn-sm a ring or a wash and pass.
  // Both themes, because each theme's rule is the one that paints there.
  it("the small pill takes the capsule fill and the action red, in both themes", () => {
    const CHAIN = ".btn-sm:not(.btn-primary):not(.btn-danger):not(.btn-secondary)";
    const base = exactRule(CSS, CHAIN);
    expect(base, "the small pill's own rule is still in the sheet").toBeTruthy();
    expect(base, "it has the capsule fill, as a longhand").toMatch(/background-color:\s*var\(--capsule-fill\)/);
    expect(base, "its label is the action red").toMatch(/(^|[;\s])color:\s*var\(--tint\)/);
    const light = exactRule(CSS, '[data-theme="light"] ' + CHAIN);
    expect(light, "light has its own twin").toBeTruthy();
    expect(light, "the same capsule fill in light").toMatch(/background-color:\s*var\(--capsule-fill\)/);
    expect(light, "and the light words red").toMatch(/(^|[;\s])color:\s*var\(--on-light-red\)/);
  });

  it("the capsule fill is opaque in dark, so contrast cannot depend on the ground", () => {
    // Every --press-* token is an alpha, so the same capsule measured 5.16 on
    // the page, 4.50 on a card, 3.12 raised and 2.55 on surface-3. Each pass
    // that re-opened this control had measured it somewhere different.
    expect(DS, "dark declares an opaque capsule fill").toMatch(/--capsule-fill:\s*#[0-9A-Fa-f]{6}\s*;/);
    expect(DS, "and light declares its own").toMatch(/--capsule-fill:\s*var\(--press-3\)/);
  });

  it("the capsule PAINTS 34 inside a 44 tap box, which is what §AJ C1 meant", () => {
    const body = ruleBody(CSS, ".pill-act {\n  min-height");
    expect(body, "the tap box is the app's minimum").toMatch(/min-height:\s*var\(--tap-min\)/);
    // 9px borders off a 34px box left SIXTEEN pixels of paint, which is what
    // "the words are way too close to the border" actually was.
    const border = /border-top:\s*(\d+)px solid transparent/.exec(body);
    expect(border, "the transparent hit border is still how it reaches 44").toBeTruthy();
    expect(Number(border![1]), "5px off 44 paints 34; 9px off 34 painted 16").toBe(5);
    expect(body, "and the row is paid back so nothing reflows").toMatch(/margin-block:\s*-5px/);
    expect(body, "the clip stays on the padding box (BROWSER-F-03)")
      .toMatch(/background-clip:\s*padding-box/);
  });

  it("no rule fills a .pill-act with the background SHORTHAND", () => {
    // The shorthand resets background-clip to border-box, so the fill paints
    // across the 9px transparent hit border while the rest of the pill stays
    // on the padding box. That is the "double edge" on Start Now, and the
    // ~50px of red on Health's hero Start.
    const offenders: string[] = [];
    for (const [file, raw] of [["components.css", CSS], ["ruled.css", RULED]] as const) {
      // Comments first: this file explains itself at length, and a comment
      // that MENTIONS .pill-act would otherwise read as a selector for it.
      const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
      for (const m of css.matchAll(/([^{}]*)\{([^}]*)\}/g)) {
        const selector = m[1]!.trim();
        const body = m[2]!;
        // `.pill-act` as a WHOLE class: `.pill-action` is a different control
        // (the head action's capsule form) and must not be caught here.
        // .row-act too (2026-09-22): the in-list create is the same capsule,
        // and a shorthand on `.ruled .card .row.row-act` kept every create in
        // a ruled card off it while this law, watching .pill-act only, passed.
        // Judged on each selector's SUBJECT (its last compound): a rule for
        // `.card:has(> .row-act:only-child)` styles the card, not the button.
        // AMENDED 2026-09-26 (§AL): .btn-sm joined, since it is a capsule
        // by name too. A small button that is ALSO a primary, danger or
        // secondary is that button, with its own fill, so it is not judged
        // here (a class inside :not() does not count as naming it).
        const subjects = selector.replace(/:has\([^)]*\)/g, "").split(",")
          .map((x) => x.trim().split(/\s+|>/).filter(Boolean).pop() ?? "");
        const isCapsule = (x: string) => /\.(pill-act|row-act)(?![\w-])/.test(x)
          || (/\.btn-sm(?![\w-])/.test(x) && !/\.btn-(primary|danger|secondary)(?![\w-])/.test(x.replace(/:not\([^)]*\)/g, "")));
        if (!subjects.some(isCapsule)) continue;
        if (/(^|[;\s])background:\s*(?!none\b)(?!0\b)/.test(body)) {
          offenders.push(file + " — " + selector.split("\n").pop()!.trim());
        }
      }
    }
    expect(offenders, "each of these would paint its fill across the hit border").toEqual([]);
  });

  it("the head action and the state word are NOT swept in", () => {
    // §O.7: the one sanctioned bare-text control. §AA G5 + astra.test.ts: a
    // state word is small caps and never a filled pill. A sweep that gives
    // every control a capsule must not reach these two.
    // AMENDED 2026-09-26 (round-1 review): this read `.sec-head .see-all`,
    // the first rule containing the words, and never the base rule the
    // phase recoloured. It reads the base rule exactly now, and fails if the
    // rule is renamed rather than quietly matching nothing.
    const seeAll = exactRule(CSS, ".see-all");
    expect(seeAll, "the base head action rule is still in the sheet").toBeTruthy();
    expect(seeAll, "the head action stays bare text").toMatch(/background:\s*0|background:\s*none|background:\s*transparent/);
    expect(seeAll, "no capsule fill").not.toMatch(/background-color/);
    expect(seeAll, "and no capsule shape").not.toMatch(/border-radius/);
    expect(seeAll, "its words are the tap red (§AM)").toMatch(/(^|[;\s])color:\s*var\(--tint\)/);
    expect(exactRule(CSS, '[data-theme="light"] .see-all'), "and the words red in light")
      .toMatch(/(^|[;\s])color:\s*var\(--on-light-red\)/);
    const st = /\.fact\.st\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? "";
    expect(st, "the state word takes no fill").not.toMatch(/background/);
    expect(st, "and no radius").not.toMatch(/border-radius/);
  });
});
