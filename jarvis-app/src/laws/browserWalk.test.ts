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
