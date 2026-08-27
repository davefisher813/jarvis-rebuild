// BACK ON TRACK, EXTENDED TO HEALTH (catalog Part 2). Same mechanic as
// tasks/lifecycle.ts's backOnTrackMessage: a gap in LOGGING is celebrated on
// return, never shown as gap math. This file never renders the length of
// the gap; it only ever names the run that came before it, the same
// asymmetry the task version already holds (a short run gets no ceremony,
// a real one is worth naming, and the number it names is always the good
// one, never the missed one).

const MS_PER_DAY = 86400000;

function localDay(atMs: number): string {
  const d = new Date(atMs);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function daysBetween(aDay: string, bDay: string): number {
  return Math.round((Date.parse(bDay) - Date.parse(aDay)) / MS_PER_DAY);
}

// A gap longer than this many days is worth a comeback line at all; shorter
// and it is just an ordinary rest day, not something logging noticed.
export const GAP_DAYS = 4;
// A run shorter than this is not worth naming on return -- same floor
// tasks/lifecycle.ts uses for the identical reason.
export const MIN_RUN_TO_CELEBRATE = 3;

/** `marks` is any of this module's own timelines reduced to their raw
 *  timestamps (Lights Out, Took It, Ate Before, Call It all qualify). Given
 *  the full history and "today", returns the celebration line for a real
 *  return from a real gap, or null when there is nothing to say. */
export function healthComebackMessage(marks: { at: number }[], today: string): string | null {
  if (marks.length === 0) return null;
  const days = [...new Set(marks.map((m) => localDay(m.at)))].sort();
  if (days.length === 0) return null;
  const last = days[days.length - 1]!;
  const gap = daysBetween(last, today);
  if (gap < GAP_DAYS) return null; // no real gap, no ceremony

  // The run that ended at `last`: count contiguous logged days backward.
  let runLen = 1;
  for (let i = days.length - 1; i > 0; i--) {
    if (daysBetween(days[i - 1]!, days[i]!) <= 1) runLen++;
    else break;
  }
  if (runLen < MIN_RUN_TO_CELEBRATE) return null;

  // Names the PRIOR run, never the gap: "3-day run still counts", not
  // "9 days since your last log".
  return runLen + "-day run still counts";
}
