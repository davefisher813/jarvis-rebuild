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

  // SHARED-F-21 (2026-09-05): the controller's first contract line says
  // "horizontal claims the gesture (page must not scroll)", and the call that
  // was supposed to enforce it (useSwipe.ts:68's preventDefault) cannot:
  // React 18 registers touchmove on the root as passive
  // (react-dom.development.js:9172-9173), so it is ignored. What actually
  // claims the gesture is `touch-action: pan-y` on the moving element. Most
  // rows had it by luck; .notice-card and the bare .swipe-shell did not, and
  // a diagonal swipe on a Today notice or a notification revealed the actions
  // AND scrolled the list at the same time.
  //
  // So the roster is explicit, the same shape the 44px law uses: a new swipe
  // surface fails this until it says which class carries its pan-y.
  it("every swipe surface's moving element carries touch-action: pan-y", () => {
    const SURFACES: Record<string, string> = {
      "tasks/screens/TasksPage.tsx": "task-row",
      "today/TodayFlow.tsx": "task-row",
      "today/NoticeCard.tsx": "notice-card",
      "notes/screens/NotesList.tsx": "task-row",
      "messages/MailSwipe.tsx": "task-row",
      "messages/LetGoSwipe.tsx": "task-row",
      "notifications/NotificationsFlow.tsx": "swipe-shell",
      "gym/SetStrip.tsx": "set-chip",
      "schedule/screens/DayRow.tsx": "sched-row",
      "schedule/screens/LockedRow.tsx": "sched-row",
    };
    const css = read(join(SRC, "styles", "components.css")) + read(join(SRC, "styles", "ruled.css"));
    const usesSwipe = FILES.filter((f) => rel(f) !== "shared/useSwipe.ts" && /from "[^"]*shared\/useSwipe"/.test(read(f))).map(rel);
    expect(usesSwipe.filter((f) => !(f in SURFACES)), "a new swipe surface must name the class that carries its pan-y").toEqual([]);
    const bare: string[] = [];
    for (const [file, cls] of Object.entries(SURFACES)) {
      if (!usesSwipe.includes(file)) continue; // the surface was retired; the roster entry is harmless
      const rule = new RegExp("\\.(?:[a-z0-9-]+\\s+)?" + cls + "\\b[^{}]*\\{[^}]*touch-action:\\s*pan-y");
      if (!rule.test(css)) bare.push(file + " (." + cls + ")");
    }
    expect(bare, "the moving element's class must say touch-action: pan-y").toEqual([]);
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

// SHARED-F-15 (2026-09-05): these three exercise the stack in isolation, and
// that is all that has ever exercised it: no app code calls pushUndo, so the
// stack is empty in production and clearUndo on sign-out clears nothing. The
// cases stay because the primitive stays (see shared/undoStack.ts's header
// for the fork), but they prove the mechanism, never that a surface reaches
// it. The Undo people actually tap is the toast's, and law "an Undo sets a
// state, it never toggles one" is what guards that one.
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
  // AMENDED 2026-09-02: the one-field picker is HeadMenu (the value that
  // opens the dropdown, ruled on the task sheet and worn by every form
  // sheet and the project page since). ChipPicker, the chip that unfolded
  // into an option row, had no caller left and is gone; the mechanics it
  // guaranteed (tap is the answer and the save, no sheet, no navigation)
  // are HeadMenu's.
  it("all six primitives are present in shared/", () => {
    const names = readdirSync(join(SRC, "shared"));
    for (const p of ["InlineEdit.tsx", "HeadMenu.tsx", "ReorderList.tsx", "useSwipe.ts", "undoStack.ts", "Stepper.tsx"]) {
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
