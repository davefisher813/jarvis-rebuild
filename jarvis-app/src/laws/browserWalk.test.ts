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
  it("light --good and --warn clear AA on every ground they land on", () => {
    const page = "#F3F4F9", card = "#FFFFFF";
    const cases: Array<[string, string, string]> = [
      ["--good", "the page", page],
      ["--good", "a white card", card],
      ["--good", "its own tint on the page", `rgba(52,199,89,0.14) over ${page}`],
      ["--good", "its own tint on a card", `rgba(52,199,89,0.14) over ${card}`],
      ["--warn", "the page", page],
      ["--warn", "a white card", card],
      ["--warn", "its own tint on the page", `rgba(255,149,0,0.14) over ${page}`],
      ["--warn", "its own tint on a card", `rgba(255,149,0,0.14) over ${card}`],
    ];
    for (const [name, where, ground] of cases) {
      const parts = ground.split(" over ");
      const bg = parts.length === 2
        ? `rgb(${overC(parts[0]!, parts[1]!).join(",")})`
        : ground;
      const cr = contrast(tokenIn("light", name), bg);
      expect(cr, `light ${name} on ${where} is ${cr.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
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
    for (const cls of [".p3-time-btn", ".upnext-skip", ".search-cancel", ".ob-x", ".note-conn-add", ".note-fix"]) {
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
    const px = Number(/row-gap:\s*(\d+)px/.exec(gap!)?.[1]);
    expect(px + 32, "a 32px chip plus the row gap must reach the tap minimum").toBeGreaterThanOrEqual(44);
    // The swatch is 24px of paint (uniformity.css), so its grid needs 20.
    expect(ruleBody(css(), ".swatch-pick")).toMatch(/gap:\s*var\(--s-6\)/);
    expect(ruleBody(ruled(), ".ruled .sc-steps")).toMatch(/gap:\s*10px/);
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

  // And --tx-4 keeps the job it was tuned for. Raising it (option A) is the
  // road not taken: the done state is supposed to recede.
  it("--tx-4 stays the dim past-state grey it was", () => {
    for (const theme of ["dark", "light"]) {
      expect(tokenIn(theme, "--tx-4"), `${theme} --tx-4`).toMatch(/0\.30\)$/);
    }
  });

  // The classes the walk measured. A done reminder, a paid bill and a
  // .cal-cell.out are NOT here on purpose: they use the dim grey correctly.
  it("live metadata takes the quiet token, not the dim one", () => {
    const all = (css() + read("styles/ruled.css")).replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...all.matchAll(/([^{}]+)\{([^}]*)\}/g)];
    const LIVE = [".prop-tag", ".sched-sep", ".upnext-skip", ".rep-hint", ".doc-count",
      ".receipt-line", ".ruled .sched-time .ampm", ".ruled .r-next", ".ruled .wk-w", ".ruled .sched-now .t"];
    for (const sel of LIVE) {
      const body = rules.find((m) => m[1]!.replace(/\s+/g, " ").trim() === sel)?.[2];
      expect(body, `${sel} is still in the sheet`).toBeTruthy();
      expect(body, `${sel} carries live information and must not wear --tx-4`).not.toMatch(/color:\s*var\(--tx-4\)/);
      expect(body, `${sel} takes --tx-quiet`).toMatch(/color:\s*var\(--tx-quiet\)/);
    }
  });

  it("the deliberately dimmed states keep --tx-4", () => {
    const all = (css() + read("styles/ruled.css")).replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...all.matchAll(/([^{}]+)\{([^}]*)\}/g)];
    for (const sel of [".cal-cell.out", ".rem-row.done .rem-name", ".ruled .task-row .money-amt.paid"]) {
      const body = rules.find((m) => m[1]!.replace(/\s+/g, " ").trim() === sel)?.[2];
      expect(body, `${sel} is still in the sheet`).toBeTruthy();
      expect(body, `${sel} is a past state and is meant to recede`).toMatch(/color:\s*var\(--tx-4\)/);
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
