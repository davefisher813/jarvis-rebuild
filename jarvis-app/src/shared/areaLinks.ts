import { useEffect, useRef } from "react";

// LINKED PICKERS FOLLOW THE AREA, BOTH WAYS (Dave 2026-10-22, from his phone: Area was Elite Squad and the Goal picker still listed
// every goal in the app). The Area, Person, Project and Goal fields of an editor are one question asked four ways, so they answer each
// other. One definition here, read by every editor that carries them together (the task sheet, the event sheet, the project sheet and the
// project page's own rows), so the rule cannot be true in one and not the next.
//
//   1. AREA FIRST. With an Area chosen, the Person, Project and Goal pickers offer only what is tied to it. None stays on top, a search
//      searches the list that is left, and an Area with nothing of a kind leaves that picker with None alone. With no Area, nothing is
//      filtered: there is nothing to filter by.
//   2. REVERSE. A Goal, Project or Person picked while the Area is blank brings its own Area in ("home": the first one it names).
//      With an Area already chosen the list has already been narrowed to what is tied to it, so a pick never moves it.
//   3. A CHANGE OF AREA CLEARS WHAT NO LONGER FITS. A picked Goal, Project or Person that is not tied to the new Area goes back to None,
//      so nothing silently keeps a link that disagrees with the Area. Choosing None for the Area clears nothing.
//
// What "tied to an Area" means is each kind's own stored link, never a guess:
//   a project  its `category`                                     (one area)
//   a goal     its `tags`, the categories it watches               (a list; the first live one is its home, as on the Goals lens)
//   a person   their `categoryIds`, the areas they belong to      (a list)
// An item with no area is tied to none of them, so an Area hides it. That is the rule as he set it; assigning areas to contacts and
// goals is what makes them appear.
//
// WHAT IS LEFT ALONE: a record opened with a link that already disagrees with its Area keeps showing it (and keeps it listed, so the field
// never says None for a value that is set) until the Area is changed; opening a record never edits it. And a pick this sheet cannot
// resolve (an item not in the list it was handed) is kept rather than guessed about.

/** The areas an item is tied to, home first. */
export type AreasOf<T> = (item: T) => readonly string[] | undefined;

/** The areas a project is tied to: its one category. */
export const projectAreas = (category: string | undefined | null): string[] => (category ? [category] : []);

/** Is this item tied to at least one of the chosen areas? */
export function tiedTo(itemAreas: readonly string[] | undefined, chosen: readonly string[]): boolean {
  return (itemAreas ?? []).some((a) => chosen.includes(a));
}

/** RULE 1. The picker's list under the chosen areas. No area chosen: everything. The current pick stays listed even when it is no longer tied. */
export function listInAreas<T extends { id: string }>(items: readonly T[], areasOf: AreasOf<T>, chosen: readonly string[], currentId = ""): T[] {
  if (chosen.length === 0) return [...items];
  return items.filter((it) => (currentId !== "" && it.id === currentId) || tiedTo(areasOf(it), chosen));
}

/** RULE 2. The area a pick brings with it: the first area it names (among the live ones when the list of those is given). */
export function homeArea(itemAreas: readonly string[] | undefined, live?: readonly string[]): string | undefined {
  return (itemAreas ?? []).find((a) => !live || live.includes(a));
}

/** RULE 3. The pick after the areas changed: itself while it is still tied (or cannot be judged), else None. */
export function keepIfTied<T extends { id: string }>(id: string, items: readonly T[], areasOf: AreasOf<T>, chosen: readonly string[]): string {
  if (id === "" || chosen.length === 0) return id;
  const item = items.find((it) => it.id === id);
  if (!item) return id;
  return tiedTo(areasOf(item), chosen) ? id : "";
}

/**
 * RULE 3's trigger. Runs `onChange` after the render in which the chosen areas CHANGED, never on the first one: a record opened with an old
 * mismatch is shown as it is, and only the person changing the Area (or something that fills it) clears links.
 */
export function useWhenAreasChange(chosen: readonly string[], onChange: (chosen: readonly string[]) => void): void {
  const sig = chosen.join("|");
  const seen = useRef(sig);
  useEffect(() => {
    if (seen.current === sig) return;
    seen.current = sig;
    onChange(chosen);
    // The callback closes over the render that changed the areas, which is the one that should run; it is not a dependency
    // (exhaustive-deps is off in this codebase on purpose).
  }, [sig]);
}
