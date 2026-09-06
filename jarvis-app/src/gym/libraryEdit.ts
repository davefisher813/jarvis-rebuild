// UP-ATH-21 (2026-09-06): YOUR LIFTS, the page and its two writes.
//
// buildLibrary has known every exercise the athlete has ever used since the
// library shipped, and the only thing that ever rendered it was an
// autocomplete inside a picker. So there was no way to see the list, no way
// to clean up the duplicates every free-text library grows ("Trap bar DL"
// beside "Trap Bar Deadlift"), and renaming a lift meant editing it inside
// whichever program happened to hold it.
//
// GYM-F-04 made identity a real key, which is what makes both writes here
// safe: a rename moves the NAME and history follows, because history is keyed
// on the key and not on the words. A row that predates the library has no key
// (its identity is name+kind), so renaming one MINTS a key first and stamps
// it across every sighting, otherwise the rename would be the exact fork
// GYM-F-04 exists to prevent.
//
// Every function here is pure and returns PATCHES. The caller writes them
// through attemptWrite, one per workout, so a bulk rewrite that fails partway
// reports what happened instead of leaving the library half-renamed in
// silence.

import type { Exercise, MeasureKind, Program, Workout, WorkoutExercise } from "./types";
import { fallbackKey, type LibraryEntry } from "./library";

/** The identity key of one exercise or workout entry: its own library key
 *  when it has one, and the pre-library name+kind fallback otherwise. Reads
 *  buildLibrary's OWN fallbackKey rather than a second copy of the rule: two
 *  answers to "which lift is this" would be two libraries. */
export function libraryKeyOf(e: { exerciseKey?: string; name: string; kind: MeasureKind }): string {
  return e.exerciseKey ?? fallbackKey(e.name, e.kind);
}

export interface LibraryRow {
  key: string;
  exerciseKey?: string;
  name: string;
  kind: MeasureKind;
  unit?: string;
  /** Distinct finished workouts this lift was logged in. A count of what
   *  happened, never a run and never a target to fall short of. */
  sessions: number;
  /** The last day it was logged, or null for a lift that only exists in a
   *  program and has never been done. */
  lastDate: string | null;
  hidden: boolean;
}

/** Every lift the athlete has, with its count and its last day. Sorted the
 *  way the page reads: most recently trained first, then never-done lifts
 *  alphabetically, because a lift with no history has no recency to sort by
 *  and a stable order beats an arbitrary one. */
export function libraryRows(library: LibraryEntry[], workouts: Workout[], hiddenKeys: string[] = []): LibraryRow[] {
  const hidden = new Set(hiddenKeys);
  const sessions = new Map<string, number>();
  const lastDate = new Map<string, string>();
  for (const w of workouts) {
    const seen = new Set<string>();
    for (const e of w.data.exercises) {
      if (e.skipped || !e.sets.some((s) => !s.skipped)) continue;
      const key = libraryKeyOf(e);
      if (!seen.has(key)) { seen.add(key); sessions.set(key, (sessions.get(key) ?? 0) + 1); }
      const prior = lastDate.get(key);
      if (!prior || w.data.date > prior) lastDate.set(key, w.data.date);
    }
  }
  return library
    .map((e): LibraryRow => ({
      key: e.key,
      ...(e.exerciseKey ? { exerciseKey: e.exerciseKey } : {}),
      name: e.name,
      kind: e.kind,
      ...(e.unit ? { unit: e.unit } : {}),
      sessions: sessions.get(e.key) ?? 0,
      lastDate: lastDate.get(e.key) ?? null,
      hidden: hidden.has(e.key),
    }))
    .sort((a, b) => {
      if (a.lastDate && b.lastDate) return b.lastDate.localeCompare(a.lastDate) || a.name.localeCompare(b.name);
      if (a.lastDate) return -1;
      if (b.lastDate) return 1;
      return a.name.localeCompare(b.name);
    });
}

export interface LibraryPatch {
  workouts: { id: string; exercises: WorkoutExercise[] }[];
  programs: { id: string; weeks: Program["data"]["weeks"] }[];
}

function isEmpty(p: LibraryPatch): boolean {
  return p.workouts.length === 0 && p.programs.length === 0;
}

/** Rewrite every sighting of `key` with `next`. Only touched workouts and
 *  programs come back, so a library of two hundred lifts costs two writes to
 *  rename one. */
function rewrite(
  workouts: Workout[],
  programs: Program[],
  keys: Set<string>,
  next: (e: { name: string; kind: MeasureKind; exerciseKey?: string }) => { name: string; exerciseKey?: string },
): LibraryPatch {
  const out: LibraryPatch = { workouts: [], programs: [] };
  for (const w of workouts) {
    let touched = false;
    const exercises = w.data.exercises.map((e) => {
      if (!keys.has(libraryKeyOf(e))) return e;
      touched = true;
      const { name, exerciseKey } = next(e);
      return { ...e, name, ...(exerciseKey ? { exerciseKey } : {}) };
    });
    if (touched) out.workouts.push({ id: w.id, exercises });
  }
  for (const p of programs) {
    let touched = false;
    const weeks = p.data.weeks.map((wk) => ({
      ...wk,
      days: wk.days.map((d) => ({
        ...d,
        exercises: d.exercises.map((e: Exercise) => {
          if (!keys.has(libraryKeyOf(e))) return e;
          touched = true;
          const { name, exerciseKey } = next(e);
          return { ...e, name, ...(exerciseKey ? { exerciseKey } : {}) };
        }),
      })),
    }));
    if (touched) out.programs.push({ id: p.id, weeks });
  }
  return out;
}

/**
 * Rename one lift everywhere it has ever been. `mintKey` is called only when
 * the row has no key of its own: renaming a pre-library lift without stamping
 * one would change its name-based identity and fork the very history this
 * page exists to keep together.
 *
 * An empty or unchanged name is refused (an empty patch), because a lift with
 * no name is not a thing the athlete can find again.
 */
export function renameLift(
  workouts: Workout[],
  programs: Program[],
  row: Pick<LibraryRow, "key" | "name" | "exerciseKey">,
  rawName: string,
  mintKey: () => string,
): LibraryPatch {
  const name = rawName.trim();
  if (!name || name === row.name) return { workouts: [], programs: [] };
  const stamped = row.exerciseKey ?? mintKey();
  return rewrite(workouts, programs, new Set([row.key]), () => ({ name, exerciseKey: stamped }));
}

/**
 * Fold `loser` into `survivor`: every sighting of the loser takes the
 * survivor's name AND its key, so the two histories become one series that
 * every derivation in the gym already knows how to read. The survivor's own
 * rows are untouched.
 *
 * Refused when the two log differently (a merge across measure kinds would
 * put numbers that cannot be compared into one series), and when either side
 * is the other.
 */
export function mergeLifts(
  workouts: Workout[],
  programs: Program[],
  loser: Pick<LibraryRow, "key" | "kind">,
  survivor: Pick<LibraryRow, "key" | "kind" | "name" | "exerciseKey">,
  mintKey: () => string,
): LibraryPatch {
  if (loser.key === survivor.key || loser.kind !== survivor.kind) return { workouts: [], programs: [] };
  const key = survivor.exerciseKey ?? mintKey();
  // ONE pass over both keys, not two passes merged: a workout holding both
  // lifts would otherwise be rewritten twice from the same original and the
  // second answer would quietly discard the first. A survivor with no key of
  // its own is stamped in the same sweep, because a merged pair where only
  // one side carries the key still reads as two lifts.
  return rewrite(workouts, programs, new Set([loser.key, survivor.key]), () => ({ name: survivor.name, exerciseKey: key }));
}

export { isEmpty as isEmptyPatch };
