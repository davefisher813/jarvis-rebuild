import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// THE CATALOG, HELD ON THE SOURCE OF THE SCREENS THAT SHARE THIS CODE (Dave
// 2026-10-05: "EVERY single addition or change to the UI gets run through the
// visual catalog rules BEFORE it ships").
//
// Part A of the hard-gate audit (today, tasks, notes, bigger, notifications,
// shared, life, projects, people). Each check below is a pattern the audit found
// drifting by hand and that a scan can catch the next time, so it does not come
// back. They read source, so they only see what source can say; the DOM half is
// laws/catalogSetup.ts (a lowercase word behind a leading number) and the
// per-component tests beside each fix.
//
// 1. A toast is a line the app writes: Title Case, and the middle dot it is
//    allowed ("Couldn't Save · Try Again") is part of a SENTENCE, not a facts line.
// 2. A clock keeps ONE shape: "3:00 PM". A time and its AM/PM glued together
//    ("3:00PM", from `${t.time}${t.ap}`) is a second shape, so it is a failure.
// 3. A component never cuts a joined display string apart on a middle dot to
//    print the pieces (R6: a data builder's dotted string is a violation the
//    moment it renders into a facts line; splitting it back is the same smell).
// 4. A drawn line carries no sentence boundary (the short-copy rule, which
//    reads quoted literals only, never JSX text or template literals).

const SRC = join(__dirname, "..");
const AREA = ["today", "tasks", "notes", "bigger", "notifications", "shared", "life", "projects", "people"];
// Prompts and specs the model reads, never a screen (laws/sentenceCase.ts says the same).
const NOT_COPY = new Set([
  "notes/notesSpec.ts", "tasks/tasksSpec.ts", "notes/exportDoc.ts", "tasks/firstStep.ts", "tasks/breakdown.ts",
  "notes/aiActions.ts", "notes/jarvisFound.ts", "tasks/ifThen.ts", "notes/docModel.ts", "people/messageDraft.ts",
  "shared/duration.ts", "people/lastContact.ts", "life/syllabusExtract.ts",
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(n) && !/\.test\./.test(n)) out.push(p);
  }
  return out;
}
// Not part A's: Email on Today and the Start screen belong to the email and start workers.
const OTHER_AREA = new Set(["today/EmailToday.tsx", "today/MailNotices.tsx", "tasks/screens/StartScreen.tsx"]);
const files = AREA.flatMap((d) => walk(join(SRC, d))).map((f) => ({ rel: relative(SRC, f).replace(/\\/g, "/"), src: readFileSync(f, "utf8") }))
  .filter((f) => !NOT_COPY.has(f.rel) && !OTHER_AREA.has(f.rel));

/** Source without comments, so a note about a rule is never read as a use of it. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).split("\n").map((l) => (/^\s*\/\//.test(l) ? "" : l.replace(/\s\/\/ .*$/, ""))).join("\n");

const SMALL = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with", "per", "vs", "via", "w/"]);
/** The first word of a fragment that follows a value ("Sam Rivera" + " deleted") may start lower
 *  only if it is a small word; a mid-line word that is not small must be capitalised. */
function badWords(fragment: string): string[] {
  const words = fragment.replace(/\\u00b7/g, "·").split(/\s+/).filter(Boolean);
  return words.filter((w) => {
    const bare = w.replace(/^[^A-Za-z]+|[^A-Za-z'’]+$/g, "");
    if (!bare || !/^[a-z]/.test(bare)) return false;
    if (/^[a-z]+[A-Z]/.test(bare) || /[./@:]/.test(w) || /^\d/.test(w)) return false; // iPhone, a file name, a clock
    return !SMALL.has(bare.toLowerCase());
  });
}

/** Each showToast(...) call's message expression. */
function toastMessages(src: string): { line: number; expr: string }[] {
  const out: { line: number; expr: string }[] = [];
  for (const m of src.matchAll(/showToast\(/g)) {
    const open = m.index! + m[0].length - 1;
    let depth = 0, end = open;
    for (let j = open; j < src.length && j < open + 1500; j++) {
      if (src[j] === "(") depth++;
      else if (src[j] === ")") { depth--; if (depth === 0) { end = j; break; } }
    }
    const call = src.slice(open, end + 1);
    const mm = /message:\s*([\s\S]*?)(?=,\s*(?:actionLabel|onAction)\b|\s*\}\s*(?:,|\)))/.exec(call);
    if (mm) out.push({ line: src.slice(0, m.index).split("\n").length, expr: mm[1]! });
  }
  return out;
}

/** Literals in an expression that are NOT the input of the casing formatters. */
function literals(expr: string): string[] {
  // Drop the whole argument of lineCase( ... ), titleCase( ... ), capAfterNumber( ... ): they case it.
  let e = expr;
  for (;;) {
    const m = /(lineCase|titleCase|capAfterNumber)\(/.exec(e);
    if (!m) break;
    let depth = 0, j = m.index + m[0].length - 1;
    for (; j < e.length; j++) { if (e[j] === "(") depth++; else if (e[j] === ")") { depth--; if (depth === 0) break; } }
    e = e.slice(0, m.index) + " " + e.slice(j + 1);
  }
  const out: string[] = [];
  for (const m of e.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    const raw = m[1] ?? m[2] ?? "";
    // The operand of a comparison is a value being tested, never copy ("kind === "project"").
    if (/(?:===|!==|==|!=)\s*$/.test(e.slice(0, m.index)) || /^\s*(?:===|!==|==|!=)/.test(e.slice(m.index! + m[0].length))) continue;
    // The first argument of a call is a key, not copy (celebrationLine("project", id)).
    if (/\w\(\s*$/.test(e.slice(0, m.index)) && /^\s*,/.test(e.slice(m.index! + m[0].length))) continue;
    // A template's literal pieces, between its ${...} holes.
    for (const piece of raw.split(/\$\{[^}]*\}/)) if (piece.trim()) out.push(piece);
  }
  return out;
}

// Toasts that are Title Case in every way but one, each with its reason. A new entry needs a reason.
const TOAST_EXCEPTIONS: Record<string, string> = {
  "notes/NotesFlow.tsx · Deleted for good": "laws/undoLaw.test.ts keys its no-Undo roster by this exact message; it cannot be recased without the law moving with it (reported to the lead)",
};

describe("catalog (part A source scan): a toast is Title Case", () => {
  it("every literal in a showToast message is Title Case, or cased by lineCase", () => {
    const bad: string[] = [];
    for (const { rel, src } of files) {
      for (const { line, expr } of toastMessages(strip(src))) {
        for (const lit of literals(expr)) {
          const words = badWords(lit);
          if (words.length && !TOAST_EXCEPTIONS[rel + " · " + lit]) bad.push(`${rel}:${line} "${lit}" -> ${words.join(", ")}`);
        }
      }
    }
    expect(bad, "write the toast Title Case, or hand it to lineCase").toEqual([]);
  });

  it("the scan reads the toasts it should (it is not passing on an empty list)", () => {
    const all = files.flatMap(({ src }) => toastMessages(strip(src)));
    expect(all.length).toBeGreaterThan(150);
    // And it bites: a sentence-case toast is found.
    expect(badWords("Photo added")).toEqual(["added"]);
    expect(badWords(" moved to Contacts")).toEqual(["moved"]);
    expect(badWords("Back in Your Notes")).toEqual([]);
  });
});

describe("catalog (part A source scan): a clock keeps one shape", () => {
  it("no time is glued to its AM or PM (3:00PM)", () => {
    const bad: string[] = [];
    for (const { rel, src } of files) {
      strip(src).split("\n").forEach((l, i) => {
        // `${x.time}${x.ap}`, x.time + y.ap, "{x.time}{x.ap}" with nothing between them.
        if (/\.time\}\$\{[\w.()]*\.ap\}|\.time\s*\+\s*[\w.()]*\.ap\b|\.time\}\{[\w.()]*\.ap\}/.test(l)) bad.push(`${rel}:${i + 1} ${l.trim().slice(0, 100)}`);
      });
    }
    expect(bad, 'put a space between the time and its AM/PM: "3:00 PM"').toEqual([]);
  });
});

describe("catalog (part A source scan): no component cuts a dotted string apart", () => {
  it("nothing splits a display string on a middle dot to print the pieces", () => {
    const bad: string[] = [];
    for (const { rel, src } of files) {
      if (rel === "shared/casing.ts") continue; // the formatter itself splits to case each segment, and joins them back
      strip(src).split("\n").forEach((l, i) => {
        if (/\.split\(\s*["'`][^"'`]*(?:\\u00b7|·)[^"'`]*["'`]\s*\)/.test(l)) bad.push(`${rel}:${i + 1} ${l.trim().slice(0, 100)}`);
      });
    }
    expect(bad, "hand the facts down as separate facts; the dot is drawn by CSS").toEqual([]);
  });
});

describe("catalog (part A source scan): a drawn sub line has no sentence boundary", () => {
  it("no JSX text in a facts, meta or sub line carries '. ' then a capital", () => {
    const SUB = /className=(?:"|\{")(?:[a-z0-9-]+ )*(?:fact|facts|conn-meta|bp-sub|plan-sub|lib-sub|r-goal|task-meta|sched-cat|goal-sub)(?: [a-z0-9-]+)*(?:"|"\})[^>]*>([^<>{}\n]+)</g;
    const bad: string[] = [];
    for (const { rel, src } of files) {
      for (const m of strip(src).matchAll(SUB)) {
        if (/[a-z0-9][.?!] [A-Z]/.test(m[1]!)) bad.push(`${rel}: ${m[1]!.slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
