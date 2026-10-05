// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ReadinessSheet from "./strands/ReadinessSheet";
import { readiness, watchingCount, type Readiness } from "./readiness";

// THE BRAIN REVIEW OF 2026-10-05 (Dave: "Everything should look PERFECT. He opens the app and finds nothing."). Each test names the
// defect it holds and fails without the change. jsdom draws no stylesheet, so a rule is checked from the CSS text.

const CSS = ["jarvis-design-system.css", "components.css", "ruled.css", "editor.css"]
  .map((f) => readFileSync(join(process.cwd(), "src/styles", f), "utf8")).join("\n");
const BARE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
/** Every declaration block whose selector list contains `sel`, in source order (the last wins). */
const rules = (sel: string) => [...BARE.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => m[1]!.split(",").some((s) => s.trim() === sel)).map((m) => m[2]!);
const last = (sel: string) => rules(sel).at(-1) ?? "";

describe("a fact is never cut where there is room", () => {
  it("a sheet's facts wrap (the readiness sheet's count and state, never '21 Completio...')", () => {
    expect(last(".sheet-scrim > .card .facts > .fact")).toMatch(/white-space:\s*normal/);
    expect(last(".sheet-scrim > .card .facts > .fact")).toMatch(/overflow:\s*visible/);
    expect(last(".sheet-scrim > .card .facts")).toMatch(/overflow:\s*visible/);
  });

  // A ROW'S ONE LINE IS AN ECONOMY, SO THE COPY IS WRITTEN TO FIT IT (Dave 2026-10-05, the review: "0 of 10 Emails with One Per..." and "0 of 1
  // Labelled People with ..." ended in an ellipsis beside the state word). The count is the row's fact; the full sentence of what it counts
  // is the sheet's "How It Is Counted". At 390 the room after the state word is about 27 characters.
  it("no detector's count on a row is long enough to be cut: the unit is short, and the whole sentence lives in the sheet", () => {
    const rows = readiness([], [], [], Date.now());
    expect(rows).toHaveLength(8);
    for (const r of rows) {
      const count = watchingCount({ have: 0, need: r.need, unit: r.unit });
      expect(count.length, count).toBeLessThanOrEqual(30);
      expect(count, count).not.toMatch(/\bwith\b/i);
    }
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(watchingCount(byKey.people_rhythm!)).toBe("0 of 10 Emails");
    expect(watchingCount(byKey.gone_quiet!)).toBe("0 of 1 Labeled People");
    // What was cut from the row is still said where there is room for it: every row carries its sentence for the sheet.
    expect(rows.every((r) => (r.detail ?? "").length > 0)).toBe(true);
  });
});

describe("the readiness row a tap landed on settles; it is not a stuck red state", () => {
  it("the focus mark fades to nothing in about a second, in a warm neutral and never the brand or system red", () => {
    expect(last(".ruled .rdy-row-focus")).toMatch(/animation:\s*rdyRowFocus\s+1\.2s/);
    expect(last(".ruled .rdy-row-focus")).toMatch(/forwards/);
    const kf = BARE.match(/@keyframes rdyRowFocus\s*\{([\s\S]*?\}\s*)\}/)![1]!;
    expect(kf).toMatch(/100%\s*\{\s*background:\s*transparent/);
    expect(kf).not.toMatch(/red|--tint|--accent|--sys-red|#ff|rgba\(2[0-9]{2},\s*[0-9]{1,2},/i);
  });
});

describe("the filter chips are one row that scrolls, and the picked one reads at a glance in both themes", () => {
  it("a chip row never wraps (it scrolls, its chips hold their width), so 'Needs Confirmation' is never alone on a second line", () => {
    expect(rules(".chip-row").join(" ")).toMatch(/overflow-x:\s*auto/);
    expect(rules(".chip-row > .chip").join(" ")).toMatch(/flex-shrink:\s*0/);
    expect(rules(".chip-row > .chip").join(" ")).toMatch(/white-space:\s*nowrap/);
    expect(rules(".chip-row").join(" ")).not.toMatch(/flex-wrap:\s*wrap/);
  });

  it("the picked chip is the ink pill in both themes: one rule, and no light-only override handing it back to a white pill", () => {
    expect(last(".chip.active")).toMatch(/background:\s*var\(--sel-bg\)/);
    expect(last(".chip.active")).toMatch(/color:\s*var\(--sel-fg\)/);
    // Light's ink is a dark warm near-black, so picked is dark on cream and light on charcoal.
    expect(CSS).toMatch(/--sel-bg:\s*#2A231D/);
    expect(BARE).not.toMatch(/\[data-theme="light"\]\s*\.chip\.active\s*\{[^}]*background:\s*var\(--(chrome-bg|surface-1)\)/);
  });
});

const row = (over: Partial<Readiness>): Readiness => ({ key: "completion_window", label: "When Tasks Get Done", have: 21, need: 10, unit: "completions", state: "known", ...over });

describe("the readiness sheet says its two facts in full, and its state word is not a button's name", () => {
  const show = (r: Readiness) => render(<ReadinessSheet r={r} onTell={() => {}} onClose={() => {}} />);

  it("a known detector: the count in white, and what is missing in the key's green", () => {
    show(row({}));
    const facts = [...document.querySelectorAll(".facts > .fact")];
    expect(facts.map((f) => f.textContent)).toEqual(["21 Completions", "JARVIS Already Knows This"]);
    expect(facts[0]!.querySelector("b")).not.toBeNull();
    expect(facts[1]!.className).toContain("good");
  });

  it("a ready detector reads Ready to Accept in amber; a short one says how many more to go, in the one grey", () => {
    const { unmount } = show(row({ state: "ready", have: 12, need: 10 }));
    expect(screen.getByText("Ready to Accept").className).toContain("warn");
    unmount();
    show(row({ state: "close", have: 7, need: 10 }));
    const more = screen.getByText("3 More to Go");
    expect(more.className).toBe("fact");
    // No fact is longer than a phone can hold in two lines, so none needs an ellipsis to fit.
    for (const f of document.querySelectorAll(".facts > .fact")) expect(f.textContent!.length).toBeLessThan(40);
  });

  it("the way out is Done, and no word on the sheet reads as a button: the state is said once, in the facts", () => {
    show(row({ state: "close", have: 7, need: 10 }));
    // Round 2 review: an amber CLOSE kicker (the state word) over an amber "Ready to Accept" said one thing twice and read as a
    // dismiss beside Done. The kicker names the sheet; the state is the facts line's alone.
    expect(document.querySelector(".eyebrow .fact")).toBeNull();
    expect(document.querySelector(".eyebrow")!.textContent).toBe("Readiness");
    expect(screen.queryByText("Close")).toBeNull();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("says what telling it does, in one warm sentence per state, and shows how it is counted without a tap", () => {
    const hint = () => document.querySelector(".input-hint")!.textContent!;
    const { unmount } = show(row({ state: "ready", have: 12, need: 10, detail: "Needs 10 completions" }));
    expect(hint()).toBe("JARVIS has seen enough to say this out loud, so tell it in your own words and it will remember");
    expect(document.querySelector("details.exp-more")!.hasAttribute("open")).toBe(true);
    unmount();
    for (const state of ["known", "close", "waiting", "muted"] as const) {
      const u = show(row({ state, have: 3, need: 10 }));
      expect(hint().length, state).toBeGreaterThan(30);
      // One sentence: no full stop followed by a capital anywhere in the line.
      expect(hint(), state).not.toMatch(/\. [A-Z]/);
      u.unmount();
    }
  });

  it("the counting rule sits behind a labelled disclosure, in Title Case", () => {
    show(row({ state: "close", have: 7, need: 10, detail: "Needs 10 completions, with one 3-hour stretch holding 40 percent of them" }));
    expect(document.querySelector("details.exp-more summary")!.textContent).toBe("How It Is Counted");
    expect(document.querySelector("details.exp-more .conn-meta")!.textContent).toBe("Needs 10 Completions, with One 3-Hour Stretch Holding 40 Percent of Them");
  });
});

// THE ROUND 2 REVIEW (2026-10-05): what the stylesheet has to say for the Brain screens. jsdom draws no CSS, so each rule is read as text.
describe("round 2: the Brain's stylesheet", () => {
  it("a hub card of glyph rows draws every hairline from the name's edge, the same place the Explore card does", () => {
    expect(last(".card.glyph-rows .row.strand-row + .row.strand-row::before")).toMatch(/left:\s*calc\(var\(--s-4\)\s*\+\s*30px\s*\+\s*var\(--s-3h\)\)/);
    expect(last(".ruled .card.shell-rows.glyph-rows > .pad-x + .pad-x::before")).toMatch(/left:\s*calc\(var\(--s-4\)\s*\+\s*30px\s*\+\s*var\(--s-3h\)\)/);
  });

  it("the stacked suggestion's capsule paints the full 44 with the card's own air round it, and its Dismiss shares the line", () => {
    expect(last(".notice-stack")).toMatch(/padding:\s*0 var\(--s-4\) var\(--s-4\)/);
    const pill = last(".notice-stack > .pill-act");
    expect(pill).toMatch(/border-top-width:\s*0/);
    expect(pill).toMatch(/border-bottom-width:\s*0/);
    expect(pill).toMatch(/margin-block:\s*0/);
    expect(last(".notice-stack > .notice-x")).toMatch(/margin-right:\s*calc\(-1 \* var\(--s-2\)\)/);
  });

  it("the suggestion's disc is a soft wash of its tone, not a solid fill that outshouts the action", () => {
    expect(last(".strand-notices .notice-disc.cat-bg-yellow")).toMatch(/background-color:\s*color-mix\(in srgb, var\(--cat-yellow\) 18%, transparent\)/);
    expect(last('[data-theme="light"] .strand-notices .notice-disc.cat-bg-yellow')).toMatch(/color:\s*var\(--cat-ic-yellow\)/);
  });

  it("the filter row fades a little wider than the shared one, so a cut chip reads as 'more this way'", () => {
    expect(last(".chip-row.strand-filters")).toMatch(/calc\(100% - 56px\)/);
  });

  it("the picked segment in dark is the raised warm grey, and a segmented control with nothing picked shows its segments", () => {
    const dark = last('[data-theme="dark"] .segmented .seg.active');
    expect(dark).toMatch(/background:\s*var\(--surface-3\)/);
    expect(dark).not.toMatch(/--sel-bg/);
    expect(last(".segmented:not(:has(.seg.active)) .seg + .seg")).toMatch(/border-left:\s*0\.5px solid var\(--tx-4\)/);
    expect(last(".segmented:not(:has(.seg.active))")).toMatch(/box-shadow:\s*inset 0 0 0 0\.5px var\(--tx-4\)/);
  });

  it("an empty state under its own head sits a step below it, not a page's worth", () => {
    expect(last(".sh2 + .empty-state.empty-compact")).toMatch(/padding-top:\s*var\(--s-3\)/);
  });

  it("a decision's title and its row's name balance across their lines, so no word is left alone", () => {
    expect(last(".pagehead-title.dec-hero")).toMatch(/text-wrap:\s*balance/);
    expect(last(".dec-name")).toMatch(/text-wrap:\s*balance/);
  });

  it("an empty Brain doc centres its state in the room under its title (two thirds of the window), and the contact page does too when nothing sits under it", () => {
    expect(last(".doc-body > .empty-state.empty-fill")).toMatch(/min-height:\s*66vh/);
    expect(last(".person-ruled > .empty-state:not(:has(~ .sh2))")).toMatch(/min-height:\s*42vh/);
  });

  it("the fold of idle detectors draws its own hairlines and wears the fold label's padding", () => {
    expect(last(".ruled .card.shell-rows .rdy-idle > .pad-x::before")).toMatch(/height:\s*0\.5px/);
    expect(last(".card .rdy-idle > summary")).toMatch(/padding-left:\s*var\(--s-4\)/);
  });
});
