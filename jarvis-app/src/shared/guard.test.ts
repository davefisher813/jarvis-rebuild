// Forced-failure tests for the write-failure guard (corrections pack
// 2026-08-14, item 3). The primitive is tested directly, and a source-level
// law asserts every mutation in the covered flows actually runs through it,
// so a new unguarded write fails CI instead of failing silently on device.

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { attemptWrite, WRITE_FAILED_MESSAGE } from "./guard";
import { subscribeToast, hideToast, type ToastState } from "./toast";

let lastToast: ToastState | null = null;
subscribeToast((t) => { if (t) lastToast = t; });

beforeEach(() => { lastToast = null; hideToast(); });

describe("attemptWrite: the write-failure primitive", () => {
  it("renders the standard failure toast and resolves false when the write throws", async () => {
    const ok = await attemptWrite(async () => { throw new Error("network down"); });
    expect(ok).toBe(false);
    expect(lastToast?.message).toBe(WRITE_FAILED_MESSAGE);
  });

  it("resolves true and shows nothing when the write succeeds", async () => {
    const ok = await attemptWrite(async () => "saved");
    expect(ok).toBe(true);
    expect(lastToast).toBeNull();
  });

  it("never throws, even for non-Error rejections", async () => {
    const ok = await attemptWrite(() => Promise.reject("boom"));
    expect(ok).toBe(false);
    expect(lastToast?.message).toBe(WRITE_FAILED_MESSAGE);
  });
});

// ---------------------------------------------------------------------------
// LAW: in the covered flows, every service mutation call sits inside an
// attemptWrite() (or, for the silent set-aside sweep, its own error-receipt
// try/catch). The check is a paren-aware scan of the real sources: each
// mutating call must appear within the argument span of an attemptWrite call
// or inside a try block. Read-only calls are not restricted.
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const FLOWS = [
  "../today/TodayFlow.tsx",
  "../tasks/TasksFlow.tsx",
  "../schedule/ScheduleFlow.tsx",
  "../notes/NotesFlow.tsx",
];

const MUTATOR = /await\s+(?:svc|tasks|schedule|tasksSvc)\s*\.\s*(create|edit|set|delete|toggle|add|move|restore|apply|push|remove|insert|tasksFromChecklist|reconcile)\w*\s*\(/g;
// Reads and reconciliations that merely refresh local state.
const READONLY = new Set(["reconcileChecklistTasks"]);

// Spans of text covered by an attemptWrite(...) call or a try { ... } block.
function coveredSpans(src: string): [number, number][] {
  const spans: [number, number][] = [];
  const openParen = (from: number): number => {
    // walk forward to the matching close paren of the call starting at from
    let depth = 0;
    for (let i = from; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") { depth--; if (depth === 0) return i; }
    }
    return src.length;
  };
  const openBrace = (from: number): number => {
    let depth = 0;
    for (let i = from; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { depth--; if (depth === 0) return i; }
    }
    return src.length;
  };
  const aw = /attemptWrite\s*\(/g;
  for (let m = aw.exec(src); m; m = aw.exec(src)) {
    spans.push([m.index, openParen(m.index + m[0].length - 1)]);
  }
  const tr = /\btry\s*\{/g;
  for (let m = tr.exec(src); m; m = tr.exec(src)) {
    spans.push([m.index, openBrace(m.index + m[0].length - 1)]);
  }
  return spans;
}

describe("law: every flow mutation runs through the write-failure guard", () => {
  for (const rel of FLOWS) {
    it(`${rel.split("/").pop()} has no unguarded writes`, () => {
      const src = readFileSync(resolve(HERE, rel), "utf-8");
      const spans = coveredSpans(src);
      const misses: string[] = [];
      for (let m = MUTATOR.exec(src); m; m = MUTATOR.exec(src)) {
        const call = src.slice(m.index, src.indexOf("(", m.index));
        const name = call.split(".").pop()?.trim() ?? "";
        if (READONLY.has(name)) continue;
        const inside = spans.some(([a, b]) => m.index > a && m.index < b);
        if (!inside) {
          const line = src.slice(0, m.index).split("\n").length;
          misses.push(`line ${line}: ${src.slice(m.index, m.index + 60).split("\n")[0]}`);
        }
      }
      expect(misses, misses.join("\n")).toEqual([]);
    });
  }
});
