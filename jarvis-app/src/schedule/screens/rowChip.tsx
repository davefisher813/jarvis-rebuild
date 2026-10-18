import { createContext, useContext, type ReactNode } from "react";
import CatChipLine, { chipArea } from "../../shared/CatChipLine";

// THE WHOLE DAY SHOWS WHERE A ROW LIVES (Dave 2026-10-15, decisions card 1; "Unfreeze", 2026-10-18). Home's day card draws time and title
// and nothing else, and a row Dave had filed under an area said nothing about it. The row's second line is now the SAME unified chip
// the Life task rows and the Notes rows wear (shared/CatChipLine, not restyled), first on the line, with the project's name after it in
// the row's one grey, exactly as a task row draws it. A row with no area marked has no chip and no second line. The "Flexible until"
// subtitle stays gone (Oct 13): this adds a place, not a state.
//
// WHO KNOWS THE PROJECT'S NAME: the page that owns the projects. It provides these two lookups around the day card, so the rows (shared
// with Schedule, which never reads them) need no new props threaded through the frozen card.
export interface RowChipWords {
  /** A project's name for an event, or null. */
  event: (eventId: string) => string | null;
  /** The project's (or event's) name for a task, or null. */
  task: (taskId: string) => string | null;
}
export const RowChipWordsContext = createContext<RowChipWords | null>(null);

/** The words that stand beside a row's chip: the project's name, or nothing. */
export function useRowChipWords(kind: keyof RowChipWords, id: string): string | null {
  return useContext(RowChipWordsContext)?.[kind](id) ?? null;
}

/** The second line of a Whole Day row. Nothing at all unless the row's area is marked and named. */
export function WholeDayChip({ category, words }: { category?: string | null; words?: string | null }): ReactNode {
  if (!chipArea(category)) return null;
  return <div className="r-k"><CatChipLine category={category} text={words ?? null} /></div>;
}
