// THE EMAIL SHEET, HELD TO THE CATALOG (Dave, 2026-10-05, "I am sick of this").
// src/styles/email.css was written in one pass on 2026-10-03 and drifted from the
// catalog in ways no law read: it drew its own quiet lines at 13px and weight 500,
// it fell back to raw greys through custom properties that do not exist
// (--ink-3, --line, --warn-ink), it tinted a card green, blue, violet and yellow by
// kind, it dimmed a count with opacity, and a 32px circle was a tap target. The
// laws in src/laws read named classes (.facts, .conn-meta, .empty-sub); none of
// them read a class this sheet invented, which is how it got through. This file is
// the missing reader: it states the catalog's rules over THIS sheet, so a rule
// added next week cannot bring any of it back.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { posix } from "node:path";

const { join } = posix;
const SRC = join(process.cwd().replace(/\\/g, "/"), "src");
const read = (f: string) => readFileSync(join(SRC, f), "utf8");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const EMAIL = strip(read("styles/email.css"));
const ALL_SHEETS = readdirSync(join(SRC, "styles")).filter((f) => f.endsWith(".css")).map((f) => strip(read("styles/" + f))).join("\n");

/** Every rule body with its selector (media blocks opened). */
function rules(css: string): { sel: string; body: string }[] {
  const out: { sel: string; body: string }[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = (m[1] ?? "").trim().replace(/\s+/g, " ");
    if (!sel || sel.startsWith("@")) continue;
    out.push({ sel, body: m[2] ?? "" });
  }
  return out;
}
const RULES = rules(EMAIL);

describe("email.css: every colour is a token, and every token exists", () => {
  it("writes no raw hex or rgb colour, in a rule or as a var() fallback", () => {
    const raw = [...EMAIL.matchAll(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/g)].map((m) => m[0]);
    expect(raw, "a raw colour bypasses the key and both themes").toEqual([]);
    expect(EMAIL, "a fallback is a raw value the token file never sees").not.toMatch(/var\(--[a-z0-9-]+\s*,\s*(#|rgb)/);
  });

  it("references only custom properties some stylesheet defines", () => {
    const defined = new Set([...ALL_SHEETS.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]!));
    const used = [...EMAIL.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]!);
    const missing = [...new Set(used.filter((t) => !defined.has(t)))];
    expect(missing, "a var() of an undefined property paints its fallback or nothing: --ink-3, --line and --warn-ink drew raw greys and a brown on black").toEqual([]);
  });
});

describe("email.css: type is the ladder", () => {
  const LADDER = /^var\(--t-(sub|eyebrow|micro|body|h2|h3)\)$/;
  it("every font-size is a stop on the ladder; a quiet line is 14 (sub) or 11 (eyebrow, micro), never 13 (caption) or a raw px", () => {
    const bad: string[] = [];
    for (const { sel, body } of RULES) {
      const v = /font-size:\s*([^;]+)/.exec(body)?.[1]?.trim();
      if (!v) continue;
      if (LADDER.test(v)) continue;
      // An input's own text keeps the field size (16, so iOS does not zoom); it is the person's typing, not subtext.
      if (/^calc\(16px \* var\(--type-scale(, 1)?\)\)$/.test(v) && /xs-input/.test(sel)) continue;
      bad.push(`${sel} -> ${v}`);
    }
    expect(bad).toEqual([]);
  });

  it("every font-weight is a rung: 400 for a line, 700 for a name, 800 for a caps badge; never 500 or 600 and never a bare number", () => {
    const bad: string[] = [];
    for (const { sel, body } of RULES) {
      const v = /font-weight:\s*([^;]+)/.exec(body)?.[1]?.trim();
      if (v && !/^var\(--w-(sub|normal|semi|bold)\)$/.test(v)) bad.push(`${sel} -> ${v}`);
    }
    expect(bad, "--w-medium and --w-regular are the 500/600 the catalog killed on a quiet line").toEqual([]);
  });

  it("dims nothing with opacity: a fainter grey is unreadable, not quieter", () => {
    expect(RULES.filter((r) => /(^|;)\s*opacity:/.test(r.body)).map((r) => r.sel)).toEqual([]);
  });

  it("draws no subtext of its own: no rule here gives a note, a coverage line, a head line or a detail its own grey line", () => {
    // These were the classes that drew a thin grey line under a title in a size and weight of their own. The shared facts line,
    // the shared hint and the shared error line replace them; a rule by any of these names coming back is the drift coming back.
    const gone = ["email-meta", "email-card-title", "email-card-detail", "email-card-note", "email-field-label", "email-field-note", "email-waiting-note", "email-warn", "email-card-go"];
    for (const c of gone) expect(EMAIL, `.${c} is gone`).not.toMatch(new RegExp(`\\.${c}(?![a-z-])`));
  });
});

describe("email.css: colour is meaning, and a card has none of its own", () => {
  it("a card is not tinted or filled by its kind (green for a bill, blue for an event, violet for a task, yellow for a wait)", () => {
    const kinds = RULES.filter((r) => /\.email-card\.(bill|receipt|event|task|waiting)/.test(r.sel));
    expect(kinds.map((r) => r.sel), "colour is for meaning; an unsaved proposal means nothing in a colour, and violet is not in the key").toEqual([]);
    expect(EMAIL).not.toMatch(/var\(--(cat|hl)-[a-z]+|var\(--(blue|yellow|violet|purple)[a-z-]*\)/);
  });

  it("the outcome rail is the key: sent green, not sent red, unknown amber, sending neutral", () => {
    const rail = (cls: string) => RULES.find((r) => r.sel === `.email-outcome-${cls}`)?.body ?? "";
    expect(rail("sent")).toMatch(/--good-fill/);
    expect(rail("failed")).toMatch(/--sys-red/);
    expect(rail("unknown")).toMatch(/--warn-fill/);
    expect(rail("sending")).toMatch(/--divider/);
  });

  it("an amber or red badge wears the key's token, never the brand red", () => {
    expect(RULES.find((r) => r.sel === ".email-badge.warn")!.body).toMatch(/color:\s*var\(--warn\)/);
    expect(RULES.find((r) => r.sel === ".email-badge.red")!.body).toMatch(/color:\s*var\(--sys-red\)/);
    for (const r of RULES.filter((x) => /^\.email-badge/.test(x.sel))) expect(r.body, r.sel).not.toMatch(/--tint|--accent|--on-light-red/);
  });
});

describe("email.css: a tap target is 44", () => {
  it("the freshness button and the dismiss circle paint short and reach 44 through a hit box past the paint", () => {
    for (const cls of [".email-fresh", ".email-card-x"]) {
      const after = RULES.find((r) => r.sel === `${cls}::after`);
      expect(after, `${cls}::after`).toBeTruthy();
      expect(after!.body).toMatch(/inset:\s*-\d+px/);
      expect(RULES.find((r) => r.sel === cls)!.body).toMatch(/position:\s*relative/);
    }
  });
});

describe("email.css: every class in it is rendered somewhere (no subtext class without a call site)", () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? (n === "bench" ? [] : walk(p)) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
  const code = walk(SRC).map((f) => readFileSync(f, "utf8")).join("\n");
  it("each .email-* and .mclip class has a call site", () => {
    const classes = [...new Set([...EMAIL.matchAll(/\.((?:email|mclip)[a-z0-9-]*)/g)].map((m) => m[1]!))];
    // The outcome rail's class is built from the outcome ("email-outcome-" + outcome), so its stem is the call site.
    const dead = classes.filter((c) => !code.includes(c) && !code.includes(c.replace(/-(sent|sending|failed|unknown)$/, "-")));
    expect(dead, "dead classes are how a stale 13px grey rule survives").toEqual([]);
  });
});
