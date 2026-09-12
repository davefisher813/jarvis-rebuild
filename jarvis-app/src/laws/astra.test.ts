import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { posix } from "node:path";

// THE ASTRA LAWS (Dave's picks, 2026-09-12; Build Master section 7, items 3
// to 5). Three rules the approved harness draws by, written as tests the
// same session the primitives landed, so a row built next week cannot drift
// from the row he approved.
//
// Each of these was proven to bite before it shipped: a violation was
// planted in a scratch component, the law went red, the scratch was deleted.
// The commit message says so.

const { join } = posix;
const SRC = join(process.cwd().replace(/\\/g, "/"), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const rel = (f: string) => f.slice(SRC.length + 1);
const COMPONENTS = walk(SRC).filter((f) => f.endsWith(".tsx") && !/\.test\.tsx$/.test(f) && !f.includes("/bench/") && !f.includes("/testpanel/"));
const read = (f: string) => readFileSync(f, "utf8");
const CSS = read(join(SRC, "styles/components.css"));

// A HEALTH SURFACE, for the K.3 exception below. Everything under health/ and
// gym/ renders inside a .health-ruled root, as does any file that sets the
// class itself. HEALTH_BODIES is the short list of shared bodies that carry
// no root of their own because they are rendered INTO one -- HealthBody is
// CategoryDetail's health branch and nothing else ever mounts it. Kept as a
// list rather than guessed at, so adding a body to it is a decision somebody
// makes on purpose.
const HEALTH_BODIES = ["brain/HealthBody.tsx"];
export function isHealthSurface(f: string): boolean {
  const r = rel(f);
  return r.startsWith("health/") || r.startsWith("gym/") || HEALTH_BODIES.includes(r) || read(f).includes("health-ruled");
}

// The state words, G5. Closed: a new one is a ruling, added here on purpose.
export const STATE_WORDS = [
  "FIXED", "FOCUS", "PROTECTED", "FLEXIBLE", "PROPOSED", "LIVE", "COMPLETED",
  "KNOWN", "LEARNED", "WATCHING", "NEEDS CONFIRMATION", "FADING", "RULE",
];

describe("ASTRA: the primitives exist under the harness's own names", () => {
  it("components.css draws .facts, .fact variants, .row-star, .why and .dring", () => {
    for (const sel of [".facts {", ".fact + .fact::before", ".fact.warn", ".fact.good", ".fact.sky", ".fact.purp", ".fact.red", ".fact.cat", ".fact.st", ".row-star {", ".row-star.on", ".why {", ".dring {"]) {
      expect(CSS, sel + " is missing").toContain(sel);
    }
  });

  it("the state word is small caps from CSS, never a filled pill", () => {
    const st = CSS.match(/\.fact\.st\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(st).toMatch(/text-transform:\s*uppercase/);
    expect(st).not.toMatch(/background/);
    expect(st).not.toMatch(/border-radius/);
  });
});

// R.1 amended: .row-star is a leading element and not the row's control.
// The row's one control stays in the trailing slot; a star anywhere after
// the title is the star pretending to be one.
describe("ASTRA law 3: the Remember star leads the row and is never its control", () => {
  it("every .row-star sits before the row's title, never in the trailing slot", () => {
    const bad: string[] = [];
    for (const f of COMPONENTS) {
      const src = read(f);
      let i = src.indexOf("row-star");
      while (i !== -1) {
        // The row this star belongs to is the nearest row opener before it.
        const before = src.slice(0, i);
        const rowAt = Math.max(before.lastIndexOf('className="row'), before.lastIndexOf('className={"row'), before.lastIndexOf('className={`row'));
        const between = rowAt === -1 ? before.slice(-400) : before.slice(rowAt);
        if (rowAt === -1) bad.push(`${rel(f)}: a row-star outside any row`);
        else if (/row-grow|conn-name|pill-act|className="cap\b|row-r\b/.test(between)) bad.push(`${rel(f)}: a row-star after the title or in the trailing slot`);
        i = src.indexOf("row-star", i + 1);
      }
    }
    expect(bad).toEqual([]);
  });
});

// K.3 extended: one coloured fact per .facts line. .fact.st and .fact.cat
// carry their own colour by rule and do not count.
//
// HEALTH IS THE EXCEPTION (Health R7, Dave's ruling 2026-09-10, written down
// 2026-09-12). A health row shows six readings at once -- 48 min, 14 sets,
// 185 x 5, 1 PR -- and the activity ramp exists precisely so those read apart
// at a glance; one hue per line would put five of them back in grey and undo
// the thing the ramp was added for. So this scan skips health surfaces, and
// laws/healthSkin.test.ts picks them up with the rule that actually binds
// there: a hue may land on a number, a time, a unit or a state word, and
// never on a label or a connective word. The exception is a DIFFERENT law,
// not an absence of one.
describe("ASTRA law 4: at most one coloured fact per .facts line", () => {
  it("no .facts block carries two of warn, good, sky, purp, red", () => {
    const bad: string[] = [];
    for (const f of COMPONENTS) {
      if (isHealthSurface(f)) continue;
      const src = read(f);
      const re = /className=(?:"facts"|\{"facts|\{`facts)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        // A .facts line holds spans, so the block ends at the first closing
        // div after it. Good enough to count by, and wrong only in the
        // direction that flags too much, which is the direction a law may err.
        const end = src.indexOf("</div>", m.index);
        const block = src.slice(m.index, end === -1 ? undefined : end);
        const coloured = block.match(/\bfact(?: [a-z]+)* (?:warn|good|sky|purp|red)\b/g) ?? [];
        if (coloured.length > 1) bad.push(`${rel(f)}: ${coloured.length} coloured facts on one line (${coloured.join(", ")})`);
      }
    }
    expect(bad).toEqual([]);
  });
});

// G5: the state words are a closed set. A literal inside a .fact.st is one
// of them or the law fails; a dynamic word comes through stateWord.ts when
// that lands (Push B) and is checked there.
describe("ASTRA law 5: a state word is one of the thirteen", () => {
  it("every literal .fact.st is in the closed set", () => {
    const bad: string[] = [];
    for (const f of COMPONENTS) {
      const src = read(f);
      const re = /className="fact st[^"]*"[^>]*>([^<{]+)</g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const word = m[1]!.trim().toUpperCase();
        if (!STATE_WORDS.includes(word)) bad.push(`${rel(f)}: "${m[1]!.trim()}" is not a state word`);
      }
    }
    expect(bad).toEqual([]);
  });
});
