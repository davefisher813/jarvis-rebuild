// LAW: A BILL IS NEVER MADE A TASK (Money ledger, hard rule 1), STRUCTURALLY.
//
// guard.ts refuses a bill-shaped candidate at TasksService.createTask, so a
// call that tries comes back null at runtime. That is the second wall. This is
// the first: no source file may CALL createTask with a bill in its options at
// all, so a path that would only ever be refused is never written, and a bill
// that never reached Money never looks to the person as if it had.
//
// What is allowed is exactly what rewrites a bill task that ALREADY exists
// (legacy rows are kept, not migrated): recreateFrom (Undo of a delete, which
// writes the stored record back whole) and updateBillTask (editing one). Both
// write through the store, not through createTask, so the allow-list below
// is for them by name and is expected to stay empty of createTask calls.

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

/** Only legacy edit/undo of bill tasks that already exist may mention a bill
 *  next to createTask, and only inside these named methods. */
const ALLOWED_ENCLOSING = ["recreateFrom", "updateBillTask"];

const stripLiterals = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');

/** The balanced argument text of the call whose "(" is at `open`. */
function argsAt(src: string, open: number): string {
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === "(") depth++;
    else if (src[j] === ")") { depth--; if (depth === 0) return src.slice(open + 1, j); }
  }
  return src.slice(open + 1);
}

function enclosingMethod(src: string, at: number): string {
  const head = src.slice(0, at);
  const hits = [...head.matchAll(/^\s*(?:async\s+)?(?:private\s+|public\s+)?(\w+)\s*\([^)]*\)[^{;=]*\{\s*$/gm)];
  return hits.length ? hits[hits.length - 1]![1]! : "";
}

function billCreateTaskCalls(): string[] {
  const bad: string[] = [];
  for (const f of walk(SRC)) {
    const r = relative(SRC, f).replace(/\\/g, "/");
    if (/^(laws|bench)\//.test(r)) continue;
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/\bcreateTask\(/g)) {
      const at = m.index!;
      if (/async\s+$/.test(src.slice(Math.max(0, at - 8), at))) continue; // the definition
      const raw = argsAt(src, at + m[0].length - 1);
      if (/^\s*\w+\s*:\s*[A-Za-z]/.test(raw)) continue; // a typed declaration, not a call
      const args = stripLiterals(raw);
      if (!/bill/i.test(args)) continue;
      if (ALLOWED_ENCLOSING.includes(enclosingMethod(src, at))) continue;
      const line = src.slice(0, at).split("\n").length;
      bad.push(`${r}:${line}  createTask(${args.replace(/\s+/g, " ").trim().slice(0, 90)}`);
    }
  }
  return bad;
}

describe("LAW: no createTask call carries a bill", () => {
  it("every bill goes to the ledger (LedgerService.addBill), never through createTask", () => {
    expect(billCreateTaskCalls(), "a bill must be filed in Money, not made a task").toEqual([]);
  });

  it("the scan itself can see a violation", () => {
    const sample = 'await tasks.createTask("Pay Rent", { due: d, bill: { amount: 5 } });';
    const open = sample.indexOf("(");
    expect(/bill/i.test(stripLiterals(argsAt(sample, open)))).toBe(true);
    const clean = 'await tasks.createTask("Pay the Bill", { due: d });';
    expect(/bill/i.test(stripLiterals(argsAt(clean, clean.indexOf("("))))).toBe(false);
  });
});
