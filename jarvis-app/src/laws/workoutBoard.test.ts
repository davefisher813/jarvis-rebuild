import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { posix } from "node:path";

// ---------------------------------------------------------------------------
// LAW: THE WORKOUT BOARD'S GEOMETRY (Dave's approved board 2026-10-16; his
// 2026-10-17 correction on the phone: "The spacing and format is all messed
// up. It's not scaled accordingly and doesn't look like the preview.")
//
// The board is the exact standard for the six workout screens, not an
// inspiration: its phone frame is 390 wide, so its CSS values apply 1:1 at the
// app's viewport. The 2026-10-17 pass measured every key run of the real
// screens against the board's DOM and brought them within 2px; this law pins
// the numbers that pass read off the board's CSS, so the next pass over these
// screens cannot quietly let them drift back to the app-wide steps (24px
// cards, 56px buttons, 20px screen padding, a 34px hero) that Dave photographed.
//
// Everything is scoped: .wo-screen on the five gym screens and the Health
// hub, .wo-sheet on Doing Today. No other screen moves.
// ---------------------------------------------------------------------------

const { join } = posix;
const SRC = join(process.cwd().replace(/\\/g, "/"), "src");
const read = (f: string) => readFileSync(join(SRC, f), "utf8");
const RULED = read("styles/ruled.css").replace(/\/\*[\s\S]*?\*\//g, "");
const TOKENS = read("styles/jarvis-design-system.css");

/** The body of the first rule whose selector list contains `sel` exactly (as one comma-separated selector). */
function body(css: string, sel: string): string {
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const sels = m[1]!.split(",").map((x) => x.replace(/\s+/g, " ").trim());
    if (sels.includes(sel)) return m[2]!;
  }
  throw new Error(`no rule for ${sel}`);
}
/** Every rule body whose selector list contains `sel`, joined; the block adds to a few selectors more than once. */
function bodies(css: string, sel: string): string {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const sels = m[1]!.split(",").map((x) => x.replace(/\s+/g, " ").trim());
    if (sels.includes(sel)) out.push(m[2]!);
  }
  if (!out.length) throw new Error(`no rule for ${sel}`);
  return out.join(" ");
}
const token = (name: string) => new RegExp(`--${name}:\\s*([^;]+);`).exec(TOKENS)?.[1]?.trim() ?? "";
const SCOPE = ".ruled.health-ruled.wo-screen";
const SHEET = ".sheet-scrim > .card.wo-sheet";

describe("LAW: the workout board's geometry", () => {
  it("the six screens carry the scope: the session, the day, History, the exercise page, the hub, Doing Today", () => {
    expect(read("gym/SessionScreen.tsx")).toContain('className="screen ruled health-ruled screen-session wo-screen"');
    expect(read("gym/GymFlow.tsx")).toContain('<div className="screen ruled health-ruled wo-screen">');
    expect(read("gym/HistoryScreen.tsx")).toContain('className="screen ruled health-ruled wo-screen screen-history"');
    expect(read("gym/LiftDetailScreen.tsx")).toContain('className="screen ruled health-ruled wo-screen"');
    expect(read("brain/CategoryDetail.tsx")).toContain('kind === "health" ? " health-ruled wo-screen" : " area-ruled"');
    expect(read("gym/FitSheet.tsx")).toContain('className="card wo-sheet"');
  });

  it("the card: 14 inside, 16 corners (re-bound in scope, flagged against the 24 of 2026-10-05), a 1px soft border", () => {
    const scope = body(RULED, SCOPE);
    expect(scope).toMatch(/--r-card:\s*16px/);
    expect(token("s-3h"), "the 14 step the card padding reads").toBe("14px");
    expect(body(RULED, `${SCOPE} .card.pad`)).toMatch(/padding:\s*var\(--s-3h\)/);
    expect(body(RULED, `${SCOPE} .card`)).toMatch(/border-width:\s*1px/);
  });

  it("the row: 11 above and below, 14 at the sides, the name 15 / 700 and the line under it 12.5", () => {
    expect(bodies(RULED, `${SCOPE} .list-card-ruled > .row`)).toMatch(/padding:\s*11px var\(--s-3h\)/);
    expect(body(RULED, `${SCOPE} .row > .row-press`)).toMatch(/padding:\s*11px var\(--s-3h\)/);
    const scope = body(RULED, SCOPE);
    expect(scope).toMatch(/--t-name:\s*calc\(15px \* var\(--type-scale\)\)/);
    expect(scope).toMatch(/--t-sub:\s*calc\(12\.5px \* var\(--type-scale\)\)/);
    expect(token("w-name"), "the name's weight is the app's own 700").toBe("var(--w-semi)");
  });

  // THE SECOND MEASURE (2026-10-17): the eleven rows the first pass left were closed where the six screens allow it.
  it("a card of plain rows is padded 4 above and below them, so the first row starts 16 from the card's edge, not 15", () => {
    expect(token("s-1")).toBe("4px");
    const plain = `${SCOPE} .list-card-ruled:has(> .row):not(:has(> .grp)):not(:has(> .row > .row-grow > .eyebrow))`;
    expect(body(RULED, plain)).toMatch(/padding:\s*var\(--s-1\) 0/);
    // The day page's rows sit in a nested .reorder-list card, so that card's rows count too.
    expect(body(RULED, `${SCOPE} .list-card-ruled:has(> .reorder-list > .row):not(:has(> .grp)):not(:has(> .row > .row-grow > .eyebrow))`)).toMatch(/padding:\s*var\(--s-1\) 0/);
    expect(body(RULED, `${SHEET} .list-card-ruled:has(> .row)`)).toMatch(/padding:\s*var\(--s-1\) 0/);
    // The 14 first row that stood in for it is gone from both scopes.
    expect(RULED).not.toMatch(/\.list-card-ruled > \.row:first-child(?: > \.row-press)? \{ padding-top: var\(--s-3h\); \}/);
  });

  it("the board's setting row (a lever, a goal, a milestone): 14 / 700 over 12 with nothing between, and the toggle 46 by 27", () => {
    expect(read("gym/FitSheet.tsx")).toContain('className="row fit-lever"');
    // Through the two type tokens, re-bound on the row (the type law), never a size written on the name or the line.
    const row = body(RULED, `${SHEET} .fit-lever`);
    expect(row).toMatch(/--t-name:\s*calc\(14px \* var\(--type-scale\)\)/);
    expect(row).toMatch(/--t-sub:\s*calc\(12px \* var\(--type-scale\)\)/);
    expect(body(RULED, `${SCOPE} .lift-goals .row`)).toMatch(/--t-name:\s*calc\(14px \* var\(--type-scale\)\)/);
    expect(body(RULED, `${SHEET} .fit-lever .conn-meta`)).toMatch(/margin-top:\s*0/);
    expect(bodies(RULED, `${SCOPE} .lift-goals .row .facts`)).toMatch(/margin-top:\s*0/);
    const toggle = body(RULED, `${SHEET} .switch`);
    expect(toggle).toMatch(/width:\s*46px/);
    expect(toggle).toMatch(/height:\s*27px/);
    expect(body(RULED, `${SHEET} .switch::after`)).toMatch(/width:\s*21px; height:\s*21px; top:\s*3px; left:\s*3px/);
    expect(body(RULED, `${SHEET} .switch:not(.off)::after`)).toMatch(/translateX\(19px\)/);
    // The whole lever row flips the switch, so the row is the tap and stands over 44 (FitSheet: onClick on the row).
    expect(read("gym/FitSheet.tsx")).toMatch(/className="row fit-lever" key=\{o\.key\} onClick=\{\(\) => toggle\(o\.key\)\}/);
  });

  it("History: the card padded 2, its rows 12, the done mark 12 wide", () => {
    expect(token("s-0h")).toBe("2px");
    expect(body(RULED, `${SCOPE}.screen-history .list-card-ruled:has(> .row)`)).toMatch(/padding:\s*var\(--s-0h\) 0/);
    expect(body(RULED, `${SCOPE}.screen-history .list-card-ruled > .row`)).toMatch(/padding:\s*var\(--s-3\) var\(--s-3h\)/);
    expect(body(RULED, `${SCOPE} .hist-done`)).toMatch(/width:\s*12px; height:\s*12px/);
  });

  it("the session's warm-up items sit 10 and 4 apart under the Skip capsule; the day's 8 and 3", () => {
    expect(body(RULED, `${SCOPE} .list-card-ruled > .grp ~ .row`)).toMatch(/padding:\s*var\(--s-2h\) var\(--s-3h\) 0/);
    expect(body(RULED, `${SCOPE} .list-card-ruled > .grp ~ .row ~ .row`)).toMatch(/padding-top:\s*var\(--s-1\)/);
    expect(body(RULED, `${SCOPE} .list-card-ruled > .row:has(> .row-grow > .eyebrow) ~ .row`)).toMatch(/padding:\s*var\(--s-2\) var\(--s-3h\) 0/);
    expect(body(RULED, `${SCOPE} .list-card-ruled > .row:has(> .row-grow > .eyebrow) ~ .row ~ .row`)).toMatch(/padding-top:\s*3px/);
  });

  it("the weekly bars are a 64 box with 8 above a 56 track that stretches to the card, and the small corner is the board's 5", () => {
    const bars = body(RULED, `${SCOPE} .lift-bars`);
    expect(bars).toMatch(/height:\s*64px/);
    expect(bars).toMatch(/padding-top:\s*var\(--s-2\)/);
    expect(body(RULED, `${SCOPE} .card.pad > .eyebrow:has(+ .lift-bars)`)).toMatch(/margin-bottom:\s*0/);
    expect(read("gym/LiftDetailScreen.tsx")).toMatch(/<svg className="lift-bars" viewBox=\{`0 0 \$\{CHART_W\} \$\{H\}`\} preserveAspectRatio="none"/);
    expect(body(RULED, SCOPE), "the PR tag's and the week bar's corner, re-bound like --r-card").toMatch(/--r-xs:\s*5px/);
    expect(body(RULED, `${SCOPE} .se-pr`)).toMatch(/border-radius:\s*var\(--r-xs\)/);
    expect(body(RULED, `${SCOPE} .h-bar i`)).toMatch(/border-radius:\s*var\(--r-xs\)/);
  });

  it("the eyebrow: 11 / 700 / .08em", () => {
    const b = body(RULED, `${SCOPE} .eyebrow`);
    expect(b).toMatch(/font-size:\s*calc\(11px \* var\(--type-scale\)\)/);
    expect(b).toMatch(/font-weight:\s*var\(--w-semi\)/);
    expect(b).toMatch(/letter-spacing:\s*0\.08em/);
  });

  it("the buttons: the red one 15 / 700 with 14 above and below on 12 corners; a neutral 14 / 600 with 12, reaching 44 by its ::after", () => {
    expect(body(RULED, SCOPE)).toMatch(/--r-field:\s*12px/);
    const red = body(RULED, `${SCOPE} .btn-lg`);
    expect(red).toMatch(/padding:\s*var\(--s-3h\) var\(--s-3\)/);
    expect(red).toMatch(/font-size:\s*calc\(15px \* var\(--type-scale\)\)/);
    expect(red).toMatch(/border-radius:\s*var\(--r-field\)/);
    const neutral = body(RULED, `${SCOPE} .btn-secondary:not(.btn-sm)`);
    expect(neutral).toMatch(/padding:\s*var\(--s-3\)/);
    expect(neutral).toMatch(/font-size:\s*calc\(14px \* var\(--type-scale\)\)/);
    expect(neutral).toMatch(/border-radius:\s*var\(--r-field\)/);
    expect(body(RULED, `${SCOPE} .btn-secondary:not(.btn-sm)::after`)).toMatch(/inset:\s*-2px 0/);
    // The pills: 12 / 600, 7 by 11, and the 44 reach.
    const pill = body(RULED, `${SCOPE} .btn-sm`);
    expect(pill).toMatch(/padding:\s*7px 11px/);
    expect(pill).toMatch(/font-size:\s*calc\(12px \* var\(--type-scale\)\)/);
    expect(body(RULED, `${SCOPE} .day-acts .btn::after`)).toMatch(/inset:\s*-8px 0/);
  });

  it("the screen: 16 at the sides and 12 between blocks", () => {
    expect(body(RULED, `${SCOPE} .pad-x`)).toMatch(/padding-left:\s*16px; padding-right:\s*16px/);
    expect(body(RULED, `${SCOPE} > .pad-x + .pad-x`)).toMatch(/margin-top:\s*var\(--s-3\)/);
    expect(token("s-3")).toBe("12px");
  });

  it("the hub: no hero, a 24 / 800 headline, a 56 track with 30 to 42 trained bars over 10 rest bars, 6 apart", () => {
    const hub = read("brain/HealthBody.tsx");
    expect(hub, "the large title is gone, not shrunk").not.toContain('className="nav-large"');
    expect(hub).toMatch(/30 \+ Math\.round\(\(d\.activeMin \/ maxMin\) \* 12\)/);
    const t = body(RULED, `${SCOPE} .h-hero-t`);
    expect(t).toMatch(/font-size:\s*calc\(24px \* var\(--type-scale\)\)/);
    expect(t).toMatch(/font-weight:\s*var\(--w-bold\)/);
    const bars = body(RULED, `${SCOPE} .h-bars`);
    expect(bars).toMatch(/height:\s*56px/);
    expect(bars).toMatch(/gap:\s*var\(--s-1h\)/);
    expect(token("s-1h")).toBe("6px");
    expect(body(RULED, ".ruled.health-ruled .h-bar i"), "a rest day's bar").toMatch(/height:\s*10px/);
    expect(body(RULED, `${SCOPE} .h-bar`)).toMatch(/font-size:\s*calc\(10px \* var\(--type-scale\)\)/);
  });

  it("the session: the name 34 / 800 on the page, boxed 26 / 800 fields over 11 / 700 units, 7px dots 5 apart", () => {
    expect(read("gym/SessionScreen.tsx")).toContain('className="card pad se-head"');
    expect(body(RULED, `${SCOPE} .se-head`)).toMatch(/background:\s*transparent/);
    const name = body(RULED, `${SCOPE} .se-head .p3-q`);
    expect(name).toMatch(/font-size:\s*calc\(34px \* var\(--type-scale\)\)/);
    expect(name).toMatch(/line-height:\s*1;/);
    expect(read("gym/SetStrip.tsx")).toContain('<span className="se-field">');
    expect(body(RULED, `${SCOPE} .se-grid .set-field`)).toMatch(/font-size:\s*calc\(26px \* var\(--type-scale\)\)/);
    expect(body(RULED, `${SCOPE} .se-field`)).toMatch(/padding:\s*var\(--s-3\)/);
    expect(body(RULED, `${SCOPE} .se-dots`)).toMatch(/gap:\s*5px/);
    expect(body(RULED, ".ruled.health-ruled .se-dot")).toMatch(/width:\s*7px/);
    // The Details chips: a grid of four, 8 apart, a 10 kicker over a 14 / 600 value.
    expect(body(RULED, `${SCOPE} .card.se-facts`)).toMatch(/grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
    expect(bodies(RULED, `${SCOPE} .se-facts .se-chip em`)).toMatch(/font-size:\s*calc\(10px \* var\(--type-scale\)\)/);
  });

  it("Doing Today: a 22 / 800 title, pills 12 / 600 at 7 by 11", () => {
    expect(body(RULED, `${SHEET} .fit-title`)).toMatch(/font-size:\s*calc\(22px \* var\(--type-scale\)\)/);
    expect(body(RULED, `${SHEET} .chip`)).toMatch(/padding:\s*7px 11px/);
  });

  it("the exercise page: the name 24 / 800, History's length 14 / 700, the PR mark 10.5", () => {
    expect(body(RULED, `${SCOPE} .lift-title`)).toMatch(/font-size:\s*calc\(24px \* var\(--type-scale\)\)/);
    expect(body(RULED, `${SCOPE} .row-value > .fact > b`)).toMatch(/font-size:\s*calc\(14px \* var\(--type-scale\)\)/);
    expect(body(RULED, `${SCOPE} .se-pr`)).toMatch(/font-size:\s*calc\(10\.5px \* var\(--type-scale\)\)/);
  });

  // THE ALL DATA ROWS SHARE ONE ANCHOR (Dave's screenshot, 2026-10-17: on an exercise row carrying The Sets expander the
  // dot and the chevron floated under the name line). CSS only: the row is a grid, the dot and the chevron span the name
  // and the facts and centre on them, the expander takes its own row under the words.
  it("an All Data row anchors its dot and its chevron on the name-plus-facts block, the expander on its own row beneath", () => {
    const row = body(RULED, `${SCOPE} .row.h-log-row`);
    expect(row).toMatch(/display:\s*grid/);
    expect(row).toMatch(/grid-template-columns:\s*auto minmax\(0, 1fr\) auto/);
    expect(row).toMatch(/grid-template-rows:\s*auto auto auto/);
    expect(row).toMatch(/row-gap:\s*0/);
    expect(body(RULED, `${SCOPE} .h-log-row > .row-grow`)).toMatch(/display:\s*contents/);
    expect(body(RULED, `${SCOPE} .h-log-row > .h-log-ico`)).toMatch(/grid-row:\s*1 \/ 3; align-self:\s*center/);
    expect(body(RULED, `${SCOPE} .h-log-row > .row-grow ~ *`)).toMatch(/grid-row:\s*1 \/ 3; align-self:\s*center/);
    expect(body(RULED, `${SCOPE} .h-log-row > .row-grow > .ad-sets`)).toMatch(/grid-row:\s*3/);
    // The row's markup is as it was: the dot, the words with the expander inside them, the chevron or the menu.
    const page = read("insights/AllDataPage.tsx");
    expect(page).toContain('className="row h-log-row"');
    expect(page).toContain('<span className="h-log-ico ad-dot" data-hue={r.hue} aria-hidden="true"><i /></span>');
    expect(page).toMatch(/<details className="exp-more ad-sets"/);
  });

  // THE START SURFACE IS ONE ACTION (Dave 2026-10-17; overrides the board's heading, grey line and red Start on screen 6).
  it("the hub's next day is the red button itself: two lines, the facts in the button's own white at the small size, the small capsules under it", () => {
    const hub = read("brain/HealthBody.tsx");
    expect(hub).toContain('className="btn btn-primary btn-launch btn-lg btn-block h-hero-go" onClick={() => onStart(next.day.id)}');
    expect(hub).toContain('<span className="h-hero-go-t">{`Start ${workoutTitle(next.day.name)}`}</span>');
    expect(hub).toContain('<div className="day-acts h-hero-acts">');
    expect(body(RULED, `${SCOPE} .h-hero-cta .h-hero-go`)).toMatch(/flex-direction:\s*column/);
    const facts = body(RULED, `${SCOPE} .h-hero-go > .facts`);
    expect(facts).toMatch(/color:\s*inherit/);
    expect(facts).toMatch(/font-size:\s*var\(--t-sub\)/);
    expect(facts, "weight is the facts' own (the type law)").not.toMatch(/font-weight/);
    expect(body(RULED, `${SCOPE} .h-hero-go > .facts > .fact`)).toMatch(/color:\s*inherit/);
    // The capsules are the day page's: 12 / 600 at 7 by 11 with the 44 reach by ::after (pinned above).
    expect(body(RULED, `${SCOPE} .h-hero-cta .day-acts`)).toMatch(/margin-top:\s*0/);
  });

  it("and nothing in the block names a colour of its own", () => {
    const at = RULED.indexOf(".ruled.health-ruled.wo-screen, .sheet-scrim > .card.wo-sheet {");
    expect(at).toBeGreaterThan(-1);
    const block = RULED.slice(at);
    // A hex or rgb() in the geometry block would be a colour change; every colour it touches is a token the screen
    // already wears (the chip fill, the card border, the primary ink, the divider).
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
});
