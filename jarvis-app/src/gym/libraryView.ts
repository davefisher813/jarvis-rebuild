// FINDING ONE EXERCISE IN A LIBRARY OF TWO HUNDRED.
//
// (Handoff §3: search across names and aliases, six filters, three sorts, and
// all of it still true after an edit.)
//
// The page had one control -- Show Hidden -- and a list sorted by recency.
// That is fine at fifteen exercises and unusable at a hundred and fifty,
// which is what a library looks like after a year of free-text entry. Worse,
// it made the work the rest of this handoff asks for impossible: you cannot
// classify everything that is missing a muscle if you cannot ask which ones
// those are.
//
// Pure, and separate from the page, for the reason every derivation in this
// folder is: the question "which exercises match this" is testable, and the
// answer should not depend on a component being mounted.

import { capAfterNumber } from "../shared/casing";
import { MUSCLE_GROUPS, MUSCLE_LABEL, type MuscleGroup } from "./muscles";
import { loadStyleOf, type Equipment } from "./equipment";
import { libraryRows, type LibraryRow } from "./libraryEdit";
import { classOf, EMPTY_CLASS, needsMuscles, readClassStore, starterClass, type Classification, type ClassStore, type MovementPattern } from "./classify";
import { composeLibrary, newExerciseKey, type LibraryEntry, type LibrarySeeds } from "./library";
import type { MeasureKind, Program, Workout } from "./types";
import type { CreatedLift, GymSettings } from "./settings";
import { normalizeExerciseName, STARTER_EXERCISES, type StarterExercise } from "./starterLibrary";

export type SortKey = "recent" | "name" | "most";

export const SORT_LABEL: Record<SortKey, string> = {
  recent: "Recently Trained",
  name: "Name",
  most: "Most Used",
};

export interface LibraryFilter {
  q: string;
  muscle?: MuscleGroup;
  equipment?: Equipment;
  movement?: MovementPattern;
  /** Starred only. */
  favorites?: boolean;
  /** Exercises with no primary muscle: the queue for the work §4 is about. */
  missing?: boolean;
  /** One half of a pair the duplicate finder proposed. */
  dupes?: boolean;
  /** Hidden and archived are OFF by default and are never filtered away
   *  silently -- the floor line under the list says how many are out of
   *  sight, the same contract the page has always kept (LAW L2). */
  showHidden?: boolean;
  showArchived?: boolean;
}

export const NO_FILTER: LibraryFilter = { q: "" };

/** The order the page opens in. */
export const DEFAULT_SORT: SortKey = "recent";

export function filterCount(f: LibraryFilter): number {
  return [f.muscle, f.equipment, f.movement, f.favorites || undefined, f.missing || undefined, f.dupes || undefined]
    .filter((x) => x != null).length;
}

/** Does the typed text find this exercise? Name first, then the names it used
 *  to go by -- a merge files the folded name as an alias precisely so that
 *  searching for it still lands (acceptance criterion 10). */
export function matchesQuery(row: LibraryRow, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  if (row.name.toLowerCase().includes(t)) return true;
  return (row.aliases ?? []).some((a) => a.toLowerCase().includes(t));
}

export interface ViewResult {
  rows: LibraryRow[];
  /** Rows the current filter and the hidden/archived switches took out, so
   *  the floor can say so rather than leaving a short list unexplained. */
  hiddenAway: number;
  archivedAway: number;
  filteredAway: number;
}

/**
 * The list as the page shows it. One pass: hide/archive, then the filters,
 * then the search, then the sort.
 *
 * `dupeKeys` is the set of keys the duplicate finder currently has an
 * unresolved pair for, computed once by the page and passed in, so this file
 * does not have to know how duplicates are found.
 */
export function viewRows(
  rows: LibraryRow[],
  store: ClassStore,
  filter: LibraryFilter,
  sort: SortKey,
  dupeKeys: Set<string> = new Set(),
): ViewResult {
  let hiddenAway = 0;
  let archivedAway = 0;
  let filteredAway = 0;
  const out: LibraryRow[] = [];
  for (const row of rows) {
    const c = classOf(store, row);
    if (row.hidden && !filter.showHidden) { hiddenAway++; continue; }
    if (c.archived && !filter.showArchived) { archivedAway++; continue; }
    const passes =
      (!filter.muscle || c.primary.includes(filter.muscle) || c.secondary.includes(filter.muscle))
      && (!filter.equipment || c.equipment === filter.equipment)
      && (!filter.movement || c.movement === filter.movement)
      && (!filter.favorites || !!row.favorite)
      && (!filter.missing || needsMuscles(c))
      && (!filter.dupes || dupeKeys.has(row.key))
      && matchesQuery(row, filter.q);
    if (!passes) { filteredAway++; continue; }
    out.push(row);
  }
  out.sort(comparator(sort));
  return { rows: out, hiddenAway, archivedAway, filteredAway };
}

function comparator(sort: SortKey): (a: LibraryRow, b: LibraryRow) => number {
  if (sort === "name") return (a, b) => a.name.localeCompare(b.name);
  if (sort === "most") {
    // Sessions first, then sets, so two exercises done four times each are
    // separated by which one was actually worked. A never-done exercise
    // sorts last by name rather than by an arbitrary tie.
    return (a, b) => b.sessions - a.sessions || b.sets - a.sets || a.name.localeCompare(b.name);
  }
  // Recently trained, the page's own long-standing order: a lift with no
  // history has no recency to sort by, so it goes to the bottom alphabetically
  // instead of to the top on an empty string.
  return (a, b) => {
    if (a.lastDate && b.lastDate) return b.lastDate.localeCompare(a.lastDate) || a.name.localeCompare(b.name);
    if (a.lastDate) return -1;
    if (b.lastDate) return 1;
    return a.name.localeCompare(b.name);
  };
}

/** EVERY LIST HAS A FLOOR (LAW L2), and this one has to explain four
 *  different kinds of absence without turning into a paragraph. */
export function floorLine(v: ViewResult, total: number, filter: LibraryFilter): string {
  if (total === 0) return "Nothing here yet.";
  const away = [
    v.filteredAway ? `${v.filteredAway} filtered out` : null,
    v.hiddenAway ? `${v.hiddenAway} hidden` : null,
    v.archivedAway ? `${v.archivedAway} archived` : null,
  ].filter((x): x is string => !!x);
  if (!away.length) return `That's every exercise you have, all ${total}.`;
  if (v.rows.length === 0 && filter.q.trim()) return `Nothing matches "${filter.q.trim()}".`;
  // Commas, not baked middots (§AM F3): this is a sentence under the list,
  // and each count still hands its capital to the word behind it.
  return [`${v.rows.length} of ${total} shown`, ...away].map(capAfterNumber).join(", ") + ".";
}

/** THE EXERCISES PAGE'S DEFAULT LIST, AND THE BADGE THAT COUNTS IT
 *  (2026-10-01). The Health dashboard's "N Exercises" has to be the number of
 *  rows the page lists when it opens, with nothing typed and no filter on.
 *  Archived and hidden rows are not in that list (they are behind the Archived
 *  and Hidden chips, and the floor line says how many), so they are not in the
 *  badge either: archiving an exercise took the row off the page and left the
 *  badge where it was.
 *
 *  `defaultView` is the page's own opening view; the page and the badge both
 *  call it, so they cannot drift. */
export function defaultView(rows: LibraryRow[], store: ClassStore): ViewResult {
  return viewRows(rows, store, NO_FILTER, DEFAULT_SORT);
}

/** Everything the library composes from besides programs and workouts, as
 *  GymSettings keeps it. Every field is optional; absent means none. */
export interface ShownSeeds extends LibrarySeeds {
  hiddenKeys?: string[];
  classByKey?: Record<string, unknown>;
  muscleByKey?: Record<string, string[]>;
}

/** The seeds as GymSettings stores them, named the way the library composer
 *  and the default view want them. One mapping, so a caller cannot hand the
 *  settings over under the wrong field name and silently count nothing. */
export function seedsFromSettings(s: GymSettings): ShownSeeds {
  return {
    created: s.createdLifts, aliases: s.aliases, favoriteKeys: s.favoriteKeys,
    hiddenKeys: s.hiddenKeys, classByKey: s.classByKey, muscleByKey: s.muscleByKey,
  };
}

/** The page's default list built from the raw records, start to finish: the
 *  composed library, its rows with hidden state, the classification store,
 *  and the default view over them. */
export function shownLibrary(programs: Program[], workouts: Workout[], seeds: ShownSeeds = {}): ViewResult {
  const library = composeLibrary(programs, workouts, seeds);
  const rows = libraryRows(library, workouts, seeds.hiddenKeys ?? []);
  return defaultView(rows, readClassStore(seeds.classByKey, seeds.muscleByKey));
}

/** How many exercises the Exercises page lists by default: the Health badge. */
export function shownLibraryCount(programs: Program[], workouts: Workout[], seeds: ShownSeeds = {}): number {
  return shownLibrary(programs, workouts, seeds).rows.length;
}

/** A short string that changes whenever anything the default list depends on
 *  outside programs and workouts changes: which exercises were made by hand,
 *  which are hidden, which are archived. For a memo key. */
export function shownSignature(seeds: ShownSeeds): string {
  const store = readClassStore(seeds.classByKey, seeds.muscleByKey);
  const archived = Object.entries(store).filter(([, c]) => c.archived).map(([k]) => k).sort();
  return [
    (seeds.created ?? []).map((c) => c.key).join(","),
    [...(seeds.hiddenKeys ?? [])].sort().join(","),
    archived.join(","),
    Object.keys(seeds.aliases ?? {}).length,
    (seeds.favoriteKeys ?? []).length,
  ].join("|");
}

// ---------------------------------------------------------------------------
// ONE EXERCISE SOURCE FOR EVERY PICKER (Dave 2026-10-16, Q). Add to a day,
// Add Exercise on the empty workout, Add to a past workout and Swap each
// searched the raw library their own way: one capped the list at forty, none
// filtered an exercise the athlete had ARCHIVED, so "Cable Curls" came back
// in every picker after it was put away. The picker's rows are the library's
// default view now (hidden and archived out, the same two switches the
// Exercises page opens with), with no cap (the sheet list scrolls), and the
// preloaded catalog's entries merged in under the same muscle sections (S9).
// LibraryPickSheet reads this, so every caller of the sheet gets it for free.
// ---------------------------------------------------------------------------

export interface PickerRow {
  entry: LibraryEntry;
  /** The first primary muscle, for the section it sits under; null when the
   *  athlete has not said one (and the entry is not a starter). */
  primary: MuscleGroup | null;
  /** From the preloaded catalog, not yet the athlete's own. */
  starter: boolean;
}

export interface PickerOptions {
  /** The typed search, matched on the name and every alias. */
  q?: string;
  /** Only entries that log this way (Swap: a substitute logs like what it
   *  replaces). A starter logs weight and reps, so it is offered only when
   *  that is the kind asked for, or none is. */
  kind?: MeasureKind;
  /** The catalog to merge in; the app's own by default. A test hands in a
   *  fixture; a caller that wants no catalog hands in []. */
  starters?: readonly StarterExercise[];
}

/** A starter as the picker shows it: a library entry that exists only in the
 *  picker, keyed by its normalised name so a React key is stable, logging
 *  weight and reps, never used. */
function starterEntry(s: StarterExercise): LibraryEntry {
  return {
    key: "starter:" + normalizeExerciseName(s.name), name: s.name, kind: "weight_reps", lastUsed: 0, lastSets: [],
    starter: { primary: s.primary, secondary: [...s.secondary] },
  };
}

const matchesEntry = (e: LibraryEntry, q: string) =>
  !q || e.name.toLowerCase().includes(q) || (e.aliases ?? []).some((a) => a.toLowerCase().includes(q));

/** THE CATALOG'S ENTRIES THE ATHLETE HAS NOT GOT, the one answer every list
 *  that offers a starter reads (Dave 2026-10-17): the pickers, the Exercises
 *  page's stock rows and the exercise sheet's name typeahead. Matched by
 *  normalised name against the WHOLE library and every alias in it, so an
 *  archived or hidden "Cable Curls", or a name merged away into another lift,
 *  is never offered back as a starter. In the catalog's own order. */
export function starterEntries(library: LibraryEntry[], starters: readonly StarterExercise[] = STARTER_EXERCISES): LibraryEntry[] {
  const have = new Set(library.map((e) => normalizeExerciseName(e.name)));
  for (const e of library) for (const a of e.aliases ?? []) have.add(normalizeExerciseName(a));
  return starters.filter((s) => !have.has(normalizeExerciseName(s.name))).map(starterEntry);
}

/** THE STOCK ROWS ON THE EXERCISES PAGE (Dave 2026-10-17: "It should be all
 *  exercises. Stock and custom"). The same catalog entries the pickers offer,
 *  as page rows: never trained, never hidden, carrying their muscles. Nothing
 *  is written for one by being listed; the page adopts it through the flow's
 *  one door the moment the athlete opens or changes it. */
export function stockRows(library: LibraryEntry[], starters?: readonly StarterExercise[]): LibraryRow[] {
  return libraryRows(starterEntries(library, starters), []);
}

/** The rows every picker lists: the library's default view (hidden and
 *  archived out) plus the catalog's entries the athlete has not got, matched
 *  by normalised name against the WHOLE library (an archived "Cable Curls" is
 *  not offered back as a starter either). Favorites lead, then the most
 *  recently used, then the rest by name, starters among them. No cap. */
export function pickerRows(library: LibraryEntry[], store: ClassStore, hiddenKeys: string[] = [], opts: PickerOptions = {}): PickerRow[] {
  const hidden = new Set(hiddenKeys);
  const q = (opts.q ?? "").trim().toLowerCase();
  const out: PickerRow[] = [];
  for (const e of library) {
    if (hidden.has(e.key)) continue;
    if (opts.kind && e.kind !== opts.kind) continue;
    const c = classOf(store, e, loadStyleOf(e));
    if (c.archived) continue;
    if (!matchesEntry(e, q)) continue;
    out.push({ entry: e, primary: c.primary[0] ?? null, starter: false });
  }
  if (!opts.kind || opts.kind === "weight_reps") {
    for (const entry of starterEntries(library, opts.starters)) {
      if (!matchesEntry(entry, q)) continue;
      out.push({ entry, primary: entry.starter!.primary, starter: true });
    }
  }
  return out.sort((a, b) =>
    (b.entry.favorite ? 1 : 0) - (a.entry.favorite ? 1 : 0)
    || b.entry.lastUsed - a.entry.lastUsed
    || a.entry.name.localeCompare(b.entry.name));
}

export interface PickerSection<T extends { primary: MuscleGroup | null } = PickerRow> {
  /** The muscle's label, or the one head for exercises with no muscle yet. */
  label: string;
  muscle: MuscleGroup | null;
  rows: T[];
}

/** The head over the rows that have no primary muscle. */
export const NO_MUSCLE_SECTION = "No Muscle Yet";

/** The rows under their primary muscle, in the app's muscle order, with the
 *  unsorted last. A section with no rows is not drawn. The Exercises page
 *  groups its stock rows through this too (2026-10-17), so the catalog sits
 *  under the same twelve heads, in the same order, wherever it is listed. */
export function pickerSections<T extends { primary: MuscleGroup | null }>(rows: T[]): PickerSection<T>[] {
  const by = new Map<MuscleGroup | null, T[]>();
  for (const r of rows) {
    const list = by.get(r.primary) ?? [];
    list.push(r);
    by.set(r.primary, list);
  }
  const out: PickerSection<T>[] = [];
  for (const m of MUSCLE_GROUPS) {
    const list = by.get(m);
    if (list?.length) out.push({ label: MUSCLE_LABEL[m], muscle: m, rows: list });
  }
  const rest = by.get(null);
  if (rest?.length) out.push({ label: NO_MUSCLE_SECTION, muscle: null, rows: rest });
  return out;
}

/** WHAT PICKING A STARTER MAKES (S9). The athlete's own exercise: a fresh
 *  opaque key (never derived from the name, so a rename cannot fork its
 *  history), the catalog's name, weight and reps, and the classification the
 *  catalog gave it. Pure: GymFlow writes the seed and the classification
 *  through its own setters (adoptStarters), so its in-memory copies of
 *  GymSettings stay in step with the store.
 *
 *  ONE WRITER (2026-10-17). The sheet used to write GymSettings itself when
 *  no caller took the adoption, and every picker in the app renders under
 *  GymFlow, which holds in-memory copies of classByKey and createdLifts and
 *  writes them whole on its next change. A starter adopted from the live
 *  session's Swap or Add Exercise landed in the store and was overwritten by
 *  the next classification saved anywhere: its muscles were gone. There is no
 *  second writer now; LibraryPickSheet.onAdopt is required. */
export interface Adoption { entry: LibraryEntry; seed: CreatedLift; cls: Classification }

export function adoptStarter(entry: LibraryEntry): Adoption {
  const key = newExerciseKey();
  const s = entry.starter;
  const cls: Classification = s ? starterClass(s) : { ...EMPTY_CLASS, measure: "weight_reps" };
  const seed: CreatedLift = { key, name: entry.name, kind: "weight_reps" };
  const { starter: _starter, ...rest } = entry;
  void _starter;
  return { entry: { ...rest, key, exerciseKey: key }, seed, cls };
}
