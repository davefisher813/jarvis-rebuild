import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { posix } from "node:path";

// THE HEALTH SKIN LAWS (Dave's picks 2026-09-12; Health Build Master section
// 7, items 1 to 3). Three rulings the approved harness
// (JARVIS_HEALTH_PREVIEW_2026_09_12.html) draws by, written as tests the same
// session the skin landed, so the next pass over these screens cannot quietly
// undo them -- two of the three are reversals of reasoning that was written
// down and sounded good, which is exactly the kind of decision that gets
// re-derived back into the code a month later by someone reading the old
// comment.
//
// Each was proven to bite before it shipped: a violation was planted, the law
// went red naming it, the planted violation was removed. The commit says so.

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
const read = (f: string) => readFileSync(f, "utf8");
const RULED = read(join(SRC, "styles/ruled.css"));
const COMPONENTS_CSS = read(join(SRC, "styles/components.css"));
const TOKENS = read(join(SRC, "styles/jarvis-design-system.css"));
const COMPONENTS = walk(SRC).filter(
  (f) => f.endsWith(".tsx") && !/\.test\.tsx$/.test(f) && !f.includes("/bench/") && !f.includes("/testpanel/"),
);

const RAMP = ["lime", "cyan", "pink", "amber", "violet", "blue"] as const;

// ---------------------------------------------------------------------------
// LAW 1 (R1). THE PRIMARY MOVE IN HEALTH IS THE APP'S RED.
//
// The 09-10 pass painted Start, Log a set and Finish with the ramp's lime,
// reasoning that every workout app makes "go" green. Overruled 09-12: the
// ramp is how DATA reads at a glance on these screens, and a button wearing a
// data hue spends the one colour that was carrying meaning. Lime is logged
// work. Red is the thing you tap, in Health exactly as everywhere else.
// ---------------------------------------------------------------------------
describe("HEALTH law 1: the Health primary is Jarvis red, and no primary wears the ramp", () => {
  it(".ruled.health-ruled .btn-primary resolves to the accent fill", () => {
    const m = RULED.match(/\.ruled\.health-ruled \.btn-primary \{([^}]*)\}/);
    expect(m, ".ruled.health-ruled .btn-primary is missing from ruled.css").toBeTruthy();
    expect(m![1]).toMatch(/background:\s*var\(--accent-fill\)/);
    expect(m![1], "the Health primary must not wear a ramp hue").not.toMatch(/--hl-/);
  });

  it("no .btn-primary rule anywhere resolves to an --hl-* value", () => {
    const bad: string[] = [];
    for (const [name, css] of [["ruled.css", RULED], ["components.css", COMPONENTS_CSS]] as const) {
      const re = /([^}]*\.btn-primary[^{}]*)\{([^}]*)\}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(css))) {
        if (/--hl-/.test(m[2]!)) bad.push(`${name}: ${m[1]!.trim()} { ${m[2]!.trim()} }`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("the hero's Start pill no longer paints itself off the ramp either", () => {
    const m = RULED.match(/\.ruled \.h-hero \.pill-act \{([^}]*)\}/);
    expect(m, ".ruled .h-hero .pill-act is missing from ruled.css").toBeTruthy();
    expect(m![1], "the hero's primary must not wear a ramp hue").not.toMatch(/--hl-/);
  });
});

// ---------------------------------------------------------------------------
// LAW 2 (R7). THE K.3 HEALTH EXCEPTION, AND WHAT IT DOES NOT EXCUSE.
//
// Astra law 4 allows one coloured fact per .facts line. Health is exempt (the
// scan in astra.test.ts skips health surfaces) because a health row shows six
// readings at once and the ramp exists so they read apart.
//
// What the exception does NOT cover is which WORDS may take a hue. A hue on
// these screens means "this is the datum" -- a number, a time, a unit, or a
// state word. Put it on a label or a connective and the line stops being data
// with labels and becomes a line of highlighters, which is the exact failure
// the ramp was added to fix. Labels stay --tx-2.
// ---------------------------------------------------------------------------

// Words that ARE the datum even with no digit in them. Short and closed on
// purpose: a new one is a ruling, added here deliberately. Load mode (Each,
// Total) counts because it is what the number MEANS -- "135, each hand" is a
// different fact from "135 total", and the word carries that rather than
// labelling it.
const UNIT_WORDS = ["EACH", "TOTAL", "LB", "KG", "MG", "IU", "REPS", "SETS", "GLASSES", "PR", "PRS"];

function carriesData(text: string): boolean {
  const t = text.trim();
  if (t === "") return false;
  if (/\d/.test(t)) return true; // a number, a time, a weight, a date
  return UNIT_WORDS.includes(t.toUpperCase());
}

describe("HEALTH law 2: a hue lands on the datum, never on a label", () => {
  it("the one-coloured-fact scan exempts health surfaces, and says why", () => {
    const astra = read(join(SRC, "laws/astra.test.ts"));
    expect(astra, "astra law 4 must skip health surfaces").toMatch(/isHealthSurface\(f\)/);
    expect(astra, "and must name the ruling that exempted them").toMatch(/R7/);
  });

  it("the ramp is available as a fact variant on health surfaces only", () => {
    for (const hue of ["lime", "cyan", "amber", "violet", "hblue", "pink"]) {
      expect(RULED, `.fact.${hue} is missing from the health block`).toContain(`.ruled.health-ruled .fact.${hue}`);
    }
    // Outside .health-ruled the ramp is not a fact colour: the app's intent
    // colours are, and Astra's law counts those.
    const loose = COMPONENTS_CSS.match(/^\.fact\.(lime|cyan|amber|violet|hblue|pink)\b/gm) ?? [];
    expect(loose, "a ramp fact variant escaped the health block").toEqual([]);
  });

  it("no literal .fact in the ramp's hues carries a label or a connective word", () => {
    const bad: string[] = [];
    const hues = ["lime", "cyan", "amber", "violet", "hblue", "pink"].join("|");
    // State words are the fourth thing allowed to take a hue, and they are
    // already a closed set pinned by Astra law 5, which owns .fact.st. This
    // scan is about the other three, so an .st fact is that law's business.
    // Literal classNames with a literal text child. A hue chosen at runtime
    // cannot be read from the source; the same limit Astra law 5 carries, and
    // the same reason -- a law that guesses is a law that lies.
    const re = new RegExp(`className="fact (?!st\\b)(?:[a-z]+ )*(?:${hues})"[^>]*>([^<{]+)<`, "g");
    for (const f of COMPONENTS) {
      const src = read(f);
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const text = m[1]!.trim();
        if (!carriesData(text)) bad.push(`${rel(f)}: "${text}" is a label wearing a data hue`);
      }
    }
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// LAW 3 (R3 / H-03). THE LIGHT RAMP IS THE DARK RAMP.
//
// Light used to darken the six ramp hues until they cleared AA as text on a
// white card -- measured, documented, and overruled 09-12: the ramp means one
// thing or it means nothing, and a hue that changes value between themes is
// two hues. The trade is written in full at the token block. This law exists
// because the reasoning that was overruled is still persuasive: without it,
// the next contrast pass re-derives the darkened values and nobody notices
// the ruling was reversed.
// ---------------------------------------------------------------------------
describe("HEALTH law 3: the light activity ramp equals the dark one", () => {
  const block = (sel: string) => {
    const i = TOKENS.indexOf(sel);
    expect(i, `${sel} is missing from the token file`).toBeGreaterThan(-1);
    // To the next top-level block opener, which is how the file is laid out.
    const rest = TOKENS.slice(i + sel.length);
    const next = rest.search(/\n(?::root|\[data-theme)/);
    return next === -1 ? rest : rest.slice(0, next);
  };
  const ramp = (css: string) => {
    const out: Record<string, string> = {};
    const re = /--hl-([a-z]+(?:-tint)?):\s*([^;]+);/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css))) out[m[1]!] = m[2]!.trim();
    return out;
  };

  it("all six hues and all six tints are byte-identical across the themes", () => {
    const dark = ramp(block('[data-theme="dark"] {'));
    const light = ramp(block('[data-theme="light"] {'));
    for (const hue of RAMP) {
      expect(dark[hue], `dark --hl-${hue} is missing`).toBeTruthy();
      expect(light[hue], `light --hl-${hue} is missing`).toBeTruthy();
      expect(light[hue], `light --hl-${hue} was darkened away from dark`).toBe(dark[hue]);
      expect(light[`${hue}-tint`], `light --hl-${hue}-tint drifted from dark`).toBe(dark[`${hue}-tint`]);
    }
  });

  it("and no other stylesheet re-darkens one behind the token file's back", () => {
    // The token file's light block is where the six legitimately live, and
    // the test above pins them equal. Anywhere ELSE, assigning a ramp token
    // inside a light-only block is the per-theme override this law exists to
    // stop. Reading one (var(--hl-*)) is fine and is most of what these
    // files do.
    const bad: string[] = [];
    for (const [name, css] of [["ruled.css", RULED], ["components.css", COMPONENTS_CSS]] as const) {
      const re = /\[data-theme="light"\][^{}]*\{([^}]*)\}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(css))) {
        for (const a of m[1]!.match(/--hl-[a-z-]+:\s*[^;]+/g) ?? []) bad.push(`${name}: ${a.trim()}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
