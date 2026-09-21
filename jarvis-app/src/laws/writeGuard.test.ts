// LAW: A WRITE THAT CAN FAIL HAS TO SAY SO.
//
// shared/guard.ts has said this since 2026-08-14 -- "every user-initiated
// mutation in a flow runs through attemptWrite(), so a failed write can never
// die silently" -- and nothing checked it. The states sweep of 2026-09-20
// found 39 mutations sitting outside any guard, try or catch. The worst of
// them were UNDO handlers written as `void svc.removeX().then(reload)`: the
// toast says Undo, the tap does nothing, and the app says nothing either.
//
// HOW BADLY THIS WAS MEASURED FIRST, because it is the reason the roster is
// exhaustive rather than a threshold. Four scans returned 223, 97, 140 and 39.
// The first three read a WINDOW OF LINES, so a call inside a multi-line
// attemptWrite(async () => { ... }) looked unguarded, and a file with its own
// guard helper looked unguarded too. Sampling two hits by hand is what caught
// it; both were fine. This scan marks the character ranges a guard call or a
// try block covers and asks whether the call sits inside one.
//
// Every entry below has been read. That is the bar for being on the list.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(__dirname, "..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx$/.test(n) && !/\.test\./.test(n)) out.push(p);
  }
  return out;
}

const MUT = /\b(\w+)\.(createTask|createEvent|createReminder|createNote|create|update\w*|deleteTask|deleteEvent|deleteNote|delete\w*|remove\w*|save\w*|patch|toggleDone|toggle\w*|addExdate|removeExdate|setAside|setCategories|setDue|move\w*|clearAll|purge\w*|trash\w*|untrash\w*|restore\w*|recreateFrom|editCategory|seedDefaults|add)\(/g;
const SVC = /^(svc|service|tasks|tasksSvc|schedule|scheduleSvc|sched|notes|notesSvc|money|moneySvc|goals|goalsSvc|routine|routineSvc|profile|profileSvc|categories|catsSvc|chat|chatSvc|people|peopleSvc|metricsSvc|decisionsSvc|gym|gymSvc|store|files|fileStore|strands|health|healthSvc|insights|google|g)$/;

/** Character spans covered by a guard call or a try block. */
function guardedSpans(text: string, guards: string[]): [number, number][] {
  const spans: [number, number][] = [];
  const mark = (openIdx: number, open: string, close: string) => {
    let d = 0;
    for (let j = openIdx; j < text.length; j++) {
      if (text[j] === open) d++;
      else if (text[j] === close) { d--; if (d === 0) { spans.push([openIdx, j]); return; } }
    }
  };
  for (const g of guards) {
    for (const m of text.matchAll(new RegExp("\\b" + g + "\\s*\\(", "g"))) {
      mark(m.index! + m[0].length - 1, "(", ")");
    }
  }
  for (const m of text.matchAll(/\btry\s*\{/g)) mark(m.index! + m[0].length - 1, "{", "}");
  return spans;
}

function unguarded(): string[] {
  const out: string[] = [];
  for (const f of walk(SRC)) {
    const r = relative(SRC, f).replace(/\\/g, "/");
    if (/^(bench|testpanel|laws)\//.test(r)) continue;
    const text = readFileSync(f, "utf8");
    // attemptWrite plus any local helper named *Write that takes a callback.
    const guards = ["attemptWrite", ...[...text.matchAll(/const\s+(\w*[Ww]rite\w*)\s*=\s*(?:async\s*)?\(/g)].map((m) => m[1]!)];
    const spans = guardedSpans(text, guards);
    for (const m of text.matchAll(MUT)) {
      if (!SVC.test(m[1]!)) continue;
      const i = m.index!;
      if (spans.some(([a, b]) => i > a && i < b)) continue;
      if (/\.catch\(/.test(text.slice(i, i + 400))) continue;
      const line = text.slice(0, i).split("\n").length;
      const srcLine = text.split("\n")[line - 1]!.trim();
      if (srcLine.startsWith("//") || srcLine.startsWith("*")) continue;
      out.push(`${r} · ${m[0].slice(0, -1)}`);
    }
  }
  return [...new Set(out)];
}

// Read, one by one, and correct. Nothing is here because it looked fine.
//
// MessagesFlow's tasks.createTask was on this list for one run and came off:
// it carries .catch(() => null) and says "Couldn't add it · Nothing was
// saved" on the null. The scratch script that found it used a 220-character
// lookahead for a chained .catch and the call is longer than that. The law
// reads 400 and sees it. Worth leaving written down: a scanner's window is
// itself a finding waiting to happen.
const OK: Record<string, string> = {
  "chat/ChatFlow.tsx · fileStore.remove": "best-effort blob cleanup AFTER a guarded filesSvc.remove; the record is already gone",
  "chat/ChatFlow.tsx · fileStore.removeAll": "same, after a guarded notes.deleteNote",
  "chat/ChatFlow.tsx · notes.createNote": "the precondition of fileToNote, which throws on purpose so its caller can report; the rest of the body is inside a try",
  "gym/GymFlow.tsx · svc.saveWorkout": "handed to flushPending, whose drain() wraps every save in its own try and leaves a failure queued; an offline queue that threw would empty itself",
  "gym/GymFlow.tsx · svc.updateProgram": "passed as a callback INTO moveDayBetweenPrograms, which returns an outcome the caller reads; the guard belongs to the result, not the reference",
};

describe("LAW: a write that can fail says so", () => {
  it("finds mutations at all", () => {
    // If the scan goes blind every expectation below passes for free.
    expect(MUT.source.length).toBeGreaterThan(100);
    expect(walk(SRC).length).toBeGreaterThan(100);
  });

  it("every unguarded mutation is on the read-and-reasoned list", () => {
    expect(unguarded().sort(), "a write with no failure path; guard it or read it and add it here")
      .toEqual(Object.keys(OK).sort());
  });
});
