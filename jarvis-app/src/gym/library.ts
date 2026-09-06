import type { Exercise, MeasureKind, Program, SetEntry, Workout } from "./types";
import { entryFrom } from "./strip";

// THE EXERCISE LIBRARY (catalog §3.5). Every exercise name ever used, offered
// as autocomplete the moment you start typing. Picking a suggestion binds the
// picked entry's own `exerciseKey` and copies its EXACT name, kind, unit and
// last-used target -- that exactness is what kills "Trap Bar Deadlift" vs
// "Trap bar DL" at the source, rather than healing it after the fact (§3.6).
// Free text always still works and always mints a fresh entry.

export interface LibraryEntry {
  /** exerciseKey when the exercise that produced this entry has one; a
   *  derived name+kind fallback otherwise, so legacy exercises (pre-library)
   *  still show up and are still pickable. */
  key: string;
  exerciseKey?: string;
  name: string;
  kind: MeasureKind;
  unit?: string;
  timeUnit?: string;
  /** Most recent moment this identity was seen: a workout's startedAt, or 0
   *  for an entry that only exists inside a program (never yet logged). Used
   *  to rank suggestions by recency. */
  lastUsed: number;
  /** The most recent real target, carried forward so picking "40 Yard Dash"
   *  pre-fills as its own last numbers rather than a blank strip. */
  lastSets: SetEntry[];
}

/** UP-ATH-21 (2026-09-06): exported, so Your Lifts asks the same question
 *  this file does when it matches a row back to its sightings. Two answers to
 *  "which lift is this" would be two libraries. */
export function fallbackKey(name: string, kind: MeasureKind): string {
  return name.trim().toLowerCase() + "\u0000" + kind;
}

function record(
  map: Map<string, LibraryEntry>,
  e: { exerciseKey?: string; name: string; kind: MeasureKind; unit?: string; timeUnit?: string },
  seenAt: number,
  sets: SetEntry[],
): void {
  const name = e.name.trim();
  if (!name) return;
  const key = e.exerciseKey ?? fallbackKey(name, e.kind);
  const existing = map.get(key);
  if (!existing || seenAt >= existing.lastUsed) {
    map.set(key, {
      key,
      exerciseKey: e.exerciseKey,
      name,
      kind: e.kind,
      unit: e.unit,
      timeUnit: e.timeUnit,
      lastUsed: seenAt,
      // entryFrom picks only the numbers: a logged sighting's moved marks
      // and D7 stamps belong to the sets that happened, never to the plan
      // chips a picked suggestion prefills (same rule as same-as-last-time).
      lastSets: sets.length ? sets.map(entryFrom) : (existing?.lastSets ?? []),
    });
  } else if (!existing.lastSets.length && sets.length) {
    existing.lastSets = sets.map(entryFrom);
  }
}

/** Build the library from every program (including archived -- an archived
 *  program's lifts are still real history) and every finished workout. Later
 *  (more recent) sightings win the displayed name/kind/unit, so a rename that
 *  goes through the edit sheet updates what the library offers everyone else
 *  who reaches this exercise by its stable key. */
export function buildLibrary(programs: Program[], workouts: Workout[]): LibraryEntry[] {
  const map = new Map<string, LibraryEntry>();
  for (const p of programs) {
    for (const w of p.data.weeks) {
      for (const d of w.days) {
        for (const e of d.exercises) record(map, e, 0, e.sets);
      }
    }
  }
  // Workouts second and sorted oldest-first, so the newest logged sighting of
  // an exercise (its most recent real numbers) is what survives.
  const sorted = [...workouts].sort((a, b) => a.data.startedAt - b.data.startedAt);
  for (const w of sorted) {
    for (const e of w.data.exercises) {
      const logged = e.sets.filter((s) => !s.skipped);
      record(map, e, w.data.startedAt, logged);
    }
  }
  return [...map.values()].sort((a, b) => b.lastUsed - a.lastUsed || a.name.localeCompare(b.name));
}

/** Case-insensitive substring match on the typed text, most recent first.
 *  Empty query returns the most recently used entries -- useful for "recent"
 *  pickers (Swap, Add Mid-Session) that open with nothing typed yet.
 *
 *  UP-ATH-21 (2026-09-06): a lift the athlete hid on Your Lifts is not
 *  offered. HIDE, NEVER DELETE: its history is untouched and its row is still
 *  on that page, it just stops crowding the list of things you might do next.
 *  Hiding is read from GymSettings by the caller and passed in, so this file
 *  stays a pure derivation with no store of its own. */
export function searchLibrary(library: LibraryEntry[], query: string, limit = 8, hiddenKeys: string[] = []): LibraryEntry[] {
  const hidden = new Set(hiddenKeys);
  const visible = hidden.size ? library.filter((e) => !hidden.has(e.key)) : library;
  const q = query.trim().toLowerCase();
  const hits = q ? visible.filter((e) => e.name.toLowerCase().includes(q)) : visible;
  return hits.slice(0, limit);
}

/** Same search, restricted to one measure kind -- the Swap picker only ever
 *  offers a substitute that logs the same way as what it replaces. */
export function searchLibraryByKind(library: LibraryEntry[], query: string, kind: MeasureKind, limit = 8, hiddenKeys: string[] = []): LibraryEntry[] {
  return searchLibrary(library.filter((e) => e.kind === kind), query, limit, hiddenKeys);
}

let seq = 0;
/** A fresh, opaque identity for a brand-new exercise -- never derived from
 *  the name, so a later rename can never fork its own history. */
export function newExerciseKey(): string {
  return `ek${Date.now().toString(36)}${seq++}`;
}

// GYM-F-28 (2026-09-05): draftFromLibrary had no caller. LibraryPickSheet
// hands the picked entry back and ExerciseSheet builds the draft from it,
// because the sheet is the only place that knows which sets were typed.
