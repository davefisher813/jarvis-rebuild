import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// THE CHROME HOLDS (Dave 2026-10-05: "Everything should look PERFECT"; decisions D3 to D6 of the review round). Two
// review passes of real screenshots, dark and light at 390x844, found the same handful of root causes under thirty
// defects: a top bar content read through, a capsule that was a different object by theme, icons that changed shape by
// theme, a return pill floating over rows, a dock that staggered its two lines, a Life strip that clipped its fifth tab.
// Each test below pins one root cause in the stylesheets so it cannot return unseen. The DOM halves live beside the
// components (VoiceBar, ReturnPill, LifeSegments, MorePage, AreasTab, ReminderDetailSheet).
// ---------------------------------------------------------------------------

const SRC = join(process.cwd(), "src");
const sheet = (f: string) => readFileSync(join(SRC, "styles", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const ALL = ["components.css", "ruled.css", "jarvis-design-system.css", "uniformity.css"].map(sheet).join("\n");
/** The bodies of every rule whose selector list contains `sel` exactly as one of its comma-separated members. */
const bodies = (sel: string): string[] => {
  const out: string[] = [];
  for (const m of ALL.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const parts = m[1]!.replace(/\s+/g, " ").split(",").map((p) => p.trim());
    if (parts.includes(sel)) out.push(m[2]!);
  }
  return out;
};
const joined = (sel: string) => bodies(sel).join(" ");

describe("D6: the top bar is opaque and nothing reads through it", () => {
  it("every condensed bar paints the page's own warm colour, not a translucent black or white", () => {
    for (const sel of [".nav-bar", ".pagebar.on", ".pagebar.solid"]) {
      const b = joined(sel);
      expect(b, sel + " has a ground").toMatch(/background-color:\s*var\(--bar-solid\)/);
      expect(b, sel + " is not translucent").not.toMatch(/rgba\(/);
    }
    // No light-only override puts the 90% white back.
    expect(ALL).not.toMatch(/\[data-theme="light"\] \.nav-bar \{/);
    expect(ALL).not.toMatch(/\[data-theme="light"\] \.pagebar\.(on|solid)[^{]*\{/);
  });

  it("--bar-solid is the page colour in both themes (it is defined once, as var(--bg))", () => {
    expect(sheet("jarvis-design-system.css")).toMatch(/--bar-solid:\s*var\(--bg\)/);
  });

  it("the condensed bar draws no stroke over the content scrolling under it, and the title stroke keeps a gap", () => {
    expect(ALL).not.toMatch(/\.pagebar\.on::after/);
    expect(joined(".pagehead-title::after")).toMatch(/margin-bottom:\s*var\(--s-3\)/);
  });
});

describe("D3: one capsule recipe, in both themes", () => {
  it("the in-list/section capsule (.row-act) is not a solid red slab in light", () => {
    const light = joined('[data-theme="light"] .row-act');
    expect(light).toMatch(/background-color:\s*var\(--capsule-fill\)/);
    expect(light).toMatch(/color:\s*var\(--on-light-red\)/);
    expect(light).not.toMatch(/accent-fill/);
    expect(light).not.toMatch(/color:\s*#fff/i);
  });

  it("the head capsule (.see-all.pill-action) is the capsule fill with the tap red, not --press-3 with dark ink", () => {
    const b = joined(".sh2 .see-all.pill-action");
    expect(b).toMatch(/background-color:\s*var\(--capsule-fill\)/);
    expect(b).toMatch(/color:\s*var\(--tint\)/);
    expect(b).not.toMatch(/var\(--tx-1\)/);
    expect(joined('[data-theme="light"] .sh2 .see-all.pill-action')).toMatch(/color:\s*var\(--on-light-red\)/);
  });

  it("a bar control (the round plus, Select) is the tap red in both themes", () => {
    expect(joined(".barbtn")).toMatch(/color:\s*var\(--tint\)/);
    expect(joined(".bar-text")).toMatch(/color:\s*var\(--tint\)/);
    expect(ALL).not.toMatch(/\[data-theme="light"\] \.barbtn/);
    expect(joined(".sched-open-plus")).toMatch(/color:\s*var\(--tint\)/);
  });

  it("a disabled primary is a washed copy of its own red with the label at full ink, never a faded whole", () => {
    const b = joined(".btn.btn-primary:disabled");
    expect(b).toMatch(/opacity:\s*1/);
    expect(b).toMatch(/color-mix\(in srgb, var\(--accent-fill\) 42%, transparent\)/);
    expect(b).toMatch(/color:\s*#fff/i);
  });
});

describe("D3: one glyph set in both themes", () => {
  it("the theme switch for filled icons is gone: outline at rest in light as in dark", () => {
    expect(ALL).not.toMatch(/\[data-theme="light"\] \.ic-out/);
    expect(ALL).not.toMatch(/\[data-theme="light"\] \.ic-fill/);
    expect(joined(".ic-fill")).toMatch(/display:\s*none/);
  });

  it("the fill shows only for the one that is on: the active tab, a pressed or selected control, the current page", () => {
    const shown = ALL.match(/([^{}]*)\{\s*display:\s*inline-block;?\s*\}/g)?.filter((r) => r.includes(".ic-fill")) ?? [];
    expect(shown.length).toBe(1);
    for (const state of [".tab.active", '[aria-pressed="true"]', '[aria-selected="true"]', '[aria-current="page"]']) {
      expect(shown[0], state).toContain(state);
    }
  });

  it("the light block overrides no size, weight or spacing token (the same words run the same width)", () => {
    const light = /\[data-theme="light"\]\s*\{([^{}]*)\}/.exec(sheet("jarvis-design-system.css"))?.[1] ?? "";
    expect(light).not.toMatch(/--(t|w|s|r|lh|track)-[a-z0-9-]+\s*:/);
  });
});

describe("D6: the dock is one line, fades the page into itself and its round buttons are one object", () => {
  it("fades the page with a page-colour gradient above the bar, behind the bar and under the toast and pill", () => {
    const b = joined(".voice-dock::before");
    expect(b).toMatch(/bottom:\s*100%/);
    expect(b).toMatch(/linear-gradient\(to top, var\(--bg\), transparent\)/);
    expect(b).toMatch(/pointer-events:\s*none/);
    expect(b).toMatch(/z-index:\s*-1/);
    expect(joined(".toast-dock")).toMatch(/z-index:\s*2/);
    expect(joined(".return-pill")).toMatch(/z-index:\s*2/);
  });

  it("the bar never wraps and the hint has no margin pushing it to the far edge", () => {
    expect(joined(".voice-bar")).toMatch(/flex-wrap:\s*nowrap/);
    expect(joined(".voice-hint")).not.toMatch(/margin-left:\s*auto/);
    expect(ALL).not.toMatch(/\[data-theme="light"\] \.voice-hint/);
    expect(ALL).not.toMatch(/\.voice-now/);
  });

  it("the two round buttons are the same size as the bar's height and share one ink", () => {
    const b = joined(".voice-search");
    expect(b).toMatch(/width:\s*56px/);
    expect(b).toMatch(/color:\s*var\(--tx-2\)/);
    expect(joined(".voice-bar")).toMatch(/min-height:\s*56px/);
  });
});

describe("the scroll box takes no clearance for a floating pill, because the pill no longer floats", () => {
  it(".app-scroll carries no --return-pad and .return-pill is not fixed", () => {
    expect(joined(".app-scroll")).not.toMatch(/return-pad/);
    expect(joined(".return-pill")).not.toMatch(/position:\s*fixed/);
    expect(ALL).not.toMatch(/--return-clear|--return-pad/);
  });
});

describe("the Today hero wash has no seam under the bar", () => {
  it("a page-colour ramp sits behind the words and over the glow, at the hero's top edge", () => {
    const b = joined(".today-hero::before");
    expect(b).toMatch(/top:\s*0/);
    expect(b).toMatch(/linear-gradient\(180deg, var\(--bg\), transparent\)/);
    expect(b).toMatch(/z-index:\s*-1/);
    expect(joined(".today-hero")).toMatch(/isolation:\s*isolate/);
  });
});

describe("a shelf of project and goal cards", () => {
  it("is not washed by its own footer scrim: the foot is under the title, and a pair or a lone card fills the gutters", () => {
    expect(sheet("ruled.css")).toMatch(/\.ruled \.bp-card-foot \{[^}]*z-index:\s*0/);
    expect(sheet("ruled.css")).toMatch(/\.ruled \.bp-grid > \.bp-card:only-child[\s\S]*?flex:\s*1 1 0/);
  });
});
