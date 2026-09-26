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
import type { MuscleGroup } from "./muscles";
import type { Equipment } from "./equipment";
import type { LibraryRow } from "./libraryEdit";
import { classOf, needsMuscles, type ClassStore, type MovementPattern } from "./classify";

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
