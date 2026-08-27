// TWO DAYS OFF (catalog Part 2). Offers to place an actual rest day when the
// coming week has none. This file only decides WHICH day to offer and
// whether the offer is needed; the caller turns that into a real calendar
// block (a Routine block Plan My Day will not schedule over), same
// mechanism the catalog says the app already uses elsewhere for health time.

import type { WeekShape } from "./weekShape";

// NATA: two rest days a week (catalog Part 2, citing NATA directly).
export const REST_DAYS_TARGET = 2;

export interface RestDayOffer {
  needed: boolean;
  restDaysNow: number;
  suggestedDate: string | null; // the day with no session already, best candidate to protect
}

/** Reads a week's shape (weekShape.ts) and decides whether to offer a rest
 *  block, and on which existing open day. Never overwrites a day that
 *  already carries a session. */
export function restDayOffer(shape: WeekShape): RestDayOffer {
  const openDays = shape.days.filter((d) => d.sessions === 0);
  const restDaysNow = openDays.length;
  if (restDaysNow >= REST_DAYS_TARGET) {
    return { needed: false, restDaysNow, suggestedDate: null };
  }
  // The catalog wants a genuine rest day placed, so pick the single open day
  // there IS. With zero open days there is nothing safe to suggest without
  // displacing something already on the calendar; the caller's UI then reads
  // this as "surface the fact, no calendar action to offer yet".
  const suggestedDate = openDays[0]?.date ?? null;
  return { needed: true, restDaysNow, suggestedDate };
}
