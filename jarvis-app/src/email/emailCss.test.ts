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
    // --cat-ic-* is the light twin of a TYPE ICON's colour (rule 13: the Email band's envelope is teal in light too); it is never
    // a card's ground, so it is the one cat token this file may name.
    expect(EMAIL.replace(/var\(--cat-ic-[a-z]+\)/g, "")).not.toMatch(/var\(--(cat|hl)-[a-z]+|var\(--(blue|yellow|violet|purple)[a-z-]*\)/);
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

describe("email.css: a screen's root class is scope, never geometry", () => {
  // Found 2026-10-13 rendering the real Email tab: the Compose button was given the class .email-compose, and the Compose SCREEN's
  // root already wore it (its fields and rows are scoped by it). The button's rule (width 48, height 48, a circle) sized the whole
  // screen to a 48 pixel circle, and every field on it stacked one letter to a line. A class that roots a screen is a selector for
  // what is inside it; a bare rule that gives it a box of its own is that bug coming back.
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? (n === "bench" ? [] : walk(p)) : /\.tsx$/.test(n) && !/\.test\.tsx$/.test(n) ? [p] : [];
  });
  const roots = [...new Set(walk(join(SRC, "email")).flatMap((f) => [...readFileSync(f, "utf8").matchAll(/className="screen\b([^"]*)"/g)].flatMap((m) => m[1]!.split(/\s+/).filter((c) => c.startsWith("email-")))))];
  it("finds the screens' own classes (the check below is not looking at nothing)", () => {
    expect(roots).toContain("email-compose");
  });
  it("no bare rule on one of them sets its width, height, radius or display", () => {
    const bad = roots.flatMap((c) => RULES.filter((r) => r.sel === `.${c}` && /(^|;)\s*(width|height|border-radius|display|flex)\s*:/.test(r.body)).map((r) => `${r.sel} { ${r.body.trim()} }`));
    expect(bad).toEqual([]);
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

describe("the connection banner is amber (Banner color: Dave ruled AMBER, 2026-10-12)", () => {
  // "Banner color: Dave ruled AMBER" (2026-10-12). A lost or stalled mailbox is recoverable (spec 2.8: waiting and recoverable
  // failures use amber; red is for late or destructive), so the banner and its strip wear the system amber fill with the
  // dark on-fill ink, in both themes, through tokens only.
  const ALL = rules(ALL_SHEETS);
  const body = (sel: string) => ALL.filter((r) => r.sel === sel).map((r) => r.body).join(";");
  for (const sel of [".conn-banner", ".conn-strip"]) {
    it(`${sel} is the amber fill with dark words, never the red`, () => {
      expect(body(sel)).toMatch(/background:\s*var\(--warn-fill\)/);
      expect(body(sel)).toMatch(/color:\s*var\(--on-fill-dark\)/);
      expect(body(sel)).not.toMatch(/--red|--sys-red|#fff\b/i);
    });
  }
  it("its buttons are drawn in the banner's own two tokens, never white on red", () => {
    for (const sel of [".conn-banner-act", ".conn-banner-act.primary", ".conn-strip-act"]) expect(body(sel)).not.toMatch(/--red|#fff\b/i);
    expect(body(".conn-banner-act.primary")).toMatch(/background:\s*var\(--on-fill-dark\)/);
  });
});

// THE ROW'S TEXT ENDS INSIDE THE CARD, AND STARTS AT THE CARD'S EDGE (Dave 2026-10-17, from two inbox screenshots:
// "Re: [davefisher813/bridge-app] Remove f" cut at the screen edge, and the avatar "way way too indented"). Both were
// the swipe shell's doing. MailSwipe wraps each row in .task-row.swipe-shell; .task-row is display: flex, so the
// shell was a flex container and sized the .row it carried to that row's own text (1078px in a 348px shell), past
// every ellipsis; and ruled.css's `.ruled .task-row` re-stated the padding the shell's own rule zeroed, at the same
// specificity and later, so the row paid 20px twice. The sheet reads here are the whole chain.
describe("mail-rows.css and the swipe shell: a row's text ends inside the card", () => {
  const ROWS = strip(read("styles/mail-rows.css"));
  const COMP = strip(read("styles/components.css"));
  const bodyOf = (css: string, sel: string) => rules(css).filter((r) => r.sel === sel).map((r) => r.body).join(";");

  it(".ms is the shrinkable column, and the subject and first words ellipsize on one line", () => {
    expect(bodyOf(ROWS, ".ms")).toMatch(/flex:\s*1/);
    expect(bodyOf(ROWS, ".ms"), "without min-width: 0 a flex child never shrinks under its text").toMatch(/min-width:\s*0/);
    for (const sel of [".msubj", ".msnip"]) {
      const b = bodyOf(ROWS, sel);
      expect(b, sel).toMatch(/white-space:\s*nowrap/);
      expect(b, sel).toMatch(/overflow:\s*hidden/);
      expect(b, sel).toMatch(/text-overflow:\s*ellipsis/);
    }
  });

  it("the swipe shell is a block with no padding, inside a ruled card too", () => {
    const shell = rules(COMP).filter((r) => r.sel.split(",").map((s) => s.trim()).includes(".ruled .task-row.swipe-shell"));
    expect(shell, "the .ruled twin is what beats ruled.css's `.ruled .task-row` padding").toHaveLength(1);
    expect(shell[0]!.body, "a flex shell sizes the row to its text").toMatch(/display:\s*block/);
    expect(shell[0]!.body).toMatch(/padding:\s*0/);
    expect(shell[0]!.body).toMatch(/min-height:\s*0/);
  });

  it("the row's own padding is the section head's inset, and no mail row rule adds a horizontal padding of its own", () => {
    const DS = strip(read("styles/jarvis-design-system.css"));
    expect(DS, "the row's inset is --s-4").toMatch(/\.row,[^{]*\{[^}]*padding:\s*var\(--s-3h\)\s+var\(--s-4\)/);
    expect(bodyOf(COMP, ".sh2"), "the head's inset is --s-4").toMatch(/padding:\s*var\(--s-4h, 18px\)\s+var\(--s-4\)\s+var\(--s-1h\)/);
    for (const r of rules(ROWS)) {
      if (!/\.(mrow|erow)\b/.test(r.sel)) continue;
      expect(r.body, r.sel + " sets its own horizontal padding").not.toMatch(/padding-left|padding-inline|padding:\s*[^;]+\s[^;]+;/);
    }
  });
});
