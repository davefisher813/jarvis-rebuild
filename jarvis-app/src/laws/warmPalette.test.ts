import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// THE WARM PALETTE AND THE CRAFT TOKENS (Dave 2026-10-05, locked in CLAUDE.md,
// "Row actions, warm neutrals and the perfect bar"). Every other screen sits
// on these tokens, so the values are pinned here with the reason, and the
// contrast the app promises is MEASURED from the tokens rather than asserted.
//
//   light  cream page #FAF6F0, warm cards, warm near-white chrome, warm ink
//   dark   warm charcoal #1C1917, never pure black, warm steps, warm-white ink
//   brand red #FF2B3C stays exactly as it is (and the light action red with it)
//   one radius language, an 8pt grid with generous air, ONE shadow recipe,
//   a rounded display face, springy press feedback gated by Reduce Motion.

const STYLES = join(__dirname, "..", "styles");
const read = (f: string) => readFileSync(join(STYLES, f), "utf8");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const DS = strip(read("jarvis-design-system.css"));
const SHEETS = ["components.css", "ruled.css", "uniformity.css", "jarvis-design-system.css", "editor.css", "email.css", "hub.css", "mail-rows.css"];

// A theme block is `[data-theme="x"] { ... }` at the top level of the file.
function block(theme: "dark" | "light"): string {
  const m = new RegExp("\\[data-theme=\"" + theme + "\"\\]\\s*\\{([\\s\\S]*?)\\n\\}").exec(DS);
  if (!m) throw new Error("no " + theme + " block");
  return m[1]!;
}
const rootBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(DS)![1]!;
const tok = (b: string, name: string): string => {
  const m = new RegExp("(?:^|[;\\s])" + name.replace(/-/g, "\\-") + ":\\s*([^;]+);").exec(b);
  if (!m) throw new Error(name + " is not declared");
  return m[1]!.trim();
};

const lum = (hex: string): number => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const ratio = (a: string, b: string): number => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

describe("the warm neutrals are the ones Dave locked", () => {
  it("light: a cream page, cards that step down, a warm near-white chrome, warm ink", () => {
    const L = block("light");
    expect(tok(L, "--bg"), "cream, never stark white as the dominant field").toBe("#FAF6F0");
    expect(tok(L, "--surface-1"), "cards are white on the cream (Dave 2026-10-05, the catalog)").toBe("#FFFFFF");
    expect(tok(L, "--surface-3"), "raised and secondary").toBe("#ECE5DA");
    expect(tok(L, "--chrome-bg"), "tab bar, top bars, sheets, modals").toBe("#FFFDFA");
    expect(tok(L, "--divider")).toBe("#E6DED2");
    expect(tok(L, "--tx-1")).toBe("#1F1A16");
    expect(tok(L, "--tx-2")).toBe("#4A423A");
    expect(tok(L, "--tx-3")).toBe("#5E554C");
  });

  it("dark: warm charcoal, never pure black, warm steps, warm-white ink", () => {
    const D = block("dark");
    expect(tok(D, "--bg")).toBe("#1C1917");
    for (const t of ["--bg", "--surface-1", "--surface-2", "--surface-3", "--capsule-fill"]) {
      expect(tok(D, t), t + " is never pure black").not.toMatch(/^#0{3}(0{3})?$/);
    }
    expect(tok(D, "--surface-2")).toBe("#2C2723");
    expect(tok(D, "--surface-3")).toBe("#36312D");
    expect(tok(D, "--tx-1")).toBe("#F7F1EA");
    expect(tok(D, "--tx-2"), "one grey per theme: --tx-2 and --tx-3 are the same hex").toBe(tok(D, "--tx-3"));
    expect(tok(D, "--tx-2")).toBe("#D6D0CA");
    expect(tok(D, "--card-bd"), "hairline borders are warm white at 8%").toBe("rgba(255,240,225,0.08)");
  });

  it("the page can never fall back to black or white: the document paints the token", () => {
    expect(DS).toMatch(/html\[data-theme="dark"\], html\[data-theme="dark"\] body \{ background-color: var\(--bg\) !important; \}/);
    expect(DS).toMatch(/html\[data-theme="light"\], html\[data-theme="light"\] body \{ background-color: var\(--bg\) !important; \}/);
  });

  it("no cool grey is left painting anything, in any stylesheet", () => {
    const COOL = /#(F5F6F8|F0F1F4|E1E4E9|111318|363A43|515661|737985|1C1C1E|2C2C2E|3A3A3C|17171A|D2D2D6|84848A)\b|rgba\(\s*(20,\s*20,\s*30|17,\s*18,\s*26|235,\s*235,\s*245|242,\s*242,\s*247)\b/i;
    const hits: string[] = [];
    for (const f of SHEETS) {
      strip(read(f)).split("\n").forEach((line, i) => { if (COOL.test(line)) hits.push(f + ":" + (i + 1) + " " + line.trim().slice(0, 90)); });
    }
    expect(hits, "a cool grey, stated as a literal").toEqual([]);
  });

  it("no pure black paints a surface, border, shadow or overlay (masks, the photo viewer and on-colours are not paint)", () => {
    const hits: string[] = [];
    for (const f of SHEETS) {
      const css = strip(read(f));
      for (const m of css.matchAll(/([a-z-]*(?:background|shadow|border|stroke|fill)[a-z-]*)\s*:\s*([^;}]*(?:#000\b|#000000|rgba\(\s*0,\s*0,\s*0\b)[^;}]*)/gi)) {
        const prop = m[1]!.toLowerCase();
        if (prop.includes("mask")) continue;
        const where = css.slice(Math.max(0, css.lastIndexOf("\n", m.index) - 120), m.index);
        if (/photo-viewer/.test(where + m[0])) continue;
        // a transparent black stop in a gradient interpolates to nothing; the
        // item-card scrim and the album art are media overlays, not surfaces
        if (/rgba\(0,\s*0,\s*0,\s*0\)/.test(m[2]!) && !/rgba\(0,\s*0,\s*0,\s*0\.\d/.test(m[2]!)) continue;
        // Media overlays darken a PHOTO under white text (a shelf card's image
        // scrim, an album-art tile); the colour of the ink on a fill is a token
        // (--on-fill-dark, held by the palette law). Neither is a surface.
        if (/linear-gradient\(/.test(m[2]!) && /rgba\(\s*0,\s*0,\s*0,\s*0?\.\d+\)/.test(m[2]!)) continue;
        if (prop === "--on-fill-dark") continue;
        hits.push(f + " " + m[0].trim().slice(0, 110));
      }
    }
    expect(hits).toEqual([]);
  });
});

describe("the brand red is exactly as it was", () => {
  it("#FF2B3C stays the signature in dark and the glyph red; light keeps its action red", () => {
    const D = block("dark");
    expect(tok(D, "--tint"), "dark tappable red").toBe("#FF2B3C");
    expect(tok(rootBlock, "--accent-glyph"), "the brand glyph red").toBe("#FF2B3C");
    expect(tok(D, "--accent-chrome")).toBe("#FF2B3C");
    const L = block("light");
    expect(tok(L, "--tint"), "light action red, white on it").toBe("#D12416");
    expect(tok(L, "--accent-fill")).toBe("#D12416");
    expect(DS, "never shifted toward coral").not.toMatch(/--(tint|accent-glyph|accent-chrome):\s*#(FF6B|FF7A|FF5)/i);
  });

  it("the semantic colours are unchanged: amber due, red late, green done", () => {
    const D = block("dark");
    const L = block("light");
    expect([tok(D, "--warn"), tok(D, "--good"), tok(D, "--sys-red")]).toEqual(["#FF9F0A", "#30D158", "#FF453A"]);
    expect([tok(L, "--warn"), tok(L, "--good"), tok(L, "--sys-red")]).toEqual(["#9A5305", "#037134", "#D12416"]);
  });
});

describe("every contrast the app promises still holds on the warm grounds", () => {
  const grounds = {
    light: { page: "#FAF6F0", card: "#FFFFFF", raised: "#ECE5DA", chrome: "#FFFDFA" },
    dark: { page: "#1C1917", card: "#201C19", sheet: "#2C2723", raised: "#36312D" },
  };
  for (const theme of ["light", "dark"] as const) {
    it(theme + ": text clears 4.5:1 and structure clears 3:1 on every ground it sits on", () => {
      const b = block(theme);
      for (const [name, g] of Object.entries(grounds[theme])) {
        for (const t of ["--tx-1", "--tx-2", "--tx-3", "--tx-quiet"]) {
          const v = tok(b, t);
          if (!v.startsWith("#")) continue; // an alpha ink is measured by browserWalk over its ground
          expect(ratio(v, g), theme + " " + t + " on " + name).toBeGreaterThanOrEqual(4.5);
        }
        expect(ratio(tok(b, "--tx-4"), g), theme + " --tx-4 (structure) on " + name).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it("light: a control outline clears the 3:1 non-text bar on every ground", () => {
    const o = tok(block("light"), "--ctl-outline");
    for (const [name, g] of Object.entries(grounds.light)) expect(ratio(o, g), "outline on " + name).toBeGreaterThanOrEqual(3);
  });

  it("light: the action red as words clears 4.5:1 on the page, the card and the chrome", () => {
    const red = tok(block("light"), "--tint");
    for (const g of [grounds.light.page, grounds.light.card, grounds.light.chrome]) {
      expect(ratio(red, g), "action red on " + g).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("dark: the brand red as words clears 4.5:1 on the page and the card", () => {
    const red = tok(block("dark"), "--tint");
    for (const g of [grounds.dark.page, grounds.dark.card]) expect(ratio(red, g), "tint on " + g).toBeGreaterThanOrEqual(4.5);
  });

  it("light: a capsule on a card is a lifted chip and on the sheet it is the page capsule, and the red clears both", () => {
    expect(DS).toMatch(/\[data-theme="light"\] \.card \{ --capsule-fill: #F2EDE4; \}/);
    expect(DS).toMatch(/\[data-theme="light"\] \.sheet-scrim > \.card \{ --capsule-fill: #F2EDE4; \}/);
    const red = tok(block("light"), "--tint");
    expect(ratio(red, "#F2EDE4"), "red on the chip").toBeGreaterThanOrEqual(4.5);
    expect(ratio("#F2EDE4", grounds.light.card), "the chip against the white card").toBeGreaterThan(1.05);
    expect(ratio("#F2EDE4", grounds.light.page), "the page capsule against the cream").toBeGreaterThan(1.06);
  });

  it("dark: the late red as words clears 4.5:1 on its own wash over the page and the card (the wash was 16% on a black page)", () => {
    const D = block("dark");
    const wash = Number(/rgba\(255,43,60,([\d.]+)\)/.exec(tok(D, "--red-tint"))![1]);
    const over = (fg: string, a: number, bg: string) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(fg.slice(i, i + 2), 16) * a + parseInt(bg.slice(i, i + 2), 16) * (1 - a)).toString(16).padStart(2, "0")).join("");
    for (const g of [grounds.dark.page, grounds.dark.card]) {
      expect(ratio(tok(D, "--sys-red"), over("#FF2B3C", wash, g)), "--sys-red on --red-tint over " + g).toBeGreaterThanOrEqual(4.5);
    }
    // the late-red chip's wash is a token, 14% in light and 8% in dark, and every late chip reads it
    const late = Number(/([\d.]+)%/.exec(tok(D, "--late-wash"))![1]) / 100;
    for (const g of [grounds.dark.page, grounds.dark.card]) {
      expect(ratio(tok(D, "--sys-red"), over(tok(D, "--sys-red"), late, g)), "--sys-red on its own late wash over " + g).toBeGreaterThanOrEqual(4.5);
    }
    expect(tok(block("light"), "--late-wash")).toBe("14%");
    const sheets = SHEETS.map((f) => strip(read(f))).join("\n");
    expect(sheets).not.toMatch(/color-mix\(in srgb, var\(--sys-red\) 1\d%, transparent\)/);
    // and the late red on a sheet's grouped card (the raised grey) clears too: "Oct 3" in the task sheet
    expect(ratio(tok(D, "--sys-red-on-sheet"), grounds.dark.raised), "late red on the raised group").toBeGreaterThanOrEqual(4.5);
    // and the card carries no sheen, which took the brand red on it to 4.41:1
    expect(tok(D, "--card-sheen")).toBe("transparent");
  });

  it("a capsule reads 4.5:1 with its label on its own opaque fill, in both themes, and keeps a visible edge", () => {
    for (const theme of ["light", "dark"] as const) {
      const b = block(theme);
      const fill = tok(b, "--capsule-fill");
      expect(fill, theme + " capsule fill is opaque").toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(ratio(tok(b, "--tint"), fill), theme + " --tint on the capsule").toBeGreaterThanOrEqual(4.5);
      // visible as a shape on the page it most often sits on (light: a step
      // darker than cream; dark: a sink deeper than the charcoal)
      expect(ratio(fill, grounds[theme].page), theme + " capsule against the page").toBeGreaterThan(1.06);
    }
  });
});

describe("one radius language, an 8pt grid with air, one shadow, one display face", () => {
  it("cards 24, fields and chips 16, pill buttons fully round, and the old names map onto it", () => {
    expect(tok(rootBlock, "--r-card")).toBe("24px");
    expect(tok(rootBlock, "--r-field")).toBe("16px");
    expect(tok(rootBlock, "--r-pill")).toBe("999px");
    expect([tok(rootBlock, "--r-lg"), tok(rootBlock, "--r-xl")], "both card names are the card radius").toEqual(["24px", "24px"]);
    expect(tok(rootBlock, "--r-md"), "the field radius").toBe("16px");
    expect(tok(rootBlock, "--r-inner"), "a card inside a card, concentric with the 24 outside").toBe("16px");
  });

  it("every card rule wears the card radius", () => {
    expect(DS).toMatch(/\.card \{[^}]*border-radius: var\(--r-card\)/);
    expect(strip(read("ruled.css"))).toMatch(/\.ruled \.card \{[^}]*border-radius: var\(--r-card\)/);
  });

  it("the grid: 8, 12, 20 (screen margin and card padding), 24, 32 (section gap)", () => {
    expect([tok(rootBlock, "--s-2"), tok(rootBlock, "--s-3"), tok(rootBlock, "--s-4"), tok(rootBlock, "--s-7"), tok(rootBlock, "--s-8")])
      .toEqual(["8px", "12px", "20px", "24px", "32px"]);
    expect(tok(rootBlock, "--screen-x")).toBe("var(--s-4)");
    expect(tok(rootBlock, "--card-pad")).toBe("var(--s-4)");
    expect(tok(rootBlock, "--section-gap")).toBe("var(--s-8)");
  });

  it("ONE shadow recipe: warm, y 8, blur 24, for what floats; a card at rest has none", () => {
    expect(tok(block("light"), "--shadow-float")).toBe("0 8px 24px rgba(92,64,38,0.08)");
    expect(tok(block("dark"), "--shadow-float")).toMatch(/^0 8px 24px rgba\(12,8,4,0\.\d+\)$/);
    expect(tok(block("light"), "--shadow-card")).toBe("none");
    expect(tok(block("dark"), "--shadow-card")).toBe("none");
  });

  it("no stylesheet draws a second shadow: only the recipe, a hairline ring, a glow of its own token, or none", () => {
    const bad: string[] = [];
    for (const f of SHEETS) {
      for (const m of strip(read(f)).matchAll(/box-shadow\s*:\s*([^;}]+)/g)) {
        const v = m[1]!.trim();
        // split on top-level commas
        const parts: string[] = []; let depth = 0; let cur = "";
        for (const ch of v) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && depth === 0) { parts.push(cur.trim()); cur = ""; } else cur += ch; }
        parts.push(cur.trim());
        for (const p of parts) {
          if (p === "none" || /^var\(--shadow-(float|card)\)$/.test(p)) continue;
          if (/^inset\b/.test(p) || /\binset$/.test(p)) continue;               // an inner edge, not elevation
          if (/^0 0 0 [\d.]+(px)? /.test(p) || /^0 [\d.]+px 0 var\(--divider\)$/.test(p)) continue; // a ring or a hairline
          if (/^0 0 [\d.]+px var\(--[a-z-]+\)$/.test(p)) continue;               // a glow of a dot's own token
          bad.push(f + ": " + p);
        }
      }
    }
    expect(bad, "a harsh or second shadow").toEqual([]);
  });

  it("the display face is a rounded system face that falls back to the system face, and the body face is untouched", () => {
    const fd = tok(rootBlock, "--f-display");
    expect(fd).toMatch(/^ui-rounded, "SF Pro Rounded", /);
    expect(fd).toMatch(/system-ui, sans-serif$/);
    expect(tok(rootBlock, "--f")).toBe('-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif');
    for (const cls of [".pagehead-title", ".today-title", ".nav-large", ".hero-num", ".money-hero-total"]) {
      expect(DS, cls + " wears the display face").toContain(cls);
    }
    expect(DS).toMatch(/font-family: var\(--f-display\);/);
  });

  it("times, money and counts are tabular", () => {
    expect(DS).toMatch(/\.sched-time[^{]*\.money-amt[^{]*\{ font-variant-numeric: tabular-nums; \}/);
  });
});

describe("motion: springy press feedback, entries, and Reduce Motion removes every transform", () => {
  it("the tokens: .97 on a spring over 100 to 200 ms, entries 200 to 300 ms ease-out", () => {
    expect(tok(rootBlock, "--press-scale")).toBe("0.97");
    expect(tok(rootBlock, "--ease-press")).toBe("cubic-bezier(0.34, 1.56, 0.64, 1)");
    const press = parseInt(tok(rootBlock, "--dur-press"), 10);
    const enter = parseInt(tok(rootBlock, "--dur-enter"), 10);
    expect(press).toBeGreaterThanOrEqual(100); expect(press).toBeLessThanOrEqual(200);
    expect(enter).toBeGreaterThanOrEqual(200); expect(enter).toBeLessThanOrEqual(300);
    expect(strip(read("components.css"))).toMatch(/\.sheet-scrim > \.card \{ animation: sheetIn var\(--dur-enter\) var\(--ease-out\); \}/);
  });

  const craft = DS.slice(DS.indexOf(".pagehead-title, .today-title"));
  const pressStart = craft.indexOf("@media (prefers-reduced-motion: no-preference)");

  it("the press feedback reaches the capsule family, the checkbox, the tab and the tappable row", () => {
    const m = craft.slice(pressStart);
    for (const cls of [".pill-act", ".row-act", ".btn-sm", ".see-all", ".cb", ".tab-bar .tab", ".task-row"]) {
      expect(m, cls).toContain(cls);
    }
    expect(m).toMatch(/scale: var\(--press-scale\)/);
  });

  it("every press rule sits inside prefers-reduced-motion: no-preference, so Reduce Motion gets no transform and no bounce", () => {
    expect(pressStart, "the press block is inside a no-preference query").toBeGreaterThan(-1);
    // Everything that declares scale: or the spring curve lives at or after the query opens
    const before = craft.slice(0, pressStart);
    expect(before).not.toMatch(/\bscale:/);
    expect(before).not.toContain("--ease-press");
    // and the in-app Reduce Motion setting is honoured as well as the phone's
    expect(craft.slice(pressStart)).toContain('html:not([data-motion="reduce"])');
  });

  it("the press uses the individual scale property, so a swipe's inline transform on the same row is never overwritten", () => {
    const m = craft.slice(pressStart);
    expect(m).not.toMatch(/transform:\s*scale\(/);
  });
});

describe("the chrome is a faint warm material, not a layout change", () => {
  const css = strip(read("components.css"));
  it("the tab bar keeps its blur and gains a hairline highlight, with no shadow", () => {
    const m = /\.tab-bar \{ -webkit-backdrop-filter: blur\(22px\) saturate\(160%\); backdrop-filter:[^}]*\}/.exec(css);
    expect(m, "the tab bar material rule").toBeTruthy();
    expect(m![0]).toContain("border-top-color: var(--chrome-hairline)");
    expect(m![0]).toContain("inset 0 0.5px 0 var(--rim-card)");
    expect(m![0]).not.toMatch(/0 [1-9]\d*px [1-9]/);
  });
  it("the nav bar is a translucent warm token in both themes", () => {
    expect(tok(block("light"), "--nav-bg")).toBe("rgba(255,253,250,0.90)");
    expect(tok(block("dark"), "--nav-bg")).toBe("rgba(28,25,23,0.78)");
  });
  // AMENDED 2026-10-05 (the visual review: the Good Morning title ghosted through New Event at 94%): a sheet is an
  // OPAQUE warm surface with a hairline rim and the one shadow; nothing of the page reads through it.
  it("a sheet is an opaque warm surface with a hairline rim", () => {
    expect(css).toMatch(/\.sheet-scrim > \.card \{ background: var\(--surface-2\); border: 0\.5px solid var\(--card-bd\);/);
    expect(css).not.toMatch(/\.sheet-scrim > \.card \{ background: color-mix/);
  });
});
