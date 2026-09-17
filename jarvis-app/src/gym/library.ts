import type { Exercise, MeasureKind, Program, SetEntry, Workout } from "./types";
import type { CreatedLift } from "./settings";
import { entryFrom } from "./strip";

// THE EXERCISE LIBRARY (catalog §3.5). Every exercise name ever used, offered
// as autocomplete the moment you start typing. Picking a suggestion binds the
// picked entry's own `exerciseKey` and copies its EXACT name, kind, unit and
// last-used target -- that exactness is what kills "Trap Bar Deadlift" vs
// "Trap bar DL" at the source, rather than healing it after the fact (§3.6).
// Free text always still works and always mints a fresh entry.

export interface LibraryEntry {
  /** Health Push E (H-23): the names this lift used to go by, so a rename
   *  never makes the old name unsearchable. Attached by withAliases from the
   *  gym settings; nothing in a workout or program carries them. */
  aliases?: string[];
  /** Part 3 wave 1 (2026-09-13): starred on Your Lifts; leads every picker. */
  favorite?: boolean;
  /** exerciseKey when the exercise that produced this entry has one; a
   *  derived name+kind fallback otherwise, so legacy exercises (pre-library)
   *  still show up and are still pickable. */
  key: string;
  exerciseKey?: string;
  name: string;
  kind: MeasureKind;
  unit?: string;
  timeUnit?: string;
  /** THE CONVENTION ON ITS MOST RECENT SIGHTING (2026-09-14). Carried so the
   *  library can show what an exercise is on a machine before anyone has
   *  classified it: the athlete has been answering the exercise sheet's
   *  Equipment row for a while, and making them answer it a second time in a
   *  new place would be the app forgetting on purpose. A stored
   *  classification always wins over this (classify.classOf). */
  equipment?: string;
  counted?: import("./equipment").Counted;
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
  e: { exerciseKey?: string; name: string; kind: MeasureKind; unit?: string; timeUnit?: string; equipment?: string; counted?: import("./equipment").Counted },
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
      ...(e.equipment ? { equipment: e.equipment } : existing?.equipment ? { equipment: existing.equipment } : {}),
      ...(e.counted ? { counted: e.counted } : existing?.counted ? { counted: existing.counted } : {}),
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

/** SEEDS FOR THE DERIVATION (Dave 2026-09-17: "I should be able to create
 *  exercises here").
 *
 *  buildLibrary reads programs and workouts, so an exercise had to be USED
 *  before it could be organized -- which is the wrong way round for a page
 *  whose job is classifying, goal-setting and merging. A created lift joins
 *  the list with lastUsed 0 and no sets, exactly like a program-only entry
 *  that has never been logged.
 *
 *  A SIGHTING ALWAYS WINS. If the derivation already knows this key, or
 *  already knows this name at this measurement, the seed is dropped rather
 *  than appended: the real entry carries history, aliases, the equipment its
 *  last session was done on, and the seed carries none of that. So using a
 *  created lift for the first time quietly promotes it instead of doubling
 *  it, and the list never shows the same exercise twice. */
export function withCreated(library: LibraryEntry[], created: CreatedLift[]): LibraryEntry[] {
  if (created.length === 0) return library;
  const seen = new Set<string>();
  for (const e of library) { seen.add(e.key); seen.add(fallbackKey(e.name, e.kind)); }
  const extra: LibraryEntry[] = [];
  for (const c of created) {
    const fb = fallbackKey(c.name, c.kind);
    if (seen.has(c.key) || seen.has(fb)) continue;
    seen.add(c.key);
    seen.add(fb);
    extra.push({
      key: c.key, exerciseKey: c.key, name: c.name, kind: c.kind,
      ...(c.unit ? { unit: c.unit } : {}),
      lastUsed: 0, lastSets: [],
    });
  }
  if (extra.length === 0) return library;
  return [...library, ...extra].sort((a, b) => b.lastUsed - a.lastUsed || a.name.localeCompare(b.name));
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
  // H-23: an old name still finds the lift.
  const hits = q ? visible.filter((e) => e.name.toLowerCase().includes(q) || (e.aliases ?? []).some((a) => a.toLowerCase().includes(q))) : visible;
  // Favorites first, then the library's own most-recent order (a stable sort
  // keeps it), so a starred lift is the first thing under the finger.
  const ranked = [...hits].sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));
  return ranked.slice(0, limit);
}

/** Part 3 wave 1: mark the starred entries by key. */
export function withFavorites(library: LibraryEntry[], keys: string[]): LibraryEntry[] {
  if (keys.length === 0) return library;
  const set = new Set(keys);
  return library.map((e) => (set.has(e.key) ? { ...e, favorite: true } : e));
}

/** H-23: hang the stored aliases on the entries they belong to, by key. */
export function withAliases(library: LibraryEntry[], aliases: Record<string, string[]>): LibraryEntry[] {
  return library.map((e) => {
    const a = aliases[e.key];
    return a && a.length ? { ...e, aliases: a } : e;
  });
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
