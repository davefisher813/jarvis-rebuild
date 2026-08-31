import type { ProgramDay } from "./types";

// PINS, D4 (Training Catalog V2, approved 2026-08-31). "Users should be able
// to set which days they are doing which lifts in the schedule." A pin is a
// weekday the athlete chose, Mon=0..Sun=6 -- the same Mon-first week the
// gym's own dots speak (summary.ts). Pins change what Up Next OFFERS; they
// never start anything, never nag about a missed day, and an unpinned
// program keeps the rotation it always had.

export const WEEKDAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
/** Sheet labels. Same Mon-first order as everything else in the gym. */
export const WEEKDAY_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

/** "Tue · Fri", in week order regardless of how the pins were stored. */
export function pinLabel(pinDays: number[] | undefined): string {
  if (!pinDays || pinDays.length === 0) return "";
  return [...pinDays].sort((a, b) => a - b).map((d) => WEEKDAY_ABBR[d] ?? "").filter(Boolean).join(" · ");
}

/** Today's weekday in the module's own convention (Mon=0..Sun=6). */
export function todayDow(now: Date = new Date()): number {
  return (now.getDay() + 6) % 7;
}

/** The day pinned to a given weekday, or null. First match wins, in the
 *  athlete's own program order. Empty days are skipped: an offer to start
 *  nothing is not an offer. */
export function pinnedTo(days: ProgramDay[], dow: number): ProgramDay | null {
  for (const d of days) {
    if (d.exercises.length === 0) continue;
    if (d.pinDays?.includes(dow)) return d;
  }
  return null;
}

/**
 * The next pinned day from `todayDow` forward (today counts first), with how
 * many days away it is. Null when no day carries a pin -- the rotation keeps
 * its job. Ties go to the earlier day in the program.
 */
export function nextPinnedDay(days: ProgramDay[], dow: number): { day: ProgramDay; inDays: number } | null {
  let best: { day: ProgramDay; inDays: number } | null = null;
  for (const d of days) {
    if (d.exercises.length === 0 || !d.pinDays?.length) continue;
    for (const pin of d.pinDays) {
      const inDays = ((pin - dow) % 7 + 7) % 7;
      if (!best || inDays < best.inDays) best = { day: d, inDays };
    }
  }
  return best;
}
