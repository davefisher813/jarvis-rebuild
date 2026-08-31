import type { Exercise, MeasureKind, SetEntry, SetLog } from "./types";
import { fieldsFor, isUniformStrip } from "./measures";

// THE SET STRIP, the helpers (catalog §3.1). A strip is just SetEntry[]: one
// chip per set, independently editable. Everything here is plumbing for that
// one idea -- making a strip, duplicating a chip, asking whether a strip is
// uniform enough to speak as "3 x 135 lb x 8" instead of listing every chip.

let seq = 0;
export function newSetId(): string {
  return `s${Date.now().toString(36)}${seq++}`;
}

export function blankEntry(): SetEntry {
  return { id: newSetId() };
}

/**
 * THE CONVENIENCE INPUT (catalog Q6's resolution). The strip is the actual
 * storage; "sets + target" is a fast way to CREATE a uniform strip, never a
 * second persisted shape. Typing sets=3, target=135x5 once expands into
 * three identical, independently editable chips.
 */
export function uniformStrip(count: number, target: SetLog = {}): SetEntry[] {
  const n = Math.max(1, Math.round(count) || 1);
  // EMPTY IS LEGAL (Dave 2026-08-31, from a screenshot of "0 lb × 8" sets he
  // never gave a weight). The convenience input expands only the numbers
  // that are actually there: a zero in a Quick Setup stepper means "didn't
  // say", and copying it into every chip stored the exact placeholder the
  // model bans. The AI extractor and the old-shape migration route through
  // here too, so their parsed zeros stop being minted as facts as well.
  const real: SetLog = {};
  if (has(target.w)) real.w = target.w;
  if (has(target.r)) real.r = target.r;
  if (has(target.v)) real.v = target.v;
  if (has(target.t)) real.t = target.t;
  if (target.done) real.done = true;
  if (target.skipped) real.skipped = true;
  return Array.from({ length: n }, () => ({ id: newSetId(), ...real }));
}

const has = (n: number | undefined): n is number => (n ?? 0) > 0;

export function duplicateEntry(e: SetEntry): SetEntry {
  // A duplicate is a NEW event: the copy must not inherit the original's
  // log stamp (D7) or the moment it happened would be recorded twice.
  const copy: SetEntry = { ...e, id: newSetId() };
  delete copy.at;
  return copy;
}

/** TAP-TO-MATCH, D2 (Training Catalog V2, approved 2026-08-31). A fresh
 *  loggable entry carrying ONLY the numbers of `src`: no stamp, no moved
 *  mark, no skipped flag -- those belong to the set that already happened,
 *  not the one about to. Same field picking sessionExercisesSameAsLastTime
 *  uses for its plan chips. */
export function entryFrom(src: SetLog): SetEntry {
  return {
    id: newSetId(),
    ...(src.w !== undefined ? { w: src.w } : {}),
    ...(src.r !== undefined ? { r: src.r } : {}),
    ...(src.v !== undefined ? { v: src.v } : {}),
    ...(src.t !== undefined ? { t: src.t } : {}),
    ...(src.done ? { done: true } : {}),
  };
}

/** ONE EDITOR, D1 (Training Catalog V2, approved 2026-08-31). The count
 *  stepper edits the strip in place: growing duplicates the last chip's
 *  numbers (fresh ids), shrinking drops from the end, and surviving chips
 *  are never touched -- resizing must not clobber a set someone hand-edited. */
export function resizeStrip(sets: SetEntry[], count: number): SetEntry[] {
  const n = Math.max(1, Math.round(count) || 1);
  if (n <= sets.length) return sets.slice(0, n);
  const grown = [...sets];
  while (grown.length < n) {
    const last = grown[grown.length - 1];
    grown.push(last ? { ...duplicateEntry(last), skipped: false } : blankEntry());
  }
  return grown;
}

/** EDIT ALL SETS, D1. One field written across every live chip at once.
 *  Zero means "didn't say": the field comes OFF the chips rather than a
 *  zero going on (empty is legal). Skipped chips are left alone, same as
 *  bumpStrip, and a field the kind does not use is refused outright. */
export function applyToAll(kind: MeasureKind, sets: SetEntry[], key: "w" | "r" | "v" | "t", n: number): SetEntry[] {
  if (!fieldsFor(kind).some((f) => f.key === key)) return sets;
  return sets.map((s) => {
    if (s.skipped) return s;
    const next: SetEntry = { ...s };
    if (n > 0) next[key] = n;
    else delete next[key];
    return next;
  });
}

export { isUniformStrip };

/** "+X lb" or "+X reps" on every planned entry, for Duplicate Week -> bump
 *  (catalog §4.1). Only bumps fields the exercise's kind actually uses, and
 *  never touches a skipped entry -- there is nothing there to bump. */
export function bumpStrip(kind: MeasureKind, sets: SetEntry[], bump: Partial<Record<"w" | "r" | "v" | "t", number>>): SetEntry[] {
  const keys = new Set(fieldsFor(kind).map((f) => f.key));
  return sets.map((s) => {
    if (s.skipped) return s;
    const next: SetEntry = { ...s };
    for (const k of Object.keys(bump) as (keyof typeof bump)[]) {
      if (!keys.has(k) || bump[k] === undefined) continue;
      const cur = s[k] ?? 0;
      next[k] = Math.max(0, cur + bump[k]!);
    }
    return next;
  });
}

/** A fresh, empty exercise for the given kind: one blank planned set. */
export function newExercise(id: string, name: string, kind: MeasureKind, over: Partial<Exercise> = {}): Exercise {
  return { id, name, kind, sets: [blankEntry()], ...over };
}
