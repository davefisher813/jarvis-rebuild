// LAW: THE STREAK VOCABULARY STAYS OUT OF THE SUBSTRATE, THE HUB AND THE MEMORY.
//
// feedback.test.ts (2026-08) banned runLen, bestRun, resetStreak and the
// decay and score words from the encourage module, tasks/progress.ts and the
// feedback style page, because a number that goes to zero when you miss a
// day is the shame mechanic this app refuses. The ban is scoped to the files
// where the words were found, so the words are free to appear anywhere else,
// and the Phase 0 design (PHASE0-DESIGN.md D10, 2026-10-10) found two places
// they would land next without anyone deciding: the substrate and Hub code
// that reads item rows (a streak field read there becomes a streak shown
// there), and the memory migration's history rows, where a `runLen` going
// from 12 to 1 would be recorded with both values and read back as "you
// broke your streak" by anything that opens item_why.
//
// Two halves. One: no non comment line under src/hub/, src/substrate/ or
// src/shared/saved.ts names runLen, bestRun, lastCounted, doneCount or
// resetStreak. Two: migration 0060's NOISE_KEYS array, the keys whose values
// item_change never records, contains runLen, bestRun, lastCounted and
// doneCount (the proof's step 11 patches runLen 12 to 1 and asserts neither
// value column has the key). The migration is read the way
// entityRegistry.test.ts reads an insert statement: by its text, not by a
// database. Trust-first's widening of feedback.test.ts was not taken: its
// FILES list also runs the "nothing is random" check, and substrate/ and
// hub/ use randomUUID for correlation and idempotency ids on purpose.

import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const SRC = join(__dirname, "..");
const MIG_0060 = resolve(__dirname, "../../../jarvis-core/supabase/migrations/0060_memory.sql");

const RUN_WORDS = /\b(runLen|bestRun|lastCounted|doneCount|resetStreak)\b/;
// The four the migration must refuse to record. resetStreak is a verb, not a
// stored key, so it stays in the source half only.
const NOISE_MUST_HOLD = ["runLen", "bestRun", "lastCounted", "doneCount"];

function walk(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(n) && !/\.test\./.test(n)) out.push(p);
  }
  return out;
}

const FILES = [
  ...walk(join(SRC, "hub")),
  ...walk(join(SRC, "substrate")),
  // shared/saved.ts is built in Phase 0 step 4; until then the list is the two folders.
  ...(existsSync(join(SRC, "shared/saved.ts")) ? [join(SRC, "shared/saved.ts")] : []),
];

/** Lines with comments blanked, so a comment may name the words and a line of code may not. */
function codeLines(src: string): string[] {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return noBlock.split("\n").map((l) => l.replace(/(^|[^:"'`])\/\/.*$/, "$1"));
}

describe("LAW: the streak vocabulary stays out of the substrate, the hub and the memory", () => {
  it("covers the two folders", () => {
    expect(FILES.filter((f) => f.includes("/hub/")).length).toBeGreaterThan(5);
    expect(FILES.filter((f) => f.includes("/substrate/")).length).toBeGreaterThan(20);
  });

  it("no line of code under hub/, substrate/ or shared/saved.ts names a streak word", () => {
    const bad: string[] = [];
    for (const f of FILES) {
      const r = relative(SRC, f).replace(/\\/g, "/");
      codeLines(readFileSync(f, "utf8")).forEach((l, i) => {
        if (RUN_WORDS.test(l)) bad.push(`${r}:${i + 1}: ${l.trim().slice(0, 80)}`);
      });
    }
    expect(bad, "a streak field read or written where a streak would be shown or remembered").toEqual([]);
  });

  // Skipped, with this note, until jarvis-core/supabase/migrations/0060_memory.sql
  // exists (Phase 0 step 2 writes it). The moment it lands this half runs.
  const whenMigrationExists = existsSync(MIG_0060) ? it : it.skip;
  whenMigrationExists("migration 0060's NOISE_KEYS refuses to record the four stored streak keys", () => {
    const sql = readFileSync(MIG_0060, "utf8");
    // PL/pgSQL names are case insensitive, so either spelling of the constant
    // is read: `NOISE_KEYS constant text[] := array['runLen', ...]` or
    // `noise_keys text[] := '{runLen,...}'`.
    const m = /noise_keys\s+(?:constant\s+)?text\s*\[\]\s*(?::=|default|=)\s*(array\s*\[[^\]]*\]|'\{[^}]*\}')/i.exec(sql);
    expect(m, "0060 must declare a NOISE_KEYS text[] constant at the top of jarvis_item_memory's body").not.toBeNull();
    const list = m![1]!;
    const keys = list.startsWith("'")
      ? list.slice(2, -2).split(",").map((k) => k.trim().replace(/^"|"$/g, ""))
      : [...list.matchAll(/'([^']*)'/g)].map((k) => k[1]!);
    const missing = NOISE_MUST_HOLD.filter((k) => !keys.includes(k));
    expect(missing, "a streak key whose values the history would record").toEqual([]);
  });
});
