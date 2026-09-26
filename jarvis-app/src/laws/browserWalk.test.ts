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
    for (const sel of [".sheet-bar-save", ".note-fix", ".toast-action", ".see-all", ".prov-link"]) {
      expect(rule![1], `${sel} is on the sheet-red list`).toContain(sel);
    }
    // AMENDED 2026-09-25 (§AL): the capsule left this list. Its label sits on
    // its own opaque --capsule-fill now, not on the sheet grey (--tint on
    // #17171A is 4.82:1), and a capsule reads the same on a sheet as off one.
    // .see-all and .prov-link joined it: §AM made them the tap red, and they
    // sit straight on the sheet grey.
    expect(rule![1], "the capsule keeps its own red label on a sheet").not.toMatch(/\.row-act(?![\w-])/);
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
    // .ruled .r-next came off on 2026-09-22. It was the quiet one-line Next,
    // and it was SUPERSEDED on 2026-09-13 by the .r-next-in / -k / -v trio
    // ("next should be yellow in my opinion or orange"), which draws the key
    // in --warn and the value in --tx-1. The old rule was never deleted, so
    // for nine days this law measured the quiet ink of a line no screen drew.
    // There is no successor to list here: nothing in that row is quiet now.
    // AMENDED 2026-09-25 (§AM): .focus-skip left this list. "Not This One"
    // is a tap, and the key gives a tap that is not button-shaped the red.
    const skip = rules.find((m) => m[1]!.replace(/\s+/g, " ").trim() === ".focus-skip")?.[2];
    expect(skip, "Not This One wears the tap red").toMatch(/color:\s*var\(--tint\)/);
    const LIVE = [".prop-tag", ".sched-sep", ".rep-hint", ".doc-count",
      ".receipt-line", ".ruled .sched-time .ampm", ".ruled .wk-w", ".ruled .sched-now .t"];
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
    for (const sel of [".cal-cell.out", ".rem-row.done .rem-name"]) {
      const body = rules.find((m) => m[1]!.replace(/\s+/g, " ").trim() === sel)?.[2];
      expect(body, `${sel} is still in the sheet`).toBeTruthy();
      expect(body, `${sel} is a past state and recedes to secondary`).toMatch(/color:\s*var\(--tx-2\)/);
    }
    // AMENDED 2026-09-25 (§AM): a paid amount left this list. Beside "Paid
    // Sep 1" in --tx-3 it was a second grey of the same hex, and the key
    // gives paid green.
    const paid = rules.find((m) => m[1]!.replace(/\s+/g, " ").trim() === ".ruled .task-row .money-amt.paid")?.[2];
    expect(paid, "a paid amount is the key's green").toMatch(/color:\s*var\(--good\)/);
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
describe("LAW: the schedule rail leads the row, so nothing can get in front of it", () => {
  const ruled = () => readFileSync(join(SRC, "styles/ruled.css"), "utf8");

  // WHAT THIS LAW USED TO SAY, AND WHY IT SAYS SOMETHING ELSE (2026-09-21).
  // The rail used to sit just PAST the time gutter, so its left was written
  // as "row padding + 62px" -- and when the Remember star was added ahead of
  // the time, the gutter moved right, the rail did not, and the rail landed
  // inside the digits. The law that followed pinned the SHAPE: the rail's
  // left must read a per-row --sched-lead, and every control that can take
  // the leading slot must declare the room it takes.
  //
  // Dave's row layout of 2026-09-21 (the time above the title, picked from
  // four rendered options) removes the gutter entirely. The rail is the
  // row's left edge now, ahead of the star and everything else, so there is
  // nothing to sit past and no lead to read. The bug the old law existed for
  // cannot happen: a new leading control lands AFTER the rail by
  // construction.
  //
  // So the law keeps its job and changes its sentence. The rail is pinned to
  // the row's own inset, and --sched-lead must not come back into it, which
  // is what a half-revert of the layout would look like.
  it("the rail is pinned to the row's own inset, not to a gutter", () => {
    const bare = ruled().replace(/\/\*[\s\S]*?\*\//g, "");
    const bar = [...bare.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter((m) => m[1]!.split(",").some((s) => s.trim() === ".ruled .sched-bar"))
      .map((m) => m[2]!).join(" ");
    expect(bar, ".ruled .sched-bar still has its own rule").toBeTruthy();
    expect(bar, "the rail sits at the row's inset").toMatch(/left:\s*var\(--s-4\)/);
    expect(bar, "and never behind a gutter measurement again").not.toMatch(/var\(--sched-lead|62px/);
  });

  it("the rail is the first thing in the row", () => {
    for (const f of ["schedule/screens/DayRow.tsx", "schedule/screens/ProposedRow.tsx"]) {
      const src = readFileSync(join(SRC, f), "utf8");
      const from = src.indexOf("sched-bar");
      const to = src.indexOf("sched-time");
      expect(from, f + " draws the rail").toBeGreaterThan(-1);
      expect(to, f + " draws the time").toBeGreaterThan(from);
      // Whatever leads the row now leads it AFTER the rail, which is the
      // whole point: the rail cannot be pushed off its own edge.
      const rowOpen = src.lastIndexOf("<", from);
      expect(src.slice(0, from).lastIndexOf("sched-row"), f + " the rail sits inside the row element")
        .toBeLessThan(rowOpen);
    }
  });

  it("the body takes the row's full width under the time", () => {
    const bare = ruled().replace(/\/\*[\s\S]*?\*\//g, "");
    expect(bare, "the row wraps").toMatch(/\.ruled \.sched-row \{[^}]*flex-wrap: wrap/);
    expect(bare, "and the body is the thing that takes the second line")
      .toMatch(/\.ruled \.sched-row > \.sched-body \{[^}]*flex: 1 0 100%/);
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

  it("every segmented control that scrolls says so, from ONE declaration", () => {
    // The Tracker's shipped as "Dashboard | Transactions | Budgets | Su", the
    // fourth label cut mid-word at the screen edge with nothing saying more
    // existed -- word for word the bug the chip rows were fixed for on
    // 2026-08-02, in a control that was never given the fix.
    //
    // Then Life's did the same thing ("Areas Tasks Reminders Projects Goa")
    // because the Tracker had been fixed BY NAME. Two scrollers, one rule:
    // a third joins by being added to this selector, and cannot be forgotten
    // the way Life's was.
    const seg = ruleBody(css(), ".mt-tabrow .segmented, .life-seg .segmented")!;
    expect(seg, "one declaration covering both").toBeTruthy();
    expect(seg, "the scroller is still a scroller").toMatch(/overflow-x:\s*auto/);
    expect(seg, "and it fades at the edge, as .chip-row does").toMatch(/mask-image:\s*linear-gradient/);
    expect(seg).toMatch(/scroll-snap-type:\s*x/);
    expect(ruleBody(css(), ".mt-tabrow .segmented .seg, .life-seg .segmented .seg")).toMatch(/scroll-snap-align:\s*start/);
    // Neither may quietly grow a private copy of the rule again.
    expect(ruleBody(css(), ".life-seg .segmented"), "no second Life-only copy").toBeNull();
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

// NOTHING HIDES A COMMITTED EVENT (Dave, 2026-09-21, on a screenshot of his
// own Today: "I also have a job interview at 3 today and Jarvis is aware. How
// is that not in the schedule?").
//
// It WAS in the schedule. It was inside "Deep Work 3:00 PM - 7:00 PM", behind
// a collapsed disclosure that called it one of "5 tasks". Both day lists
// nested any event wholly contained by a holding block and then filtered it
// out of the top level, so the one appointment that could not be moved was
// the one thing the day did not show.
//
// The August request that built the nesting said TASKS, on a screenshot of a
// PROPOSAL drawn beside the block it had been planned into. Proposals still
// nest. Events never did belong in that rule, and planDay.ts had already
// written the opposite for the planner it feeds: "Zones are preferences, not
// walls: events and hard blocks inside a zone still win."
describe("NESTING: a block may hold work, never a commitment", () => {
  it("the ruling is written once, where both surfaces read it", () => {
    const n = read("schedule/nesting.ts");
    expect(n).toMatch(/export const NESTABLE = \{ proposal: true, event: false \}/);
    // The geometry stays: a proposal still has to be WHOLLY inside to nest.
    expect(n).toMatch(/export function holderFor/);
  });

  it("neither day list nests a committed event", () => {
    // Today and the Schedule tab had separate copies of this, which is how it
    // came to be wrong on both. Each is checked, so fixing one and forgetting
    // the other fails here.
    const today = read("today/YourDay.tsx");
    expect(today, "Today builds no held-event map").not.toMatch(/heldEv/);
    expect(today, "and filters no event out of its own day").not.toMatch(/nested\.has\("e:"/);
    const sched = read("schedule/screens/SchedulePage.tsx");
    expect(sched, "the Schedule tab builds none either").not.toMatch(/heldBy/);
    expect(sched).not.toMatch(/nestedIds/);
    // Both still nest proposals, which is the half that was always right.
    expect(today).toMatch(/heldProp/);
    expect(sched).toMatch(/heldPropBy/);
  });

  it("the held count counts only what the word says", () => {
    // The disclosure is labelled "task", so counting committed events into it
    // is how a job interview came to be described as one of "5 tasks".
    expect(read("today/YourDay.tsx")).toMatch(/heldCount=\{props\.length\}/);
    expect(read("schedule/screens/SchedulePage.tsx")).toMatch(/heldCount=\{heldProps\.length\}/);
  });
});

// WHAT THE AUDIT ACTUALLY LOOKED AT (2026-09-21).
//
// Dave, after reporting four bugs on a live workout screen: "You are not
// proofing work." He was right, and the reason was measurable. The crawl's
// tab list was a hardcoded ["Today", "Tasks", "Schedule", "More"] -- the tab
// bar on the day it was written. The bar is CONFIGURABLE, his reads Today /
// Life / Schedule / Brain / Email / More, so "Tasks" matched nothing and was
// silently skipped by the click's own try/continue, and Life, Brain and Email
// were never opened at all.
//
// So a tool that reported "0 findings across 22 screens" had never once
// opened the screen every one of his bugs was on. A tool that decides for
// itself which parts of the app count is not an audit, it is a sample.
describe("AUDIT COVERAGE: the crawl does not choose what counts", () => {
  const tool = () => readFileSync(join(SRC, "..", "tools", "visual-audit.mjs"), "utf8");

  it("takes its tabs from the rendered tab bar, never from a list in the tool", () => {
    const t = tool();
    expect(t).toMatch(/const TABS = await page\.evaluate\(/);
    expect(t).toMatch(/querySelectorAll\("\.tab-bar \.tab"\)/);
    expect(t, "the hardcoded four are gone").not.toMatch(/const TABS = \["Today", "Tasks", "Schedule", "More"\]/);
    // A bar that names nothing is a gap, and a gap is reported, not assumed
    // away -- the same rule the sheet skips already follow.
    expect(t).toMatch(/the tab bar named no tabs/);
  });

  it("dives into a TAB as well as a More row", () => {
    // Life is a hub. Audited as one screen it looked fine, and everything
    // behind it was invisible.
    const t = tool();
    // AMENDED 2026-09-22: the dive now takes a `reach` that navigates to its
    // section fresh before every row and reports whether it got there. Trusting
    // "back" left the Settings dive running on Edit Tabs, so none of its
    // thirteen screens were ever audited.
    expect(t).toMatch(/async function diveInto\(page, label, reach, sheetSkips, sheetsSeen\)/);
    expect(t, "each row is reached from a known place").toMatch(/if \(i > 0 && !\(await reach\(\)\)\)/);
    expect(t, "and a section that cannot be reached is named, not skipped").toMatch(/could not be reached for the dive, NOT AUDITED/);
    expect(t, "More still dives").toMatch(/diveInto\(page, "More > " \+ r/);
    expect(t, "and now so does every other tab").toMatch(/diveInto\(page, "Tab: " \+ t/);
    // More's own rows are crawled in full above, so it is not dived twice.
    expect(t).toMatch(/if \(t === "More"\) continue;/);
  });

  it("prints every screen it visited, so coverage is never invisible again", () => {
    // The gap was findable the whole time; nothing ever printed the list.
    const t = tool();
    expect(t).toMatch(/SCREENS VISITED/);
    expect(t).toMatch(/VISITED\.push\(name\)/);
  });
});

// A NEW SCREEN STARTS AT ITS TOP (2026-09-21).
//
// Dave: "You need to VIEW the visual edits. Stop going off of code." Driving
// the real app to a real workout is what found this, and reading the code
// would not have: .app-scroll is ONE scroller for the whole app and it keeps
// its scrollTop when the thing inside it is replaced. Walking down a program
// day to reach Start left the scroller 34px down, so the live session opened
// with its exercise dots and "1 of 7" under the sticky nav bar, half drawn,
// on the first frame of a workout.
//
// Measured before and after rather than argued: .se-prog sat at y 43 with the
// nav occupying 0 to 61; it sits at 77 now.
describe("SCROLL RESET: a screen does not inherit the last one's position", () => {
  it("the shell brings its scroller back to the top when the screen changes", () => {
    const shell = read("shell/AppShell.tsx");
    expect(shell, "the scroller is held, not queried for by class").toMatch(/const scroller = useRef<HTMLDivElement>\(null\)/);
    expect(shell).toMatch(/<div className="app-scroll" ref=\{scroller\}>/);
    expect(shell).toMatch(/scroller\.current\?\.scrollTo\(\{ top: 0/);
    // The two screen changes this component can see. A live session is one of
    // them because the gym sits four components below the shell and swaps the
    // whole surface without the tab ever changing.
    expect(shell).toMatch(/\}, \[active, sessionOpen\]\);/);
  });

  it("does not animate a move the person did not make", () => {
    expect(read("shell/AppShell.tsx")).toMatch(/behavior: "instant"/);
  });
});
