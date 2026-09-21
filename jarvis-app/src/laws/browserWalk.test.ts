import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// THE BROWSER WALK, AS LAWS (2026-09-05).
//
// The 2026-09-05 browser walk measured every screen in both themes with
// elementFromPoint and composite-over-backdrop contrast, and found the
// classes of bug that a source scan cannot see on its own: a 44px expander
// clipped by the overflow on the same box, a selected chip whose colour won
// and whose background lost, a token that means "done" and "quiet" at once.
// Each check here pins the seam that fixed one of those, so the fix cannot
// be deleted by the next tidy-up. Same shape as laws.test.ts, kept in its
// own file so the packet lands without touching the main suite.

const SRC = join(process.cwd(), "src");
const read = (f: string) => readFileSync(join(SRC, f), "utf8");
const css = () => read("styles/components.css");
const tokens = () => read("styles/jarvis-design-system.css");

// Strip comments and return the body of the first rule whose selector list
// matches exactly (whitespace-insensitive).
const ruleBody = (sheet: string, selector: string): string | null => {
  const bare = sheet.replace(/\/\*[\s\S]*?\*\//g, "");
  const want = selector.replace(/\s+/g, " ").trim();
  for (const m of bare.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const sel = m[1]!.replace(/\s+/g, " ").trim();
    if (sel === want) return m[2]!;
  }
  return null;
};

// Every rule in the sheets, comments stripped, as [selector, body] pairs.
const rulesOf = (...files: string[]): Array<[string, string]> => {
  const bare = files.map((f) => read(f)).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
  return [...bare.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => [m[1]!.replace(/\s+/g, " ").trim(), m[2]!]);
};

describe("BROWSER-F-03: a 44px expander is never clipped by the box it expands", () => {
  // The bug: .pill-act carried `::after { inset: -9px 0 }` to reach 44 AND
  // `overflow: hidden` for its ellipsis, on the same position:relative box. A
  // pseudo-element cannot escape its own box's overflow clip, so 162 action
  // pills across the app measured 27px of hit. Same for .sched-loc under
  // .truncate. This pins the whole class: if a control clips itself, it may
  // not lean on a pseudo-element for its touch target.
  const REACHES_44 = /min-height:\s*(44px|var\(--tap-min\))|border(-top|-bottom|-block)?:\s*\d/;
  it("no self-clipping control relies on a pseudo-element for its hit area", () => {
    const rules = rulesOf("styles/components.css", "styles/ruled.css", "styles/uniformity.css", "styles/jarvis-design-system.css");
    const expanded = new Set<string>();
    for (const [sel, body] of rules) {
      if (!/position:\s*absolute/.test(body) || !/inset:\s*-/.test(body)) continue;
      for (const one of sel.split(",")) {
        const m = one.trim().match(/^(.*?)::(?:after|before)$/);
        if (m) expanded.add(m[1]!.trim().split(/\s+/).pop()!);
      }
    }
    expect(expanded.size, "the expander pattern is still in the sheets").toBeGreaterThan(4);
    for (const base of expanded) {
      const own = rules.filter(([sel]) => sel.split(",").some((s) => s.trim().split(/\s+/).pop() === base));
      const clips = own.some(([, body]) => /overflow(-[xy])?:\s*(hidden|clip)/.test(body));
      if (!clips) continue;
      expect(
        own.some(([, body]) => REACHES_44.test(body)),
        `${base} clips itself, so its pseudo-element expander is dead: it needs a real 44px box (min-height or a transparent hit border)`,
      ).toBe(true);
    }
  });

  // The route the two named controls take: a transparent border, which lives
  // in the border box and so survives the clip, paid back out of layout by a
  // negative margin so no row grows and the paint does not move.
  it(".pill-act and .sched-loc expand by a transparent border, paid back in margin", () => {
    const rules = rulesOf("styles/components.css");
    for (const cls of [".pill-act", ".sched-loc"]) {
      const own = rules.filter(([sel]) => sel.split(",").some((s) => s.trim() === cls));
      const all = own.map(([, b]) => b).join(" ");
      expect(all, `${cls} expands its hit area with a transparent border`).toMatch(/border-top:\s*\d+px solid transparent/);
      expect(all, `${cls} keeps the border out of the paint`).toMatch(/background-clip:\s*padding-box/);
      expect(all, `${cls} pulls the border back out of the layout`).toMatch(/margin-(block|bottom):\s*-\d/);
    }
  });
});

// The audit's own contrast math (tools/visual-audit.mjs): composite the ink
// over its real backdrop, then WCAG relative luminance. Duplicated here on
// purpose, so a law about colour does not depend on a tool that needs a
// browser to run.
const chan = (c: string): number[] => {
  if (c.startsWith("#")) {
    const s = c.slice(1);
    const n = s.length === 3 ? s.split("").map((x) => x + x).join("") : s;
    return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
  }
  return (c.match(/[\d.]+/g) || []).map(Number);
};
const overC = (fg: string, bg: string): number[] => {
  const f = chan(fg), b = chan(bg);
  const a = f.length > 3 ? f[3]! : 1;
  return [0, 1, 2].map((i) => f[i]! * a + b[i]! * (1 - a));
};
const relLum = (c: number[]): number => {
  const s = (v: number) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  return 0.2126 * s(c[0]!) + 0.7152 * s(c[1]!) + 0.0722 * s(c[2]!);
};
const contrast = (fg: string, bg: string): number => {
  const x = relLum(overC(fg, bg)), y = relLum(chan(bg));
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
// The value of a token inside a theme block, e.g. tokenIn("light", "--good").
const tokenIn = (theme: string, name: string): string => {
  const sheet = tokens().replace(/\/\*[\s\S]*?\*\//g, "");
  const block = sheet.match(new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1];
  if (!block) throw new Error(`no ${theme} theme block`);
  const v = block.match(new RegExp(`(?:^|[;{\\s])${name}:\\s*([^;]+);`))?.[1];
  if (!v) throw new Error(`${theme} theme does not define ${name}`);
  return v.trim();
};

describe("BROWSER-F-04: status colour is readable in daylight, from the token", () => {
  // The light theme carried the iOS system green and orange, which are tuned
  // to be read on black. On a pastel of their own hue they measured 2.0:1,
  // and the app reached its light-safe values through a list of class names
  // that .gstat-good, .fact-good, .rep-win-val and .rep-delta-up were never
  // added to. The token has to be right, because a list cannot be.
  //
  // AMENDED (Astra, Dave's ruling 2026-09-12): Apple's light system colours,
  // as shipped, are the palette, including as text. He saw the measured
  // darker pair and chose the real colours. So this no longer measures the
  // two tokens against their grounds; it pins them to the exact iOS values,
  // which is the ruling made checkable. The old numbers stay in the token
  // comment as the record of what was traded.
  it("light --good and --warn are Apple's light system green and orange, exactly", () => {
    expect(tokenIn("light", "--good").toUpperCase()).toBe("#34C759");
    expect(tokenIn("light", "--warn").toUpperCase()).toBe("#FF9500");
    // And the fills they used to differ from are the same values now, in
    // light as in dark: one green, one orange, whatever the job.
    expect(tokenIn("light", "--good-fill").toUpperCase()).toBe(tokenIn("light", "--good").toUpperCase());
    expect(tokenIn("light", "--warn-fill").toUpperCase()).toBe(tokenIn("light", "--warn").toUpperCase());
  });

  // The saturated pair did not disappear, it changed job: anything with no
  // words in or on it keeps the iOS system colour under the 3:1 bar. If those
  // tokens go missing, every fill that took them silently falls back to
  // nothing (an invalid var() with no fallback paints as unset).
  it("the saturated fills survive as --good-fill and --warn-fill in both themes", () => {
    for (const theme of ["dark", "light"]) {
      expect(tokenIn(theme, "--good-fill")).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(tokenIn(theme, "--warn-fill")).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
    // Dark cannot move: the audit found no dark failure, so the text token and
    // the fill token have to resolve to the identical value there.
    expect(tokenIn("dark", "--good-fill")).toBe(tokenIn("dark", "--good"));
    expect(tokenIn("dark", "--warn-fill")).toBe(tokenIn("dark", "--warn"));
  });

  // The point of the token change was to end the allow-list. A new hand-kept
  // light-theme override for a green or amber status colour is the bug coming
  // back, one class at a time.
  it("no light-theme rule hand-paints a status green or amber again", () => {
    const bare = (read("styles/components.css") + read("styles/ruled.css") + read("styles/uniformity.css"))
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const offenders: string[] = [];
    for (const m of bare.matchAll(/([^{}]*\[data-theme="light"\][^{}]*)\{([^}]*)\}/g)) {
      for (const dec of m[2]!.split(";")) {
        const hexMatch = dec.match(/color:\s*(#[0-9A-Fa-f]{6})/);
        if (!hexMatch || !/^\s*color\s*:/.test(dec)) continue;
        const [r, g, b] = chan(hexMatch[1]!) as [number, number, number];
        // green: the green channel leads and blue is not close behind.
        // amber: red leads, green is mid, blue is nearly absent.
        const green = g > r && g > b + 20;
        const amber = r > 100 && g > 50 && g < r && b < 40;
        if (green || amber) offenders.push(`${m[1]!.trim()} { color: ${hexMatch[1]} }`);
      }
    }
    expect(offenders, "status green and amber come from --good / --warn, not from a per-class hex").toEqual([]);
  });
});

describe("BROWSER-F-05: a first-run question is never cut off mid-sentence", () => {
  // The seed step reuses .sh2, and .sh2 .t is in the no-wrap law, which is
  // written for two-word titles. Two of the five questions arrived as
  // "WHAT IS NON-NEGOTIABLE IN YOUR WEE..." over chips that answered them.
  it("the onboarding seed head opts out of the no-wrap law", () => {
    const body = ruleBody(css(), ".ob-seed .sh2 .t");
    expect(body, ".ob-seed .sh2 .t must exist to let a question wrap").not.toBeNull();
    expect(body).toMatch(/white-space:\s*normal/);
    expect(body).toMatch(/text-overflow:\s*clip/);
  });

  // And it stays an EXCEPTION: a title elsewhere still ellipsizes.
  it("the no-wrap law still covers section heads everywhere else", () => {
    const bare = css().replace(/\/\*[\s\S]*?\*\//g, "");
    const law = [...bare.matchAll(/([^{}]*\.sh2 \.t[^{}]*)\{([^}]*)\}/g)]
      .find((m) => /white-space:\s*nowrap/.test(m[2]!));
    expect(law, "the no-wrap law rule is still in the sheet").toBeTruthy();
  });

  // A question the app asks is JARVIS talking, so it is written in sentence
  // case and ends in a question mark. Caps are the CSS's job, never the
  // string's, and a prompt written in Title Case would read as a label again.
  it("every seed prompt is a sentence-case question", () => {
    const src = readFileSync(join(SRC, "onboarding/seeds.ts"), "utf8");
    for (const m of src.matchAll(/prompt:\s*"([^"]+)"/g)) {
      const p = m[1]!;
      expect(p.endsWith("?"), `"${p}" is a question and ends in a question mark`).toBe(true);
      expect(p, `"${p}" is sentence case, not Title Case`).not.toMatch(/^\w+ [A-Z]\w+ [A-Z]/);
    }
  });
});

describe("BROWSER-F-07: the bare-text buttons reach the tap minimum", () => {
  // Nine controls styled `background: 0; border: 0; padding: 0` at body size,
  // which is a button that looks like text and measured 18 to 28px of hit.
  // One utility instead of a tenth hand-kept list.
  const UTILITY = ".tap44";
  it("the tap44 utility exists and reaches --tap-min in both directions", () => {
    const bare = css().replace(/\/\*[\s\S]*?\*\//g, "");
    const after = [...bare.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .find((m) => m[1]!.split(",").some((s) => s.trim() === `${UTILITY}::after`));
    expect(after, "tap44::after must exist").toBeTruthy();
    expect(after![2]).toMatch(/min-width:\s*var\(--tap-min\)/);
    expect(after![2]).toMatch(/min-height:\s*var\(--tap-min\)/);
    expect(after![2]).toMatch(/position:\s*absolute/);
  });

  it("every control the walk measured under 24px wears it", () => {
    const bare = css().replace(/\/\*[\s\S]*?\*\//g, "");
    const wearing = new Set<string>();
    for (const m of bare.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const sels = m[1]!.split(",").map((s) => s.trim());
      if (!sels.includes(`${UTILITY}::after`)) continue;
      for (const s of sels) wearing.add(s.replace(/::after$/, ""));
    }
    // .toast-action is SHARED-F-10's own item; .sched-until-btn refused this
    // on 2026-08-24 because it sits inside a row that is itself role=button.
    for (const cls of [".p3-time-btn", ".focus-skip", ".search-cancel", ".ob-x", ".note-conn-add", ".note-fix"]) {
      expect(wearing.has(cls), `${cls} measured under 24px of hit and must wear tap44`).toBe(true);
    }
  });

  // SHARED-F-10 joined this list on the same day: the toast's Undo is the one
  // control that replaces every confirm dialog in the app, and it painted 26px
  // with no expander at all. A miss lands on the toast body, which does
  // nothing, while the five second timer runs out.
  it("the toast action wears it too", () => {
    const bare = css().replace(/\/\*[\s\S]*?\*\//g, "");
    const wearing = [...bare.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter((m) => m[1]!.split(",").some((s) => s.trim() === `${UTILITY}::after`))
      .flatMap((m) => m[1]!.split(",").map((s) => s.trim()));
    expect(wearing).toContain(".toast-action::after");
  });

  it("the reminder name in the Today strip carries tap44 at its call site", () => {
    const src = readFileSync(join(SRC, "today/RemindersStrip.tsx"), "utf8");
    expect(src).toMatch(/className="row-grow tap44"[^>]*role="button"/);
  });

  // The record's own fix shape: the tool has to be able to see this class of
  // bug, or the next nine controls go the same way.
  it("the visual auditor reports the 44px tier, not only the 24px one", () => {
    const tool = readFileSync(join(SRC, "..", "tools", "visual-audit.mjs"), "utf8");
    expect(tool).toMatch(/const HIG = 44/);
    expect(tool).toMatch(/add\("small-44"/);
    expect(tool).toMatch(/add\("small-target"/);
  });
});

describe("BROWSER-F-06: the app's own names and facts are not cut in half", () => {
  const ruled = () => read("styles/ruled.css");

  it("the large page title wraps instead of ellipsizing its own page name", () => {
    const bare = css().replace(/\/\*[\s\S]*?\*\//g, "");
    const law = [...bare.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .find((m) => /white-space:\s*nowrap/.test(m[2]!) && m[1]!.includes(".pagebar-title"));
    expect(law, "the no-wrap law still exists").toBeTruthy();
    expect(law![1], ".pagehead-title is off the no-wrap law").not.toMatch(/\.pagehead-title\b/);
    expect(ruleBody(css(), ".pagehead-title")).toBeTruthy();
    const own = [...bare.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter((m) => m[1]!.split(",").some((s) => s.trim() === ".pagehead-title"))
      .map((m) => m[2]!).join(" ");
    expect(own).toMatch(/white-space:\s*normal/);
    // The bar's centred twin really does have one line and keeps the law.
    expect(law![1]).toMatch(/\.pagebar-title\b/);
  });

  it("the day word never shrinks and the count line is the one that gives", () => {
    expect(ruleBody(ruled(), ".ruled .sc-dayhead .t")).toMatch(/flex-shrink:\s*0/);
    const fact = ruleBody(ruled(), ".ruled .sc-dayhead .sc-fact")!;
    expect(fact).toMatch(/overflow:\s*hidden/);
    expect(fact).toMatch(/text-overflow:\s*ellipsis/);
  });

  // CORRECTED 2026-09-06. This test asserted the bug, not the fix.
  //
  // What it demanded was that the goal line take A ROW OF ITS OWN under the
  // badge. That row is the THIRD line, and §4.1 rules "Two lines, always: no
  // third line". It also inverts the ruling right above it in the same
  // paragraph, "the words truncate first, chip and the right slot never
  // shrink": the goal losing width to the chip is the ruled outcome, not the
  // defect. One day later UP-CORE-17 and UP-CORE-02 put a person and an
  // estimate on that line, the wrap fired on every row that carried them, and
  // Dave found it on his phone: "There's wrapping in the tasks pills"
  // (DEFECT 1). Measured at 390x844: .r-k 88.75px over four visual lines, a
  // 129.55px row against a ruled 44/56/64.
  //
  // The real complaint underneath BROWSER-F-06 is still answered, and better:
  // the words carry a FLOOR now (.r-k-one below), so a long goal name is the
  // one thing on the line guaranteed room, and what will not fit beside it
  // leaves whole instead of taking a row. The wrap stays as the mechanism
  // that makes "leaves whole" possible, so this still checks for it -- but it
  // is now checked together with the clamp that stops it ever being seen.
  it("a name too long for the badge beside it keeps a floor, never a second row", () => {
    expect(ruleBody(ruled(), ".ruled .r-k")).toMatch(/flex-wrap:\s*wrap/);
    const one = ruleBody(ruled(), ".ruled .r-k-one");
    expect(one, "the task row's second line is clamped to one line box").toBeTruthy();
    expect(one).toMatch(/overflow:\s*hidden/);
    expect(ruled(), "and the words are the item with the floor under them")
      .toMatch(/\.ruled \.r-k-one > \.r-cat, \.ruled \.r-k-one > \.r-parent \{ flex: 1 1 [\d.]+em; \}/);
  });

  // A button that says "Remember ..." has stopped saying what it does. The cap
  // on the uniform card's verb has to clear every verb the app actually ships.
  it("the uniform card's pill is never capped under an action label it carries", () => {
    const cap = ruleBody(css(), ".notice-card-uniform .pill-act")!;
    const rem = /max-width:\s*([\d.]+)rem/.exec(cap);
    expect(rem, "the cap is stated in rem").toBeTruthy();
    // rem is --t-h3 (17px) here, not 16: html sets font-size: var(--t-h3).
    const px = Number(rem![1]) * 17;
    // Measured in chromium on 2026-09-05, .pill-act with max-width off, in the
    // container's fallback face (which is WIDER than SF Pro, so this is the
    // pessimistic number): "Ask Again in 15m" 152, "Remember This" 139,
    // "Pick Something" 139, "Add to Routine" 135, "Plan Tomorrow" 134.
    const WIDEST_LABEL_PX = 152;
    expect(px, `the widest verb the app ships needs ${WIDEST_LABEL_PX}px`)
      .toBeGreaterThanOrEqual(WIDEST_LABEL_PX);
  });

  it("a uniform verb row with no sub spends the second line on its title", () => {
    const body = ruleBody(css(), ".notice-card.notice-card-solo .vrow-fact")!;
    expect(body, "the solo allowance must beat the verb-row single-line clamp").toBeTruthy();
    expect(body).toMatch(/-webkit-line-clamp:\s*2/);
    expect(body).toMatch(/white-space:\s*normal/);
  });
});

describe("BROWSER-F-08: chips, values, steppers and swatches reach 44", () => {
  const ruled = () => read("styles/ruled.css");
  const has44 = (body: string | null) =>
    !!body && /min-height:\s*var\(--tap-min\)/.test(body) && /min-width:\s*var\(--tap-min\)/.test(body);

  it("the swatch, the stepper and the quiet capsule each carry a 44px expander", () => {
    expect(has44(ruleBody(css(), ".swatch::after")), ".swatch").toBe(true);
    expect(has44(ruleBody(css(), ".quiet-action::after")), ".quiet-action").toBe(true);
    expect(has44(ruleBody(ruled(), ".ruled .sc-step::after")), ".ruled .sc-step").toBe(true);
  });

  it("the dropdown value's expander works from a zeroed capsule", () => {
    // .dd.dd-value sets min-height: 0, so .dd's own -7px reached 32 from an
    // 18px line box. -13px is what reaches 44 from there.
    const inset = /inset:\s*-(\d+)px/.exec(ruleBody(css(), ".dd.dd-value::after") ?? "");
    expect(inset, ".dd.dd-value::after must restate its own inset").toBeTruthy();
    expect(Number(inset![1]) * 2 + 18).toBeGreaterThanOrEqual(44);
  });

  // Two <input>s cannot carry a pseudo-element, so they carry the height.
  it("the sheet and settings fields are 44 tall inside their 48px rows", () => {
    expect(ruleBody(css(), ".form-sheet .xs-field, .ruled .set-field")).toMatch(/min-height:\s*var\(--tap-min\)/);
  });

  // A 44px target that a neighbour's 44px target overlaps is not a target.
  // Wrapping chip grids and the swatch grid have to be on a 44px PITCH.
  it("stacked chip rows and the swatch grid tile at 44 instead of overlapping", () => {
    const gap = ruleBody(css(), ".convo-chips, .chip-wrap, .chip-wrap-row, .chip-picker-open");
    expect(gap, "wrapping chip containers must set a row gap").toBeTruthy();
    // AMENDED 2026-09-18 (Catalog V5): the gap is a scale stop now, so the
    // arithmetic resolves the token rather than reading a literal that would
    // have to be edited here every time the rhythm moved.
    const stop = /row-gap:\s*var\(--s-([\w-]+)\)/.exec(gap!)?.[1];
    const px = Number(new RegExp("--s-" + stop + ":\\s*([\\d.]+)px").exec(tokens())![1]);
    expect(px + 32, "a 32px chip plus the row gap must reach the tap minimum").toBeGreaterThanOrEqual(44);
    // The swatch is 24px of paint (uniformity.css), so its grid needs 20.
    expect(ruleBody(css(), ".swatch-pick")).toMatch(/gap:\s*var\(--s-6\)/);
    // AMENDED 2026-09-18 (Catalog V5): the gap is the --s-2h stop now.
    expect(ruleBody(ruled(), ".ruled .sc-steps")).toMatch(/gap:\s*var\(--s-2h\)/);
  });
});

describe("BROWSER-F-10: red words on a sheet grey are readable", () => {
  // A sheet stacks --press greys on the page, and --tint is one red for every
  // ground: 3.76:1 on the sheet bar, 3.06 on the toast, 2.54 in the grouped
  // card. The three grounds the browser walk measured, by name.
  const GROUNDS: Array<[string, string]> = [
    ["the sheet bar", "rgb(44,44,46)"],
    ["the toast", "rgb(58,58,60)"],
    ["a sheet's grouped card", "rgb(70,70,72)"],
  ];

  it("--tint-on-sheet clears AA on every sheet grey, in both themes", () => {
    // The token indirects to --accent-tx, which is per theme.
    expect(tokenIn("dark", "--tint")).toBeTruthy();
    const bare = tokens().replace(/\/\*[\s\S]*?\*\//g, "");
    expect(bare, "the token exists").toMatch(/--tint-on-sheet:\s*var\(--accent-tx\)/);
    for (const [where, ground] of GROUNDS) {
      const cr = contrast(tokenIn("dark", "--accent-tx"), ground);
      expect(cr, `dark --tint-on-sheet on ${where} is ${cr.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
    // And the red it replaces genuinely could not do it, which is the reason
    // this token exists rather than a lighter red: the first red that clears
    // 4.5 on the deepest ground is paler than the salmon Dave rejected.
    expect(contrast(tokenIn("dark", "--tint"), "rgb(70,70,72)")).toBeLessThan(4.5);
    expect(contrast("#FF6B6B", "rgb(70,70,72)")).toBeLessThan(4.5);
  });

  it("the sheet and toast verbs take it", () => {
    const bare = css().replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = [...bare.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .find((m) => /color:\s*var\(--tint-on-sheet\)/.test(m[2]!));
    expect(rule, "something has to take the token").toBeTruthy();
    for (const sel of [".sheet-bar-save", ".row-act", ".note-fix", ".toast-action"]) {
      expect(rule![1], `${sel} is on the sheet-red list`).toContain(sel);
    }
    // The .btn variants declare their own ink against their own fill; taking
    // this token would invert .btn-danger's white on red.
    expect(rule![1]).toMatch(/:not\(\.btn-danger\)/);
  });

  // Red is still the verb on a sheet: it moved from the lettering to the fill.
  it("the mid-tier sheet button keeps its red as a wash", () => {
    const bare = css().replace(/\/\*[\s\S]*?\*\//g, "");
    const wash = [...bare.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .find((m) => m[1]!.includes(".sheet-scrim > .card .btn") && /background:\s*var\(--red-tint\)/.test(m[2]!));
    expect(wash, "otherwise it is indistinguishable from .btn-secondary").toBeTruthy();
  });
});

describe("BROWSER-F-17: the inline time editor never covers the row it edits", () => {
  it(".time-pop anchors below the row, with an up variant for the bottom of a list", () => {
    const down = ruleBody(css(), ".time-pop")!;
    expect(down, "the popover rule is still there").toBeTruthy();
    expect(down, "centring on the row is what hid the row").not.toMatch(/top:\s*50%/);
    expect(down).toMatch(/top:\s*calc\(100% \+/);
    expect(ruleBody(css(), ".time-pop.time-pop-up")).toMatch(/bottom:\s*calc\(100% \+/);
  });
});

// EVERY TAPPABLE DIV OWES ENTER AND SPACE (2026-09-05).
//
// The row pattern in this app is a div, because a <button> cannot always carry
// the row anatomy the catalog rules. A div that takes a tap has to say so
// three ways: role="button", tabIndex 0, and a key handler. The first two were
// copied from the first ruled row into 60-odd places; the third was not, so
// Tab reached the row and Enter did nothing. VoiceOver never noticed, because
// it dispatches a real click; a hardware keyboard, a switch control and the
// iPad did.
//
// shared/pressable.ts is the answer, and this law is how the slices that have
// been swept stay swept. SCOPE grows as each finding lands: BRAIN-F-21,
// EMAIL-F-31, HMN-F-24, SCHED-F-19, SHARED-F-22.
const KEYBOARD_SCOPE = [
  "brain", "decisions", "people", "review", "routine",   // BRAIN-F-21
  "messages/MessagesFlow.tsx", "messages/MailMoreSheet.tsx", // EMAIL-F-31
  "money", "notes", "health",                            // HMN-F-24
  "schedule/screens/SchedulePage.tsx",                   // SCHED-F-19
];
// A POINTING surface is the one honest exception. .body-map's handler reads
// the coordinates of the tap to decide which part of the body was named, and
// a key press has no coordinates, so there is nothing for Enter to forward to.
// It keeps its role and its tab stop so a screen reader can still find it;
// giving a keyboard user a real way to name a body part is a design question
// and it belongs to whoever asks it, not to a key handler. Listed by class,
// not by line, so it survives the file moving.
const POINTING = new Set(["body-map"]);

describe("a role=button row can be pressed with a keyboard", () => {
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) out.push(...walk(p));
      else if (p.endsWith(".tsx") && !p.endsWith(".test.tsx")) out.push(p);
    }
    return out;
  };

  it("every swept slice reaches its rows through pressable, or handles the keys itself", () => {
    const offenders: string[] = [];
    for (const slice of KEYBOARD_SCOPE) {
      // A scope entry is a slice of the app or one file inside one: a slice
      // that is only PART swept names its swept files until the rest lands.
      const files = slice.endsWith(".tsx") ? [join(SRC, slice)] : walk(join(SRC, slice));
      for (const file of files) {
        const src = readFileSync(file, "utf8");
        for (const m of src.matchAll(/role="(?:button|radio)"/g)) {
          // The whole opening tag: from its "<" to the ">" that closes it,
          // counting braces so an arrow function's own ">" is not mistaken
          // for the end of the tag (that is what "=>" would do to a naive scan).
          const start = src.lastIndexOf("<", m.index!);
          let depth = 0, end = start;
          for (let i = start; i < src.length; i++) {
            const c = src[i]!;
            if (c === "{") depth++;
            else if (c === "}") depth--;
            else if (c === ">" && depth === 0 && src[i - 1] !== "=") { end = i; break; }
          }
          const tag = src.slice(start, end + 1);
          if (!tag.includes("onClick")) continue;        // not a control
          if (tag.includes("onKeyDown")) continue;       // handles its own keys
          const cls = /className="([^"]*)"/.exec(tag)?.[1] ?? "";
          if (cls.split(" ").some((c) => POINTING.has(c))) continue;
          offenders.push(`${file.slice(SRC.length + 1)}:${src.slice(0, m.index!).split("\n").length}`);
        }
      }
    }
    expect(offenders, "a row Tab can reach and Enter cannot press").toEqual([]);
  });

  it("the helper is one place, so the keys cannot drift between rows", () => {
    const src = readFileSync(join(SRC, "shared/pressable.ts"), "utf8");
    expect(src).toMatch(/role: "button"/);
    expect(src).toMatch(/e\.key !== "Enter" && e\.key !== " "/);
    expect(src, "Space would scroll the page as well as press the row").toMatch(/e\.preventDefault\(\)/);
  });
});

describe("BROWSER-F-09: quiet is not the same word as finished", () => {
  // --tx-4 carried two meanings: "this is done or out of range", where 30
  // percent is a deliberate dimming, and "this is quiet metadata", where 30
  // percent measured 2.3:1 dark and 1.7:1 light and the information was simply
  // gone. Option B splits them. These hold the split.
  it("--tx-quiet clears AA on every ground it lands on, in both themes", () => {
    const grounds: Array<[string, string[]]> = [
      ["dark", ["#000000", "#1C1C1E", "#2C2C2E"]],
      ["light", ["#FFFFFF", "#F3F4F9"]],
    ];
    for (const [theme, gs] of grounds) {
      for (const g of gs) {
        const cr = contrast(tokenIn(theme, "--tx-quiet"), g);
        expect(cr, `${theme} --tx-quiet on ${g} is ${cr.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  // THE TWO-TIER INK RAMP (Dave 2026-09-14, the writing brief's Appendix A,
  // conflict 1) supersedes the 30 percent quaternary this law used to hold:
  // --tx-2 and --tx-3 are one secondary value, and --tx-4 is a solid
  // structure grey that never colours text (the law for that is in
  // laws.test.ts). The done state recedes to secondary now, which is the
  // ruling's own choice: "do not use faded paragraphs or grey helper text".
  it("the ramp is two tiers: one secondary, and a solid structure grey", () => {
    for (const theme of ["dark", "light"]) {
      expect(tokenIn(theme, "--tx-2"), `${theme} --tx-2 and --tx-3 are one value`).toBe(tokenIn(theme, "--tx-3"));
      expect(tokenIn(theme, "--tx-4"), `${theme} --tx-4 is a solid structure grey`).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  // The classes the walk measured. A done reminder, a paid bill and a
  // .cal-cell.out are NOT here on purpose: they use the dim grey correctly.
  it("live metadata takes the quiet token, not the dim one", () => {
    const all = (css() + read("styles/ruled.css")).replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...all.matchAll(/([^{}]+)\{([^}]*)\}/g)];
    const LIVE = [".prop-tag", ".sched-sep", ".focus-skip", ".rep-hint", ".doc-count",
      ".receipt-line", ".ruled .sched-time .ampm", ".ruled .r-next", ".ruled .wk-w", ".ruled .sched-now .t"];
    for (const sel of LIVE) {
      const body = rules.find((m) => m[1]!.replace(/\s+/g, " ").trim() === sel)?.[2];
      expect(body, `${sel} is still in the sheet`).toBeTruthy();
      expect(body, `${sel} carries live information and must not wear --tx-4`).not.toMatch(/color:\s*var\(--tx-4\)/);
      expect(body, `${sel} takes --tx-quiet`).toMatch(/color:\s*var\(--tx-quiet\)/);
    }
  });

  // THE TWO INKS MEASURE (2026-09-14): the secondary is text and clears AA
  // on the page and every surface it lands on; the structure grey is never
  // text and clears the 3:1 bar for non-text, so a ring or a chevron is
  // seen on any ground. Both themes, every ground.
  it("the secondary clears 4.5:1 and the structure grey 3:1 on every ground, in both themes", () => {
    const grounds: Array<[string, string[]]> = [
      ["dark", ["--bg", "--surface-1", "--surface-2", "--surface-3"]],
      ["light", ["--bg", "--surface-1", "--surface-2", "--surface-3"]],
    ];
    for (const [theme, names] of grounds) {
      for (const g of names) {
        const ground = tokenIn(theme, g);
        const text = contrast(tokenIn(theme, "--tx-2"), ground);
        const structure = contrast(tokenIn(theme, "--tx-4"), ground);
        expect(text, `${theme} --tx-2 on ${g} is ${text.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
        expect(structure, `${theme} --tx-4 on ${g} is ${structure.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  // Superseded 2026-09-14 (the two-tier ruling): a past state recedes to the
  // secondary ink, never to the structure grey.
  it("the deliberately dimmed states recede to secondary, never to --tx-4", () => {
    const all = (css() + read("styles/ruled.css")).replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...all.matchAll(/([^{}]+)\{([^}]*)\}/g)];
    for (const sel of [".cal-cell.out", ".rem-row.done .rem-name", ".ruled .task-row .money-amt.paid"]) {
      const body = rules.find((m) => m[1]!.replace(/\s+/g, " ").trim() === sel)?.[2];
      expect(body, `${sel} is still in the sheet`).toBeTruthy();
      expect(body, `${sel} is a past state and recedes to secondary`).toMatch(/color:\s*var\(--tx-2\)/);
    }
  });
});

describe("BROWSER-F-12: Chat has one input, and the shell keeps its tab bar", () => {
  const shell = () => readFileSync(join(SRC, "shell/AppShell.tsx"), "utf8");

  it("the capture dock steps aside on Chat, the way it does in the note editor", () => {
    const src = shell();
    expect(src, "the capture flag exists").toMatch(/const showCapture\s*=/);
    expect(src, "and Chat is what it excludes").toMatch(/showCapture[^;]*active !== "chat"/);
  });

  // The tab bar is not the dock. Hiding it on a tab you reach FROM the tab bar
  // would strand you there, which is why one flag became two.
  it("the tab bar is not tied to the capture dock", () => {
    const src = shell().replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
    const cap = src.indexOf("{showCapture &&");
    const tabs = src.indexOf("{showTabBar &&");
    expect(cap, "the dock has its own block").toBeGreaterThan(-1);
    expect(tabs, "the tab bar has its own block").toBeGreaterThan(-1);
    expect(src.slice(cap, tabs), "the dock block does not contain the tab bar").not.toContain("<TabBar");
  });
});

describe("BROWSER-F-14: the reorder handle does something when you tap it", () => {
  // It said role="button" and aria-label="Reorder" and answered only a drag,
  // so a tap did nothing at all and tabIndex -1 kept every keyboard and switch
  // control out of tab order entirely.
  it("the handle is a real button with a menu behind it", () => {
    const src = readFileSync(join(SRC, "shared/ReorderList.tsx"), "utf8");
    const at = src.indexOf('className="drag-handle"');
    const tag = src.slice(at, src.indexOf(">", src.indexOf("tabIndex", at)) + 1);
    expect(tag, "tabIndex -1 was why no keyboard could reorder").toMatch(/tabIndex=\{0\}/);
    expect(tag).toMatch(/aria-haspopup="menu"/);
    expect(src, "Enter and Space open it too").toMatch(/onKeyDown=\{onPressKey\(/);
    expect(src, "Move Up").toMatch(/Move Up/);
    expect(src, "Move Down").toMatch(/Move Down/);
  });
});

describe("SHARED-F-13: a scrim tap is not a way to lose work", () => {
  const kit = () => readFileSync(join(SRC, "shared/FormSheet.tsx"), "utf8");

  it("the scrim consults the sheet before it cancels", () => {
    const src = kit();
    expect(src, "the scrim's handler is not onCancel itself any more").not.toMatch(/className="sheet-scrim" onClick=\{onCancel\}/);
    expect(src).toMatch(/className="sheet-scrim" onClick=\{onScrim\}/);
    expect(src, "the fields are the default dirty check, so all 47 sheets get it").toMatch(/const fieldsOf/);
  });

  // Cancel in the bar and Escape both stay: a modal that refuses the DISMISS
  // gesture still has to have a way out, which is the whole iOS contract.
  it("Cancel in the bar is untouched, and Escape presses Cancel", () => {
    expect(kit()).toMatch(/<SheetBar[^>]*onCancel=\{onCancel\}/);
    const esc = readFileSync(join(SRC, "shared/useSheetEscape.ts"), "utf8");
    expect(esc).toMatch(/sheet-bar-cancel/);
  });
});

describe("BROWSER-F-02: a picked chip inside a form sheet is readable", () => {
  // The strip rule re-sets the chip background at (0,4,0), which beats
  // .chip.active (0,2,0) for the background alone. Any rule that overrides a
  // chip's background inside the form sheet must carry a matching .active
  // rule that sets BOTH the selected background and the selected colour, or
  // the picked chip keeps the inverted ink on the unselected fill.
  it("every form-sheet chip background override has a paired .active rule setting sel-bg and sel-fg", () => {
    const bare = css().replace(/\/\*[\s\S]*?\*\//g, "");
    const overrides = [...bare.matchAll(/([^{}]*\.form-sheet[^{}]*\.chip)\s*\{([^}]*)\}/g)]
      .filter((m) => /background\s*:/.test(m[2]!))
      .map((m) => m[1]!.replace(/\s+/g, " ").trim());
    expect(overrides.length, "the strip rule this law was written for still exists").toBeGreaterThan(0);
    for (const sel of overrides) {
      const active = ruleBody(bare, `${sel}.active, ${sel}.on`);
      expect(active, `${sel} overrides the chip background with no paired .active rule`).not.toBeNull();
      expect(active).toMatch(/background:\s*var\(--sel-bg\)/);
      expect(active).toMatch(/color:\s*var\(--sel-fg\)/);
    }
  });
});

// THE RAIL SITS BESIDE ITS OWN TIME (Dave 2026-09-16, photographed: a teal
// line drawn straight through "7:59 PM").
//
// The schedule row's category rail is absolutely positioned while everything
// beside it is laid out, so its left has to be told about anything that
// leads the row and pushes the time gutter right. Two controls do: the
// Remember star (C-50) and the multi-select box. Measured at 390px with the
// star present, the gutter starts at 71 and ends at 133, and the rail was
// pinned at 98, which is inside the digits.
//
// The law is the SHAPE, not the number: the rail's left must be written in
// terms of the per-row lead, and every control that can take the leading
// slot must declare one. A new leading control with no declaration is the
// same bug again.
describe("LAW: the schedule rail is positioned past whatever leads the row", () => {
  const ruled = () => readFileSync(join(SRC, "styles/ruled.css"), "utf8");

  it("the rail's left reads the row's own lead instead of a fixed gutter", () => {
    const bare = ruled().replace(/\/\*[\s\S]*?\*\//g, "");
    const bar = [...bare.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter((m) => m[1]!.split(",").some((s) => s.trim() === ".ruled .sched-bar"))
      .map((m) => m[2]!).join(" ");
    expect(bar, ".ruled .sched-bar still has its own rule").toBeTruthy();
    expect(bar, "the rail's left must include the row's lead").toMatch(/left:[^;]*var\(--sched-lead/);
  });

  it("every control that can lead a schedule row declares its lead", () => {
    const bare = ruled().replace(/\/\*[\s\S]*?\*\//g, "");
    // The default, so a row with nothing in front is exactly where it was.
    expect(bare).toMatch(/\.ruled \.sched-row \{[^}]*--sched-lead:\s*0px/);
    for (const lead of ["row-star", "sched-sel"]) {
      expect(bare, lead + " must declare the room it takes")
        .toMatch(new RegExp("\\.ruled \\.sched-row:has\\(> \\." + lead + "\\)[^{]*\\{[^}]*--sched-lead:"));
    }
  });

  // The two leading controls, as the row markup actually carries them. The
  // leading slot is the source between the rail and the time; anything that
  // lands there and is not one of the declared pair is the bug again.
  it("nothing undeclared sits between the rail and the time", () => {
    for (const f of ["schedule/screens/DayRow.tsx", "schedule/screens/ProposedRow.tsx"]) {
      const src = readFileSync(join(SRC, f), "utf8");
      const from = src.indexOf("sched-bar");
      const to = src.indexOf("sched-time");
      expect(from, f + " draws the rail").toBeGreaterThan(-1);
      expect(to, f + " draws the time").toBeGreaterThan(from);
      const lead = src.slice(from, to);
      const classes = [...lead.matchAll(/className=\{?"([^"]+)"/g)].flatMap((m) => m[1]!.split(/\s+/));
      for (const c of classes) {
        // "ic" is the glyph INSIDE the select box, not a sibling of it.
        expect(["sel-box", "sched-sel", "cat-bg-", "sched-bar", "ic"].some((ok) => c.startsWith(ok)),
          `${f}: "${c}" leads the row with no --sched-lead declared for it`).toBe(true);
      }
      // A component in the leading slot hides its own class, so the ones
      // allowed there are named outright.
      const comps = [...lead.matchAll(/<([A-Z]\w+)/g)].map((m) => m[1]!);
      for (const c of comps) {
        expect(["EntityStar", "CheckGlyph"], `${f}: <${c}> leads the row with no --sched-lead declared for it`).toContain(c);
      }
    }
  });
});

// A FREE-TEXT ROW IN A SHEET, RIGHT ONLY WHEN THERE IS SOMETHING TO SIT
// AGAINST (found 2026-09-16, Dave photographed "Set up wallet card" and
// "Pick location for fundraiser" both pushed to the far right of their own
// row, an empty gap the width of the icon tile where the name used to
// start). A same-day fix for the exercise editor's Grip and Tags rows
// ("Neutral / Wide / Hook" reading as an answer already typed) right-aligned
// EVERY .xs-input in every .sheet-form, which is correct for a value sitting
// against its own label and wrong for a row the input IS: a task's name, a
// checklist line, an event's title, an area's name, an exercise's name or
// note, a library rename or search. Those carry no label to sit against, the
// same reason .task-name and .conn-name always read left.
describe("BROWSER-F: a bare .xs-input reads left; one beside .xs-label reads right", () => {
  it("the base rule sets no alignment (left, the platform default)", () => {
    const body = ruleBody(css(), ".sheet-form .xs-input");
    expect(body, ".sheet-form .xs-input must exist").not.toBeNull();
    expect(body, "a bare field must not be forced right").not.toMatch(/text-align/);
  });
  it("only a row with a label beside it turns the value right", () => {
    const body = ruleBody(css(), ".sheet-form .xs-row:has(> .xs-label) .xs-input");
    expect(body, "the labelled-row rule must exist").not.toBeNull();
    expect(body).toMatch(/text-align:\s*right/);
  });
  it("every row that already reads right keeps its own reason: an .xs-field or a labelled row", () => {
    // Every current .xs-label row (Grip, Tags) still resolves to right via
    // the rule above; asserting the two callers directly keeps this honest
    // about what exists rather than about what the selector merely permits.
    const gripAndTags = read("gym/ClassifySheet.tsx") + read("gym/BatchSheet.tsx");
    expect((gripAndTags.match(/<div className="xs-label">/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});

// THE CARET WAS CROSSING THE ROUNDED CORNER (Dave 2026-09-16, a task's Notes
// field, focused and empty: "the text inside the notes box makes no sense
// and is conflicting with the border"). .task-notes is a bare .card.xs-group,
// which supplies no padding of its own (unlike .card.pad, which carries
// var(--s-4) on every side): the zero-horizontal rule written for .card.pad
// and reused here left the caret sitting at the card's own left edge, inside
// the curve of its top-left corner.
describe("BROWSER-F: a task's Notes field keeps its text clear of the card's rounded corner", () => {
  const editor = () => read("styles/editor.css");
  it(".task-notes gives its editor real horizontal room, unlike .card.pad which already has its own", () => {
    const taskNotes = ruleBody(editor(), ".task-notes .doc-editor");
    expect(taskNotes, ".task-notes .doc-editor must exist on its own now").not.toBeNull();
    expect(taskNotes, "it must not be flush against the card's edge").not.toMatch(/padding:\s*var\(--s-1\)\s*0\s*;?\s*$/);
    expect(taskNotes).toMatch(/padding:\s*var\(--s-1\)\s*var\(--s-4\)/);
    // .card.pad already carries the inset (jarvis-design-system.css), so its
    // own editor rule is right to stay at zero: fixing one must not touch
    // the other.
    const cardPad = ruleBody(editor(), ".card.pad .doc-editor");
    expect(cardPad).toMatch(/padding:\s*var\(--s-1\)\s*0/);
    const padRule = ruleBody(read("styles/jarvis-design-system.css"), ".card.pad");
    expect(padRule, ".card.pad's own padding is the reason its editor needs none").toMatch(/padding:\s*var\(--s-4\)/);
  });
});

// DYNAMIC TYPE AT THE TOP OF ITS OWN RANGE (2026-09-21).
//
// appearance/textZoom.ts has always clamped --type-scale to 1.0-1.4, read it
// from the phone and offered an override in Settings, and every named type
// token multiplies by it. What nothing had ever done was LOOK at 1.4. The
// first pass that did found eight findings on Dave's own width, and six of
// them were the same elements that "only existed at 320" -- the width dropped
// the day before on the grounds that nobody uses it. Larger text in a fixed
// width is the same arithmetic as fixed text in a narrower one, so retiring
// 320 had hidden those findings rather than removed them.
//
// Each check here pins one of the eight. The ruling behind all of them is the
// no-wrap law's own stated exception, already written twice in components.css:
// an ellipsis is the honest answer to a string the WORLD writes and whose
// length is unknown; copy this app wrote that does not fit is a title that
// needs a second line.
describe("DYNAMIC-TYPE-1.4: the app's own words survive the largest text size", () => {
  const bare = () => css().replace(/\/\*[\s\S]*?\*\//g, "");

  it("the visual auditor runs every size at 1.4 as well as 1", () => {
    const tool = readFileSync(join(SRC, "..", "tools", "visual-audit.mjs"), "utf8");
    // The scale list, not just the string "1.4" somewhere in a comment.
    expect(tool, "the matrix fans out over a scale list").toMatch(/\[1,\s*1\.4\]\.flatMap/);
    expect(tool, "a pass applies its own scale, not a global").toMatch(/setProperty\("--type-scale", String\(n\)\), scale\)/);
    expect(tool, "runPass takes the scale and defaults to 1").toMatch(/async function runPass\(\{ w, h, theme, scale = 1 \}\)/);
  });

  it("the search field may shrink, so Cancel stays on the screen", () => {
    // At 1.4 the input's intrinsic width refused to give, the bar grew past
    // the row, and Cancel painted to x=468 on a 390px screen: off the edge,
    // untappable, and taking the headings under it with it.
    expect(ruleBody(css(), ".search-top .search-bar")).toMatch(/min-width:\s*0/);
    expect(ruleBody(css(), ".search-top .search-bar input"), "a flex child defaults to min-width:auto").toMatch(/min-width:\s*0/);
  });

  it("a form row's label states itself whole and the value is what yields", () => {
    // "Appears" shipped in 52px and "Next Due" in 78px, both losing half of
    // themselves to a value that had a perfectly good ellipsis of its own.
    const label = ruleBody(css(), ".xs .row.xs-row > .conn-name");
    expect(label, "the label row rule still exists").toBeTruthy();
    expect(label, "basis auto, no shrink").toMatch(/flex:\s*0\s+0\s+auto/);
    // The two controls that take the other side are both built to give way.
    expect(ruleBody(css(), ".dd .dd-w")).toMatch(/text-overflow:\s*ellipsis/);
    expect(ruleBody(css(), ".xs .xs-input")).toMatch(/min-width:\s*0/);
  });

  it("a nav row's page name is off the no-wrap law, like the big title above it", () => {
    const law = [...bare().matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .find((m) => /white-space:\s*nowrap/.test(m[2]!) && m[1]!.includes(".pagebar-title"));
    expect(law, "the no-wrap law still exists").toBeTruthy();
    expect(law![1], ".lib-name is off the no-wrap law").not.toMatch(/\.lib-name\b/);
    const own = ruleBody(css(), ".lib-name")!;
    expect(own, "it wraps").toMatch(/white-space:\s*normal/);
    expect(own, "clamped at two, so a long one still ends in an ellipsis").toMatch(/-webkit-line-clamp:\s*2/);
  });

  it("a solo notice in the grouped band takes its second line", () => {
    const solo = ruleBody(css(), ".stream-grouped .notice-card-row.notice-card-solo .conn-name")!;
    expect(solo, "the band's stand-down rule still exists").toBeTruthy();
    expect(solo, "it no longer forces one line").not.toMatch(/white-space:\s*nowrap/);
    expect(solo).toMatch(/-webkit-line-clamp:\s*2/);
    // It is the same box the card wears outside the band.
    expect(ruleBody(css(), ".notice-card .conn-name")).toMatch(/-webkit-line-clamp:\s*2/);
  });

  it("the Tracker's import row wears the two-line class at its call site", () => {
    expect(read("money/screens/TrackerScreen.tsx")).toMatch(/className="conn-name truncate">Import September Data</);
    // .truncate is what that class means here, despite the name.
    expect(ruleBody(css(), ".task-row .conn-name.truncate, .row .conn-name.truncate")).toMatch(/-webkit-line-clamp:\s*2/);
  });

  it("the focus card's reason wraps, because one card is not a list", () => {
    // "Three facts, one line" is a LIST rule: it exists so a busy row does
    // not leave the list ragged. The focus card is one card on an otherwise
    // empty screen, and the reason is the sentence it exists to give.
    expect(ruleBody(css(), ".facts"), "the list rule is untouched").toMatch(/flex-wrap:\s*nowrap/);
    expect(ruleBody(css(), ".facts > .fact:last-child")).toMatch(/white-space:\s*nowrap/);
    const card = ruleBody(css(), ".focus-card .facts > .fact:last-child")!;
    expect(card, "the card's own exception exists").toBeTruthy();
    expect(card).toMatch(/white-space:\s*normal/);
    expect(ruleBody(css(), ".focus-card .facts")).toMatch(/align-items:\s*flex-start/);
  });

  it("the capture bar takes a second line rather than losing half a sentence", () => {
    // The ninth finding, and the auditor could not see it: the hint did not
    // CLIP, it wrapped to two lines and painted past the pill's right edge
    // across the wordmark, on the one piece of chrome that is on every tab.
    // A screenshot found it. The gap is named in docs/AUDIT_CHECKLIST.md.
    // An ellipsis was tried first and the auditor then read "Add anything"
    // losing 48% on ten screens, so the pill wraps and keeps every word.
    const u = read("styles/uniformity.css");
    const bar = ruleBody(u, ".voice-bar")!;
    expect(bar, "the pill is what grows").toMatch(/flex-wrap:\s*wrap/);
    expect(ruleBody(u, ".voice-name"), "the mark does not give up a character").toMatch(/flex-shrink:\s*0/);
    const hint = ruleBody(u, ".voice-hint")!;
    expect(hint, "it moves to the next line whole, it does not clip").not.toMatch(/text-overflow:\s*ellipsis/);
    expect(hint, "and it does not break mid-sentence on that line either").toMatch(/white-space:\s*nowrap/);
    expect(hint).toMatch(/min-width:\s*0/);
  });

  it("the scale the auditor tops out at is the scale the app clamps to", () => {
    // If MAX_TYPE_SCALE ever moves, the matrix is measuring the wrong ceiling.
    expect(read("appearance/textZoom.ts")).toMatch(/MAX_TYPE_SCALE\s*=\s*1\.4/);
  });
});

// THE FOCUS AUDIT (2026-09-21). The last question the DOM audit could not
// answer, because it is about a SEQUENCE and not a frame: where does the
// keyboard go, and can you see it when it gets there. FOCUS=1 in
// tools/visual-audit.mjs tabs every screen and reports four kinds.
//
// The starting suspicion was WRONG and is recorded so nobody re-runs it. The
// computed outline on a focused control reads `auto 1px rgb(16,16,16)`, which
// looks like a near-black ring on a near-black app. It is not: Chromium's
// `outline: auto` is drawn specially and inverts per backdrop, and
// screenshotted on this app it is a white ring in dark and a black one in
// light. The ring is fine. What was not fine was everything around it.
describe("FOCUS-AUDIT: the keyboard can be followed, and what it lands on can be seen", () => {
  const tool = () => readFileSync(join(SRC, "..", "tools", "visual-audit.mjs"), "utf8");

  it("the auditor has a focus mode, and it starts at the top of the document", () => {
    expect(tool()).toMatch(/const FOCUS = process\.env\.FOCUS === "1"/);
    // blur() alone does NOT reset the sequential focus navigation starting
    // point, so Tab carried on from wherever the crawl's last click left it
    // and the order recorded was a partial one. A verification run caught it.
    expect(tool(), "focusing <body> is what moves the starting point").toMatch(/document\.body\.focus\(\)/);
  });

  it("the order check compares document position, within one scroller, ignoring fixed", () => {
    // Three false positives, all from this one arithmetic, all chased down
    // rather than triaged away: viewport y is not position (tabbing scrolls);
    // adding the scroll back puts an element in ITS OWN scroller's frame; and
    // a toast or a sheet footer does not scroll at all.
    const t = tool();
    expect(t).toMatch(/docY:/);
    expect(t).toMatch(/scroller:/);
    expect(t).toMatch(/!s\.fixed && !prev\.fixed && s\.scroller === prev\.scroller/);
  });

  it("a ring cut by overflow:hidden is a different finding from a row that did not scroll", () => {
    const t = tool();
    expect(t).toMatch(/add\(s\.scrolled \? "focus-unscrolled" : "ring-clipped"/);
    expect(t, "a field's caret is its indicator, so only a field is exempt from no-ring").toMatch(/add\("no-ring"/);
  });

  it("a scrolling row follows the keyboard, in one place for every row", () => {
    const hook = read("shared/useFocusReveal.ts");
    expect(hook, "the keyboard test, so a tap does not snap a chip about").toMatch(/matches\(":focus-visible"\)/);
    // "nearest" is the polite option and it did nothing on a snapping row, so
    // the hook measures first and centres. Both halves or neither.
    expect(hook).toMatch(/inline: "center"/);
    expect(hook, "measuring first is what buys back the no-op").toMatch(/!outOfView\(el\)/);
    // Mounted once, beside the other two document-level hooks.
    const app = read("App.tsx");
    expect(app).toMatch(/useFocusReveal\(\);/);
    expect(app, "it sits with useSheetEscape and useLayerFocus, not somewhere new").toMatch(/useLayerFocus\(\);\s*\n\s*useFocusReveal\(\);/);
  });

  it("the segmented control that scrolls says that it scrolls", () => {
    // It shipped as "Dashboard | Transactions | Budgets | Su", the fourth
    // label cut mid-word at the screen edge with nothing saying more existed
    // -- word for word the bug the chip rows were fixed for on 2026-08-02, in
    // a control that was never given the fix.
    const seg = ruleBody(css(), ".mt-tabrow .segmented")!;
    expect(seg, "the scroller is still a scroller").toMatch(/overflow-x:\s*auto/);
    expect(seg, "and now it fades at the edge, as .chip-row does").toMatch(/mask-image:\s*linear-gradient/);
    expect(seg).toMatch(/scroll-snap-type:\s*x/);
    expect(ruleBody(css(), ".mt-tabrow .segmented .seg")).toMatch(/scroll-snap-align:\s*start/);
    // The pattern it was copied from, so deleting one orphans the other.
    // .chip-row is declared twice (the base row at :117, the fade at :1909),
    // so take every rule whose selector IS that, not the first one.
    const chipRow = rulesOf("styles/components.css")
      .filter(([sel]) => sel === ".chip-row").map(([, body]) => body).join(" ");
    expect(chipRow).toMatch(/mask-image:\s*linear-gradient/);
  });
});

// THE GAP THAT LET TWO REAL BUGS SHIP PAST TWELVE CLEAN PASSES (2026-09-21).
//
// `truncated` measures scrollWidth against clientWidth, and those are EQUAL
// on a box that does not clip. So a string that simply grows past the box it
// sits in -- no overflow, no ellipsis, just painting on top of whatever is
// there -- was invisible to the tool by construction. Both of the day's bugs
// were exactly that: the capture bar's hint wrapping across the JARVIS
// wordmark and out past the pill, and "Subscriptions" running off the end of
// a segmented control. Both were found by LOOKING at a screenshot.
describe("OUTSIDE-BOX: text that escapes its box is a finding, not a blind spot", () => {
  const tool = () => readFileSync(join(SRC, "..", "tools", "visual-audit.mjs"), "utf8");

  it("the auditor reports text painting outside its nearest painted ancestor", () => {
    const t = tool();
    expect(t).toMatch(/add\("outside-box"/);
    // The box has to be the one a reader SEES. Half the spans in this app sit
    // in a bare div with no background, and escaping one of those is what
    // normal text flow looks like.
    expect(t, "the painted ancestor is the box").toMatch(/const painted = \(cs\) =>/);
    // Content outside a SCROLLER is the entire point of a scroller.
    expect(t, "the walk stops at the first scrollable ancestor")
      .toMatch(/if \(\[cs\.overflow, cs\.overflowX, cs\.overflowY\]\.some\(\(v\) => v === "auto" \|\| v === "scroll"\)\) break;/);
  });

  it("truncation is measured against the width the label WANTED", () => {
    // scrollWidth is blind to a flex item that lost a shrink fight: its
    // content box is smaller, so the text lays out at THAT width and
    // scrollWidth comes back equal to clientWidth. Measured on the New
    // Reminder sheet at 1.4 -- the bar title paints "New Remind..." and
    // reports 196 against 195. A Range over the text node agrees with
    // scrollWidth exactly, because both describe the post-ellipsis layout.
    const t = tool();
    expect(t, "an off-screen ruler at max-content").toMatch(/const natural = \(e, cs\) =>/);
    expect(t, "asked only when scrollWidth has nothing to say").toMatch(/if \(want <= e\.clientWidth \+ 1 && cs\.whiteSpace\.startsWith\("nowrap"\)\)/);
    // getComputedStyle().font is an empty string in Chromium for most
    // elements, which silently left the ruler measuring at the default 16px.
    expect(t, "the longhands, never the shorthand").toMatch(/ruler\.style\.fontFamily = cs\.fontFamily/);
    expect(t).not.toMatch(/ruler\.style\.font = cs\.font/);
  });

  it("a control its row forwards to is measured as big as the row", () => {
    // forwardTo is a React prop, so the auditor measured a 220x24 dropdown
    // value, found a thumb 9px below it landing on .row, and called the
    // target too small. It was right about the pixels and wrong about the
    // app. The selector is now in the DOM, and it is the SAME string the
    // pointer handler uses, so the two cannot drift.
    expect(read("shared/FormSheet.tsx")).toMatch(/data-forwards=\{forwardTo \|\| undefined\}/);
    const t = tool();
    expect(t).toMatch(/const forwarder = \(e\) =>/);
    expect(t, "resolved the way the row resolves it").toMatch(/n\.querySelector\(sel\) === e/);
  });

  it("a form row's value can shrink, and the row wraps before it loses a word", () => {
    // Holding the label without letting the value shrink just moved the
    // overflow: "At a Date and Time" ran 17px past the card and off the
    // screen, chevron and all, because .dd.dd-value .dd-w capped itself at
    // 52vw -- a viewport number doing a flexbox job.
    expect(ruleBody(css(), ".xs .row.xs-row > .dd")).toMatch(/min-width:\s*0/);
    expect(ruleBody(css(), ".xs .row.xs-row > .dd .dd-w"), "the row decides, not the viewport").toMatch(/max-width:\s*none/);
    // .xs .row.xs-row is declared twice (the 48px floor at :5137, the wrap
    // beside the .dd rules), so take every rule whose selector IS that.
    const xsRow = rulesOf("styles/components.css")
      .filter(([sel]) => sel === ".xs .row.xs-row").map(([, body]) => body).join(" ");
    expect(xsRow, "and it wraps before it clips").toMatch(/flex-wrap:\s*wrap/);
    // The vw cap stays for the capsule worn on a header, where there is no
    // row to bound it.
    expect(ruleBody(css(), ".dd.dd-value .dd-w")).toMatch(/max-width:\s*52vw/);
  });
});
