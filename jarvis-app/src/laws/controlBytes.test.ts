import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// NO LITERAL CONTROL BYTES IN SOURCE (2026-08-24).
//
// LearnedRulesService.ts built its pending-correction key with a raw NUL
// character. The choice of separator is right and load-bearing: a scope or a
// trigger can never contain a NUL, so "capture.category" + "Elite Squad"
// cannot collide with "capture.category Elite" + "Squad" the way it would
// with a space. What was wrong was writing it as a literal byte, which makes
// the whole file read as BINARY. grep answers "binary file matches" and
// prints nothing, diffs are useless, and review tooling hides it. Three
// separate searches of that file came back empty in one session before that
// turned out to be the explanation.
//
// The escape produces exactly the same string at runtime, so the fix costs
// nothing and invalidates nothing already stored.
//
// This lives in its own file rather than in laws.test.ts because the pattern
// it needs is itself awkward to move through tooling that refuses control
// characters, and burying it in a 1,100-line file is how it gets copied
// wrong later.

const SRC = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe("LAW: source files stay text", () => {
  it("no source file contains a literal control byte", () => {
    // Tab (09), newline (0A) and carriage return (0D) are the only ones that
    // belong in source. Built from char codes rather than written as a
    // literal class, so this file cannot itself become the thing it bans.
    const allowed = new Set([9, 10, 13]);
    const isControl = (c: number) => (c < 32 && !allowed.has(c)) || c === 127;

    const files = walk(SRC).filter((f) => /\.(ts|tsx|css)$/.test(f));
    expect(files.length, "the scan found no files, which means it is broken").toBeGreaterThan(50);

    const bad: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      let count = 0;
      let first = -1;
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (!isControl(c)) continue;
        count++;
        if (first < 0) first = c;
      }
      if (count) {
        bad.push(
          f.slice(SRC.length + 1) + ": " + count + " control byte(s), first is U+" +
          first.toString(16).padStart(4, "0").toUpperCase(),
        );
      }
    }
    expect(bad, "write it as an escape: the string is identical and grep still works").toEqual([]);
  });
});
