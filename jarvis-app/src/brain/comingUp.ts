import type { EventItem } from "../schedule/types";
import { occursOn, addDays } from "../schedule/calendar";

// BRAIN-F-07 (2026-09-05): the area page used to build both of these from one
// thin projection that compared `e.data.date` to today, so a recurring event
// anchored weeks ago (the daily gym block, a standing Wednesday practice) was
// never found. Both derivations here walk real days through occursOn, the
// same way weekRows.ts does for the Schedule, so an area page and the
// calendar can never disagree about what is coming.

/** How far ahead Coming Up looks. Two weeks is enough for a weekly series to
 *  show up and short enough that a monthly one does not crowd out today. */
export const COMING_UP_DAYS = 14;

export interface UpcomingRow { id: string; title: string; date: string; start: string }

/** The next occurrences tagged to this category, earliest first, one row per
 *  event: a daily block would otherwise fill the whole list with itself (and
 *  render four rows under the same React key). */
export function comingUpFor(
  events: EventItem[],
  categoryId: string,
  today: string,
  cap = 4,
  days = COMING_UP_DAYS,
): UpcomingRow[] {
  const mine = events.filter((e) => e.data.category === categoryId);
  const seen = new Set<string>();
  const rows: UpcomingRow[] = [];
  for (let i = 0; i < days; i++) {
    const day = addDays(today, i);
    for (const e of mine) {
      if (seen.has(e.id) || !occursOn(e.data, day)) continue;
      seen.add(e.id);
      rows.push({ id: e.id, title: e.data.title, date: day, start: e.data.start });
    }
  }
  return rows.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)).slice(0, cap);
}

/** Today's gym door: the block the athlete marked `gym` by hand, in ANY
 *  category (the flag is the mark, the category is not). Never a guess from a
 *  title or a tag, which is what made a dentist appointment read as Push Day.
 *  Earliest first, so a day with two marked blocks opens on the first. */
export function gymDoorOn(events: EventItem[], today: string): EventItem | null {
  const on = events
    .filter((e) => e.data.gym && !!e.data.start && occursOn(e.data, today))
    .sort((a, b) => a.data.start.localeCompare(b.data.start));
  return on[0] ?? null;
}
