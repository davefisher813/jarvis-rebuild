import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// THE CONSISTENCY RATCHET (the research standard, Beloved App Visuals section 23, 2026-10-18).
//
// laws.test.ts already holds the main sheets to the radius map and the spacing scale. This holds the places those laws do
// not read, to the numbers they have TODAY, so they can only fall: a new one has to argue for itself by lowering another
// first. The pinned numbers are measured, not wished for. Lowering one is always welcome; raise one only with Dave's word.
const SRC = join(__dirname, "..");
const read = (p: string) => readFileSync(p, "utf8");
const blank = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const STYLES = readdirSync(join(SRC, "styles")).filter((f) => f.endsWith(".css")).map((f) => join(SRC, "styles", f));
// The sheets laws.test.ts already reads for radius and spacing.
const COVERED = new Set(["jarvis-design-system.css", "uniformity.css", "components.css", "ruled.css", "mail-rows.css", "editor.css"]);

describe("consistency ratchet: the counts only fall", () => {
  it("no radius in any sheet is a bare pixel stop (the glass sheets included; a hairline's 1px and a percentage are shapes)", () => {
    const bad: string[] = [];
    for (const p of STYLES) {
      blank(read(p)).split("\n").forEach((line, i) => {
        for (const m of line.matchAll(/border-radius:\s*([^;}]+)/g)) {
          const v = (m[1] ?? "").trim();
          if (/var\(--r-/.test(v) || v.split(/\s+/).every((x) => x === "0" || x === "1px" || /%/.test(x)) || v === "inherit") continue;
          bad.push(`${p.split("/").pop()}:${i + 1} ${v}`);
        }
      });
    }
    expect(bad).toEqual([]);
  });

  it("black in a shadow: the warm brown is the shadow's colour, and the black ones left are pinned", () => {
    let black = 0;
    for (const p of STYLES) {
      for (const line of blank(read(p)).split("\n")) {
        if (/(box-shadow|drop-shadow)/.test(line)) black += (line.match(/rgba\(0,\s*0,\s*0,/g) ?? []).length;
      }
    }
    expect(black, "black shadows; lower this, never raise it").toBeLessThanOrEqual(BLACK_SHADOWS);
  });

  it("only the shared glyph module reaches into the icon package", () => {
    const direct = walk(SRC)
      .filter((p) => /\.(ts|tsx)$/.test(p) && !/\.test\./.test(p))
      .filter((p) => /from\s+["']@phosphor-icons\/react["']/.test(read(p)))
      .map((p) => p.slice(SRC.length + 1))
      .sort();
    expect(direct, "files importing @phosphor-icons directly; the shared module is the one door").toEqual(PHOSPHOR_DOORS);
  });

  it("spacing literals in the sheets laws.test.ts does not read stay at today's count", () => {
    const PROPS = /(padding|margin|gap|row-gap|column-gap|padding-(top|bottom|left|right|inline|block)|margin-(top|bottom|left|right|inline|block))\s*:\s*([^;}]+)/g;
    let off = 0;
    for (const p of STYLES.filter((f) => !COVERED.has(f.split("/").pop()!))) {
      for (const line of blank(read(p)).split("\n")) {
        for (const m of line.matchAll(PROPS)) {
          const v = (m[4] ?? "").trim();
          if (/var\(|calc\(|auto|inherit|%|env\(|em\b|rem\b|vh|vw/.test(v)) continue;
          for (const part of v.split(/\s+/)) {
            if (!/^[\d.]+px$/.test(part) || part === "0px" || part === "1px") continue;
            if (Number(part.slice(0, -2)) % 4 !== 0) off++;
          }
        }
      }
    }
    expect(off, "off-grid spacing literals in the glass sheets; lower this, never raise it").toBeLessThanOrEqual(OFF_GRID_GLASS);
  });
});

// Measured 2026-10-18.
// Black shadows were 19 before the two primary-button shadows went warm (glass-dark.css, glass-light.css).
const BLACK_SHADOWS = 17;
const OFF_GRID_GLASS = 1;
const PHOSPHOR_DOORS = ["shared/filledIcons.tsx", "shared/glyphs.tsx", "shared/icons.tsx"];
