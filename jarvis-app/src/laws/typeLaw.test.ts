import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { posix } from "node:path";

// ---------------------------------------------------------------------------
// THE TYPE LAW (Dave, 2026-09-18, approved from the Type Law artifact).
//
// "The main issue I'm seeing is with font, borders and spacing, hierarchy...
// the font's the big big one because there's so much of it and for whatever
// reason you just can't get it right with what I'm asking for. What I noticed
// is it looks much much better when the main font is bolded... let's just get
// this done once and for all because I'm exhausted."
//
// HE HAD ASKED FOR THIS BEFORE. On 2026-09-16 a pass bolded the row title and
// a law was written for it. It came back anyway, because the law pinned ONE
// class (.conn-name) and the app draws a name twelve different ways. The audit
// behind this file found six treatments in four weights, and every page he had
// photographed was a 500 while the one page he approved was a 700.
//
// So the fix is not twelve edits -- those have been made before and drifted
// back apart. It is one named treatment that every rule references and none
// restates. This file is what stops the restating.
// ---------------------------------------------------------------------------

const { join } = posix;
const SRC = join(process.cwd().replace(/\\/g, "/"), "src");
const read = (f: string) => readFileSync(join(SRC, f), "utf8");
const STYLES = readdirSync(join(SRC, "styles")).filter((f) => f.endsWith(".css"));
const ALL = STYLES.map((f) => ({ file: f, css: read(join("styles", f)) }));
const DS = read("styles/jarvis-design-system.css");

/** Resolve a weight token through however many hops of var() it takes. */
const weight = (name: string): number => {
  const v = new RegExp(`--${name}:\\s*([^;]+);`).exec(DS)?.[1]?.trim() ?? "";
  const ref = /^var\(--([a-z-]+)\)$/.exec(v);
  if (ref) return weight(ref[1]!);
  return Number(/^\d+$/.exec(v)?.[0] ?? "0");
};

/** Every rule body in every stylesheet, with the selector that owns it. */
function rules(): { file: string; sel: string; body: string }[] {
  const out: { file: string; sel: string; body: string }[] = [];
  for (const { file, css } of ALL) {
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = (m[1] ?? "").trim().replace(/\s+/g, " ");
      if (!sel || sel.startsWith("@")) continue;
      out.push({ file, sel, body: m[2] ?? "" });
    }
  }
  return out;
}

describe("THE NAME OF A THING IS ONE TREATMENT", () => {
  it("names the treatment once, in tokens", () => {
    expect(DS, "the size").toMatch(/--t-name:\s*calc\(16px \* var\(--type-scale\)\)/);
    expect(DS, "the weight").toMatch(/--w-name:\s*var\(--w-semi\)/);
    expect(DS, "the tracking").toMatch(/--track-name:\s*-0\.01em/);
    // 700 is not a new number: it is the weight of the page Dave approved.
    expect(weight("w-name"), "and the weight resolves to the approved 700").toBe(700);
  });

  // THE ROSTER. Every class in the app that draws the name of the thing its
  // row, card or sheet is about. Adding a new one is a deliberate act: put it
  // here and it must use the tokens, leave it out and the last test in this
  // file catches it anyway.
  const NAMES = [
    "conn-name", "msg-name", "task-title", "rem-card-title",
    "sched-title", "msg-from", "ex-name", "dup-name", "ins-t",
    "h-door-k", "cr-name",
  ];

  // THE ONE DEMOTION, ARGUED RATHER THAN SLIPPED IN. Settings renders every
  // row through one shared Row component, so a SUB-detail under a setting --
  // "Tokens Today" beneath AI Control -- arrives wearing .conn-name even
  // though it is not the name of anything. .set-sub is the marker that says
  // so, and it is the only place in the app allowed to make a name smaller.
  //
  // It is listed here, one line, with its reason, precisely so the next one
  // cannot be added quietly: an exception you have to type into the law is an
  // exception somebody has to defend.
  const DEMOTIONS = [".ruled .set-card > .set-sub .conn-name"];

  it("draws every name through those tokens and no other numbers", () => {
    const offenders: string[] = [];
    for (const { file, sel, body } of rules()) {
      // Only rules whose SUBJECT is a name -- the last class in the selector.
      const subject = /\.([a-z0-9-]+)(?:\s*,|\s*$|:[a-z-]+$)/i.exec(sel.split(",")[0]!.trim().split(/\s+/).pop() ?? "")?.[1];
      if (!subject || !NAMES.includes(subject)) continue;
      if (DEMOTIONS.includes(sel)) continue;
      if (/font-weight:/.test(body) && !/font-weight:\s*var\(--w-name\)/.test(body)) {
        offenders.push(`${file}: ${sel} sets its own font-weight`);
      }
      if (/font-size:/.test(body) && !/font-size:\s*var\(--t-name\)/.test(body)) {
        offenders.push(`${file}: ${sel} sets its own font-size`);
      }
    }
    expect(offenders, "a name that states its own numbers is how the twelve drifted apart").toEqual([]);
  });

  // A STATE IS INK, NEVER WEIGHT. Four rules were dimming a name by taking
  // weight OFF it -- a folded thread, a locked event, a spent "last" row, a
  // warm-up set. That is the same drift wearing a different hat: it makes one
  // name lighter than the name above it, which is exactly the flatness Dave
  // kept photographing. A state says itself in colour.
  it("never dims a name by taking weight off it", () => {
    const lighter = ["w-medium", "w-regular", "w-normal"];
    const offenders: string[] = [];
    for (const { file, sel, body } of rules()) {
      if (!NAMES.some((n) => sel.includes("." + n))) continue;
      const w = /font-weight:\s*var\(--([a-z-]+)\)/.exec(body)?.[1];
      if (w && lighter.includes(w)) offenders.push(`${file}: ${sel} → --${w}`);
      if (/font-weight:\s*\d+/.test(body)) offenders.push(`${file}: ${sel} → a raw weight`);
    }
    expect(offenders, "state belongs in the ink, not the weight").toEqual([]);
  });

  // AND IT STAYS HEAVIER THAN THE LINE UNDER IT. The whole point: the ladder,
  // not the number. .conn-meta is the subtext's own token weight.
  it("keeps the name above its own subtext", () => {
    const metaW = weight(/\.conn-meta \{[^{}]*font-weight:\s*var\(--([a-z-]+)\)/.exec(DS)?.[1] ?? "");
    expect(metaW, "the subtext states a weight").toBeGreaterThan(0);
    expect(weight("w-name"), "and the name outweighs it").toBeGreaterThan(metaW);
  });
});

// ---------------------------------------------------------------------------
// THE LINE UNDER IT (the same approval: "I would like for it to be minimal,
// but if we are going to use it let's figure out how we're going to use it and
// reestablish those rules").
//
// The same audit found about thirty rules drawing "the quiet line" at SEVEN
// sizes -- 12, 12.5, 13, 13.5, 14, 14.5, 15 -- in the same grey. Six of those
// are indistinguishable at arm's length on a phone. Nobody chose them; they
// accumulated one screen at a time and no two screens agreed.
// ---------------------------------------------------------------------------
describe("THE LINE UNDER A NAME IS ONE TREATMENT", () => {
  it("names it once, in tokens", () => {
    expect(DS, "the size").toMatch(/--t-sub:\s*calc\(14px \* var\(--type-scale\)\)/);
    expect(DS, "the weight").toMatch(/--w-sub:\s*var\(--w-normal\)/);
    expect(weight("w-sub"), "and it resolves to 400").toBe(400);
  });

  // The roster of classes whose job is the quiet line under a name. Same
  // contract as the names: reference the tokens, state no numbers.
  const SUBS = [
    "conn-meta", "facts", "bp-sub", "empty-sub", "row-value",
    "r-goal", "note-first", "area-fact", "h-hero-s", "rdy-why", "msg-gist",
  ];

  // THE HOLE THIS LAW HAD, found by Dave in a screenshot hours after it was
  // written. The check below reads the LAST CLASS in a selector, so
  // `.fact.cat` resolved to "cat", was not on the roster, and sailed past --
  // and six of the commonest facts in the app sat at 700 while the line they
  // live on is 400 and the name above it is 700. The area on a reminder read
  // as loud as the reminder's own name.
  //
  // A modifier on a subtext class is still that subtext class. .fact.st is
  // the one exception and it is written out: an 11px uppercase status tag is
  // a badge, a different object from the words beside it, the way an urgency
  // chip is.
  it("lets no modifier smuggle a weight back onto a fact", () => {
    const offenders: string[] = [];
    for (const { file, sel, body } of rules()) {
      if (!/(^|[\s,>])\.facts?\./.test(sel)) continue;
      if (/\.fact\.st\b/.test(sel)) continue;
      const w = /font-weight:\s*(var\(--([a-z-]+)\)|\d+)/.exec(body);
      if (!w) continue;
      const n = w[2] ? weight(w[2]) : Number(w[1]);
      if (n > weight("w-sub")) offenders.push(`${file}: ${sel} → ${n}`);
    }
    expect(offenders, "colour is the signal on a fact; weight is the ladder").toEqual([]);
  });

  it("draws every one of them through those tokens", () => {
    const offenders: string[] = [];
    for (const { file, sel, body } of rules()) {
      const subject = /\.([a-z0-9-]+)$/i.exec(sel.split(",")[0]!.trim().split(/\s+/).pop() ?? "")?.[1];
      if (!subject || !SUBS.includes(subject)) continue;
      if (/font-size:/.test(body) && !/font-size:\s*var\(--t-sub\)/.test(body)) {
        offenders.push(`${file}: ${sel} sets its own font-size`);
      }
      if (/font-weight:/.test(body) && !/font-weight:\s*var\(--w-sub\)/.test(body)) {
        offenders.push(`${file}: ${sel} sets its own font-weight`);
      }
    }
    expect(offenders, "seven sizes of the same grey is how this got here").toEqual([]);
  });

  // AND IT NEVER INHERITS. .facts carried a size and a colour but no weight
  // for its whole life, so it took whatever the name above it was set to --
  // which meant bolding every name would have bolded every subtext with it
  // and produced no hierarchy at all. Caught in a render on 2026-09-18.
  it("states a weight rather than inheriting one from the name above it", () => {
    // There is more than one `.facts` rule (a later one only sets wrapping),
    // so this reads every rule whose subject is .facts rather than the first.
    const facts = rules().filter((r) => r.sel === ".facts").map((r) => r.body).join(" ");
    expect(facts, "the second line names its own weight").toMatch(/font-weight:\s*var\(--w-sub\)/);
    expect(weight("w-name"), "and it sits below the name").toBeGreaterThan(weight("w-sub"));
  });

  // THE INK IS NOT THE LEVER. --tx-3 is the only grey that clears the
  // contrast floor browserWalk measures, so hierarchy is carried by weight
  // and size. A future pass that "quietens" the subtext by fading it further
  // is making it unreadable, not quieter.
  it("keeps the quiet line at the one legible grey", () => {
    const offenders: string[] = [];
    for (const { file, sel, body } of rules()) {
      const subject = /\.([a-z0-9-]+)$/i.exec(sel.split(",")[0]!.trim().split(/\s+/).pop() ?? "")?.[1];
      if (!subject || !SUBS.includes(subject)) continue;
      const c = /(?:^|;)\s*color:\s*var\(--([a-z0-9-]+)\)/.exec(body)?.[1];
      if (c && c !== "tx-3") offenders.push(`${file}: ${sel} → --${c}`);
    }
    expect(offenders, "a fainter grey is unreadable, not quieter").toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A FACT IS DATA THE RECORD HOLDS. NEVER A MANUAL.
//
// Dave has asked for this in four separate screenshots, in these words:
//   "Purge the instructional grey subtext"        (2026-09-16)
//   "this is not a manual, we don't need instructions everywhere" (09-16)
//   "too much grey text... I'm sick of repeating myself"          (09-17)
//   "Instructional subtext. It shouldn't be anywhere"             (09-18)
//
// It kept coming back because each pass deleted the sentences he had
// photographed and nothing stopped the next one being written. This is the
// test that says no.
//
// THE DISTINGUISHING QUESTION, and it is a sharp one: would the line still be
// true on an empty database? A date, a count, an area, a status all change
// with the record; "A reply reaches a list, not a person" does not, because
// it is describing the app rather than the thing on screen.
//
// EMPTY STATES ARE EXEMPT, deliberately. .empty-sub is the one component
// whose whole job is to say what would be here -- deleting its copy leaves a
// blank screen, which is worse than a sentence. The rule is about the line
// under a NAME, which is every line he has ever photographed.
// ---------------------------------------------------------------------------
describe("THE SECOND LINE IS NEVER A MANUAL", () => {
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else if (/\.tsx$/.test(n) && !/\.test\./.test(n)) out.push(p);
    }
    return out;
  };

  // The shapes a sentence uses to explain a mechanism. A fact needs none of
  // them: "Today", "6 Lifts", "Sep 12", "On Hold", "3 sessions".
  //
  // "only when" and "each morning" joined on 2026-09-20, off the one manual
  // the sweep found: the weather offer's "One line each morning, only when it
  // matters". A cadence and a condition are how a feature describes ITSELF; a
  // record has a date, not a habit.
  const EXPLAINING = /\b(so no|because|which means|when you|if you|are what it takes|it takes|will still|would be|rather than|instead of|in order to|make sure|so that|nothing has to|goes? nowhere|stays? on this|only when|each (morning|day|time)|every (morning|day|time))\b/i;

  // THE DOORS A SUBTEXT ARRIVES THROUGH (2026-09-20). The first version of
  // this law read literals that sat on the same line as a className, and knew
  // six class names. Swept properly, the app has 253 static subtext strings
  // and this law could see 118 of them: 99 arrive as a PROP, which it never
  // looked at, and the rest wear classes it had never been told about. The
  // one manual in the whole app was in the blind spot, as a `sub=` prop, and
  // had been shipping on Today since the offer was written.
  //
  // The content was in good shape; the COVERAGE was not, and a law that only
  // watches one door teaches everyone to use the other one.
  const SUB_CLASS = /className="[^"]*\b(conn-meta|vrow-sub|facts|fact|bp-sub|r-goal|r-cat|area-fact|rdy-why|se-kick|task-goal)\b/;
  const SUB_PROP = /\b(sub|subtitle|subLabel|why|note|hint|meta|kicker)\s*[=:]\s*["`]/;

  // Copy that is deliberately not a fact, each for a stated reason.
  const EXEMPT = [
    // The empty state's whole job is to say what WOULD be here; deleting its
    // copy leaves a blank screen. Exempt since this law was written.
    /empty-sub|empty-state|empty-title/,
    // Simulated inbox content for previews, the same class as seedNotes.ts:
    // it is a fake USER's mail, not this app talking.
    /DemoMail/,
  ];

  it("carries no explanation on any line under a name", () => {
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      const r = f.slice(SRC.length + 1);
      if (r.startsWith("bench/") || r.startsWith("testpanel/") || r.startsWith("laws/")) continue;
      if (EXEMPT.some((x) => x.test(r))) continue;
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
        if (!SUB_CLASS.test(line) && !SUB_PROP.test(line)) return;
        if (EXEMPT.some((x) => x.test(line))) return;
        for (const m of line.matchAll(/["`]([^"`{}\\]{10,})["`]/g)) {
          const lit = m[1]!;
          if (EXPLAINING.test(lit)) offenders.push(`${r}:${i + 1} :: ${lit.slice(0, 68)}`);
        }
      });
    }
    expect(offenders, "a line that explains the app is a manual, not a fact").toEqual([]);
  });

  it("watches both doors, not just the one it was written for", () => {
    // The law above is only as good as its reach, and its reach silently
    // halved once subtext started arriving as props. This pins the roster so
    // a future narrowing fails here instead of going quiet.
    expect(SUB_PROP.test('sub="something"'), "the prop route").toBe(true);
    expect(SUB_PROP.test("why: \"something\""), "the why route").toBe(true);
    expect(SUB_CLASS.test('className="conn-meta"'), "the class route").toBe(true);
    expect(SUB_CLASS.test('className="row-grow vrow-sub"'), "the verb row's sub").toBe(true);
    // And it has to still bite the line it was widened for.
    expect(EXPLAINING.test("One line each morning, only when it matters")).toBe(true);
  });
});
