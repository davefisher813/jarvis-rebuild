import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
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
