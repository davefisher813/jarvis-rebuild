// LAWS (editing coverage map, universal mechanics): the six editing
// primitives exist EXACTLY ONCE. Inline text edit, chip picker, drag
// controller, swipe controller, undo stack, stepper. Surfaces configure them,
// never reimplement them; a second implementation of any primitive is a
// review-blocking violation, which is what this file makes literal.
//
// Stepper was added 2026-08-23, after being found already duplicated. That is
// the pattern to watch: a primitive nobody named is a primitive nobody
// protected, and the copy is always the worse one.

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
    // PlanStrip (2026-08-20) is the third and last: dragging a block along a
    // proportional TIMELINE is not list reordering. There is no list, no
    // sibling order, and no drop index; there is one axis mapping x to a
    // minute. Forcing it through the reorder primitive would mean teaching
    // that primitive about time, which is how a primitive stops being one.
    // The conditioning face's slide-to-finish (2026-09-02) is the same
    // exception for the same reason: one knob on one axis, no list, no
    // drop index. A finish gesture is not a reorder.
    const SANCTIONED = new Set([
      "shared/ReorderList.tsx",
      "schedule/screens/SchedulePage.tsx",
      "schedule/screens/PlanStrip.tsx",
      "gym/ConditioningFace.tsx",
    ]);
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
  // Six since 2026-08-23. Stepper joined because it had already been copied:
  // gym/ExerciseSheet had the real one and gym/SessionScreen had a stripped
  // copy that dropped tap-to-type, which is the only thing that makes a
  // stepper bearable past about ten taps. Nothing caught it, because a
  // primitive that is not named here is a primitive nothing protects.
  it("all six primitives are present in shared/", () => {
    const names = readdirSync(join(SRC, "shared"));
    for (const p of ["InlineEdit.tsx", "ChipPicker.tsx", "ReorderList.tsx", "useSwipe.ts", "undoStack.ts", "Stepper.tsx"]) {
      expect(names).toContain(p);
    }
  });

  it("there is ONE stepper, and it is the shared one", () => {
    const bad: string[] = [];
    for (const f of FILES) {
      if (rel(f) === "shared/Stepper.tsx") continue;
      const src = read(f);
      // A local component named Stepper, or a hand-rolled .stepper wrapper,
      // is the copy this law exists to stop.
      if (/function\s+Stepper\s*\(/.test(src)) bad.push(rel(f) + ": declares its own Stepper");
      if (/className="stepper"/.test(src)) bad.push(rel(f) + ': hand-builds className="stepper"');
    }
    expect(bad).toEqual([]);
  });
});
