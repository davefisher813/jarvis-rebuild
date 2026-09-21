// LAW: EVERY LAYER THAT COVERS THE SCREEN CAN BE CLOSED WITHOUT A POINTER.
//
// useSheetEscape already said this and only half meant it. It keyed on
// .sheet-scrim, which is 66 of the app's layers, and six others were not
// scrims: Search, Fresh Start, What Now (.search-overlay), the schedule's
// guard (.ag-scrim), and the two menu scrims. On those, Escape did nothing.
//
// What Now is how it surfaced, and not from reading the code. The audit
// crawler opened it, could not get out, and every tab click for the rest of
// that pass landed on the overlay and was swallowed -- the run reported one
// screen with no error. A tool got stuck exactly where a keyboard or
// switch-control user gets stuck.
//
// So the roster of layers is held here, against the markup, in both
// directions: a new overlay class that nothing dismisses fails, and a layer
// that loses its way out fails.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(__dirname, "..");
const HOOK = readFileSync(join(SRC, "shared/useSheetEscape.ts"), "utf8");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx$/.test(n) && !/\.test\./.test(n)) out.push(p);
  }
  return out;
}

/** Every class the markup uses to cover the screen. */
function layerClassesInMarkup(): Set<string> {
  const found = new Set<string>();
  for (const f of walk(SRC)) {
    const r = relative(SRC, f).replace(/\\/g, "/");
    if (/^(bench|testpanel|laws)\//.test(r)) continue;
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/className=\{?"([^"]*)"/g)) {
      for (const cls of m[1]!.split(/\s+/)) {
        if (/^(sheet-scrim|hmenu-scrim|block-menu-scrim|time-pop-scrim|ag-scrim|search-overlay)$/.test(cls)) found.add(cls);
      }
    }
  }
  return found;
}

describe("LAW: Escape closes the top layer, whatever kind it is", () => {
  it("the hook's roster covers every layer class the markup uses", () => {
    const missing = [...layerClassesInMarkup()].filter((c) => !HOOK.includes(c));
    expect(missing, "an overlay class Escape has never heard of").toEqual([]);
  });

  it("the topmost layer wins, so a sheet over an overlay closes first", () => {
    // Without this the hook could dismiss the overlay UNDER an open sheet.
    expect(HOOK).toMatch(/all\[all\.length - 1\]/);
  });

  it("every full-screen layer names its own way out", () => {
    // A scrim can be clicked; .search-overlay has no scrim, so the control
    // that leaves it carries data-layer-close for the hook to press.
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      const r = relative(SRC, f).replace(/\\/g, "/");
      if (/^(bench|testpanel|laws)\//.test(r)) continue;
      const src = readFileSync(f, "utf8");
      if (!/className="search-overlay/.test(src)) continue;
      if (!/data-layer-close/.test(src)) offenders.push(r);
    }
    expect(offenders, "a full-screen overlay with no keyboard exit").toEqual([]);
  });

  it("HeadMenu still owns Escape while it is open", () => {
    // Closing the menu AND the sheet under it with one key is a surprise.
    // By POSITION, not by a whitespace-exact regex: the first version of this
    // assertion pinned the brace style and failed on formatting rather than
    // on behaviour, which is a law nobody will keep.
    const guard = HOOK.indexOf("hmenu-scrim");
    const prevent = HOOK.indexOf("e.preventDefault()");
    expect(guard, "the hook must know about the menu scrim").toBeGreaterThan(-1);
    expect(guard, "the menu's claim is checked before Escape is consumed").toBeLessThan(prevent);
  });
});
