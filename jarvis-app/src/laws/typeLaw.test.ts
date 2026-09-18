import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
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
