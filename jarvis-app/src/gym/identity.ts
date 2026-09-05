import type { MeasureKind } from "./types";

// LIFT IDENTITY (GYM-F-04, 2026-09-05, fork option A).
//
// The exercise library mints a stable `exerciseKey` once and never derives it
// from the name, precisely so that cleaning up "Trap bar DL" to "Trap Bar
// Deadlift" keeps ONE history (catalog §1.3; ExerciseSheet.tsx:214-216 says so
// in as many words). Every derivation in the gym kept its pre-library
// name+kind identity anyway, and `grep -rn exerciseKey src` found it written
// in three places and read by none. So a rename still forked all of it: the
// session header lost its Last line, every ghost lost its "Last:", the first
// set wore a "First time" PR pill, History showed two rows, the lift chart
// restarted, a lift goal on the old name never saw the new sets, and the
// plateau and insight cards lost the series.
//
// One question, asked in one place: is this workout's entry the lift I am
// deriving? The key settles it when BOTH sides carry one. Otherwise it falls
// back to the name, which is exactly what the whole gym did before the library
// existed, so every row logged before this keeps behaving as it always has.
// Kind is always part of it: scoreOf is per-kind, so a lift whose kind changed
// has numbers that cannot be compared and starts fresh, as it always did.

export interface LiftRef { name: string; kind: MeasureKind; exerciseKey?: string; unit?: string }

/** What a caller may hand a derivation in place of a bare name: a program or
 *  live exercise, a history row, a stored goal, or just the name. Callers with
 *  nothing but a name get today's behaviour, unchanged. */
export type LiftLike = string | { name: string; exerciseKey?: string; unit?: string };

export function liftRef(lift: LiftLike, kind: MeasureKind): LiftRef {
  // GYM-F-06 (2026-09-05): the ref carries the unit the caller is working in,
  // so a derivation can render its answer back in that unit after comparing
  // everything in pounds.
  return typeof lift === "string"
    ? { name: lift, kind }
    : { name: lift.name, kind, ...(lift.exerciseKey ? { exerciseKey: lift.exerciseKey } : {}), ...(lift.unit ? { unit: lift.unit } : {}) };
}

export function sameLift(a: LiftRef, b: { name: string; kind: MeasureKind; exerciseKey?: string }): boolean {
  if (a.kind !== b.kind) return false;
  if (a.exerciseKey && b.exerciseKey) return a.exerciseKey === b.exerciseKey;
  return a.name === b.name;
}

/** The kind-blind variant, for the two derivations that read an exercise
 *  across whatever kinds it has ever been logged in (doneCount, movedFact). */
export function sameLiftAnyKind(a: LiftLike, b: { name: string; exerciseKey?: string }): boolean {
  const key = typeof a === "string" ? undefined : a.exerciseKey;
  const name = typeof a === "string" ? a : a.name;
  if (key && b.exerciseKey) return key === b.exerciseKey;
  return name === b.name;
}

/** The name to show for a lift, given what the caller was handed. */
export function liftName(lift: LiftLike): string {
  return typeof lift === "string" ? lift : lift.name;
}
