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
