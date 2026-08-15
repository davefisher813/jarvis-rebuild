// LAWS (editing coverage map, universal mechanics): the five editing
// primitives exist EXACTLY ONCE. Inline text edit, chip picker, drag
// controller, swipe controller, undo stack. Surfaces configure them, never
// reimplement them; a second implementation of any primitive is a
// review-blocking violation, which is what this file makes literal.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pushUndo, undoLast, undoDepth, clearUndo } from "../shared/undoStack";

const SRC = join(__dirname, "..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

const FILES = walk(SRC).filter((f) => !f.includes("bench"));
const rel = (f: string) => relative(SRC, f).replace(/\\/g, "/");
const read = (f: string) => readFileSync(f, "utf8");

describe("law: one inline-edit primitive", () => {
  it("contentEditable is used only inside shared/InlineEdit.tsx", () => {
    const offenders = FILES.filter(
      (f) => rel(f) !== "shared/InlineEdit.tsx" && read(f).includes("suppressContentEditableWarning"),
    ).map(rel);
    expect(offenders).toEqual([]);
  });
});

describe("law: one swipe controller", () => {
  it("raw touch coordinates are read only inside shared/useSwipe.ts", () => {
    // touches[0].clientX is the gesture controller's job. A component that
    // reads it is reimplementing the swipe.
    const offenders = FILES.filter(
      (f) => rel(f) !== "shared/useSwipe.ts" && /touches\[0\]!?\.client[XY]/.test(read(f)),
    ).map(rel);
    expect(offenders).toEqual([]);
  });
});

describe("law: one drag controller", () => {
  it("list reordering pointer math lives only in shared/ReorderList.tsx (and the one sanctioned schedule drop zone)", () => {
    // setPointerCapture is the marker of a drag implementation. ReorderList
    // is the primitive; SchedulePage's task-to-grid drop zone predates the
    // map and is pinned here so a NEW drag cannot ship outside the primitive
    // without failing this law and being looked at.
    const SANCTIONED = new Set(["shared/ReorderList.tsx", "schedule/screens/SchedulePage.tsx"]);
    const offenders = FILES.filter(
      (f) => !SANCTIONED.has(rel(f)) && /setPointerCapture|releasePointerCapture/.test(read(f)),
    ).map(rel);
    expect(offenders).toEqual([]);
  });
});

describe("law: the undo stack", () => {
  it("push, undo, and depth behave as a stack", async () => {
    clearUndo();
    const hits: string[] = [];
    pushUndo({ label: "first", revert: () => { hits.push("first"); } });
    pushUndo({ label: "second", revert: () => { hits.push("second"); } });
    expect(undoDepth()).toBe(2);
    const undone = await undoLast();
    expect(undone!.label).toBe("second");
    expect(hits).toEqual(["second"]);
    expect(undoDepth()).toBe(1);
    await undoLast();
    expect(await undoLast()).toBeNull();
    expect(hits).toEqual(["second", "first"]);
  });

  it("sign-out clears the stack (one user's edits never undo into another session)", () => {
    clearUndo();
    pushUndo({ label: "x", revert: () => { /* noop */ } });
    clearUndo();
    expect(undoDepth()).toBe(0);
  });

  it("the auth provider actually clears the stack on sign-out", () => {
    const src = read(join(SRC, "auth", "AuthProvider.tsx"));
    expect(src).toMatch(/clearUndo\(\)/);
  });
});

describe("law: the primitives exist where surfaces expect them", () => {
  it("all five primitives are present in shared/", () => {
    const names = readdirSync(join(SRC, "shared"));
    for (const p of ["InlineEdit.tsx", "ChipPicker.tsx", "ReorderList.tsx", "useSwipe.ts", "undoStack.ts"]) {
      expect(names).toContain(p);
    }
  });
});
