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
  return { ...e, id: newSetId() };
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
