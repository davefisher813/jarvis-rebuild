// LAW: NO RENDERED LINE CARRIES A SPACED HYPHEN.
//
// The copy rules have said it since the em dash law (laws.test.ts "no em
// dashes, anywhere"): the app joins two facts with a middle dot, "Saved ·
// Linked to Mike", never "Saved - Linked to Mike". The em dash law reads
// U+2014 and nothing read the ASCII " - ", so the rule held by habit. The
// Phase 0 gap matrix (2026-10-10, section 3.8) listed it as the one copy rule
// with no law behind it, and the first draft of this law, written naively as
// "a space either side of a hyphen inside a literal", went red on about
// thirty lines of template arithmetic such as `${gap - 1} quiet` and
// `${target - done} to go` (PHASE0-DESIGN.md refutation 2.2). Those are not
// rendered hyphens; the expression renders a number.
//
// So the scanner tokenizes rather than greps: comments and regex literals are
// skipped, `${...}` expressions are stripped out of template literals, and
// what is left is the text a person could read. Test fixtures are skipped
// with the test files (notificationFixtures.ts:50 carries a real invitation
// subject and is test only, on the UNWIRED list). The standing sites are
// rostered by `file · text` with the reason each is still there: they are
// Dave's decision 7 in the design (ruling pending: reword, or keep), and the
// law is green on day one so the ruling can be taken without a red suite.
// Exact both ways: a new spaced hyphen fails, and so does a rostered one that
// was reworded without leaving the list.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(__dirname, "..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(n) && !/\.test\./.test(n)) out.push(p);
  }
  return out;
}

// Test only modules (each on laws.test.ts's UNWIRED list as "test only"):
// their strings are fixtures, read by tests, rendered by nothing.
const TEST_FIXTURES = new Set(["notificationFixtures.ts", "fakeMailbox.ts", "fakeBudgetRpc.ts", "tiptapTest.ts"]);

// What a `/` can follow and still open a regex literal rather than divide.
const REGEX_BEFORE = /(^|[(,=:[!&|?{};+\-*%<>~^]|\breturn|\btypeof|\bcase|\bdo|\belse|\bin|\bof)\s*$/;

/**
 * The readable text of every string and template literal in `src`, with
 * comments and regex literals skipped and `${...}` expressions replaced by
 * `{}`. Each entry carries the line the literal opens on.
 */
function literals(src: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  let i = 0, line = 1;
  const n = src.length;
  const lineAt = (from: number, to: number) => { for (let k = from; k < to; k++) if (src[k] === "\n") line++; };
  while (i < n) {
    const c = src[i]!;
    if (c === "\n") { line++; i++; continue; }
    if (c === "/" && src[i + 1] === "/") { const e = src.indexOf("\n", i); i = e === -1 ? n : e; continue; }
    if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); const stop = e === -1 ? n : e + 2; lineAt(i, stop); i = stop; continue; }
    if (c === '"' || c === "'") {
      const open = line;
      let j = i + 1, text = "";
      for (; j < n && src[j] !== c && src[j] !== "\n"; j++) { if (src[j] === "\\") { text += src[j]! + (src[j + 1] ?? ""); j++; } else text += src[j]!; }
      out.push({ text, line: open });
      i = j + 1;
      continue;
    }
    if (c === "`") {
      const open = line;
      let j = i + 1, text = "";
      for (; j < n && src[j] !== "`"; j++) {
        if (src[j] === "\\") { text += src[j]! + (src[j + 1] ?? ""); j++; continue; }
        if (src[j] === "$" && src[j + 1] === "{") {
          let d = 0, k = j + 1;
          for (; k < n; k++) { if (src[k] === "{") d++; else if (src[k] === "}") { d--; if (d === 0) break; } }
          text += "{}";
          j = k;
          continue;
        }
        text += src[j]!;
      }
      lineAt(i, j);
      out.push({ text, line: open });
      i = j + 1;
      continue;
    }
    if (c === "/" && REGEX_BEFORE.test(src.slice(Math.max(0, i - 12), i))) {
      // A regex literal: skip to its unescaped closing slash, honouring classes.
      let j = i + 1, inClass = false;
      for (; j < n && src[j] !== "\n"; j++) {
        if (src[j] === "\\") { j++; continue; }
        if (src[j] === "[") inClass = true;
        else if (src[j] === "]") inClass = false;
        else if (src[j] === "/" && !inClass) break;
      }
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}

function spacedHyphens(): string[] {
  const out: string[] = [];
  for (const f of walk(SRC)) {
    const r = relative(SRC, f).replace(/\\/g, "/");
    if (/^(bench|testpanel|laws)\//.test(r)) continue;
    if (TEST_FIXTURES.has(r.slice(r.lastIndexOf("/") + 1))) continue;
    for (const { text } of literals(readFileSync(f, "utf8"))) {
      if (/ - /.test(text)) out.push(`${r} · ${text.slice(0, 60)}`);
    }
  }
  return [...new Set(out)];
}

// Standing sites, each read, each Dave's decision 7 (PHASE0-DESIGN.md
// section 8): reword, or rule that this one stays. Ruling pending on all.
const RULING_PENDING: Record<string, string> = {
  "messages/MessagesFlow.tsx · Too short to learn much from - save anyway?": "ruling pending: the voice sample confirm's title attribute; the reword is a middle dot or a question in two sentences",
  "schedule/calendar.ts · {} - {} {}": "ruling pending: fmtRange renders '7:00 - 8:30 PM' on every event row with an end time; '7:00 to 8:30 PM' changes every row's copy and must pass the catalog gate",
  "schedule/calendar.ts · {} {} - {} {}": "ruling pending: fmtRange across noon, '11:30 AM - 1:00 PM'; the same reword as the line above",
  "legal/html.ts · <title>JARVIS - ": "ruling pending: the generated legal pages' title; a change regenerates public/ through build:legal and is diffed by the gate",
};

describe("LAW: no rendered line carries a spaced hyphen", () => {
  it("the tokenizer reads strings and skips what is not a string", () => {
    const got = literals([
      'const a = "x - y"; // c - d',
      "const r = /a - b/; const t = `${gap - 1} quiet - ${x}`;",
      "/* e - f */ const s = 'g - h';",
    ].join("\n")).map((l) => l.text);
    expect(got).toEqual(["x - y", "{} quiet - {}", "g - h"]);
  });

  it("finds literals at all", () => {
    expect(walk(SRC).length).toBeGreaterThan(100);
    expect(literals(readFileSync(join(SRC, "schedule/calendar.ts"), "utf8")).length).toBeGreaterThan(5);
  });

  it("every spaced hyphen is rostered with its reason, and every roster entry is one", () => {
    expect(spacedHyphens().sort(), "a spaced hyphen in a rendered line; join the facts with a middle dot, or read it and roster it")
      .toEqual(Object.keys(RULING_PENDING).sort());
  });
});
