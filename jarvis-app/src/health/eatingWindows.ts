// EATING WINDOWS (catalog Part 3). Scans tomorrow's calendar for gaps where
// no meal can physically fit and offers a real action -- a packed-snack
// reminder, an earlier Leave By, a task on the parent's list. Pure
// scheduling arithmetic: this file contains no nutrition content, no amount,
// no quality judgment, nothing that could ever be minimized.

export interface DayBlock {
  title: string;
  start: number; // epoch ms
  end: number; // epoch ms
}

export interface EatingGap {
  afterTitle: string;
  beforeTitle: string;
  start: number; // end of the block before the gap
  end: number; // start of the block after the gap
  minutes: number;
}

// A meal genuinely does not fit in less than this. Deliberately short: the
// point is catching the gaps that are ACTUALLY too tight, not padding every
// transition with a meal requirement nobody asked for.
export const MIN_MEAL_MINUTES = 20;

/** Sorted, non-overlapping view of the day's fixed blocks. */
function sortedBlocks(blocks: DayBlock[]): DayBlock[] {
  return [...blocks].sort((a, b) => a.start - b.start);
}

/** Every gap between tomorrow's blocks that is shorter than a meal needs.
 *  Home-to-first-block and last-block-to-midnight are deliberately not
 *  scanned here: this is about food strand BETWEEN commitments, where the
 *  catalog's own example lives (school out, practice, home). */
export function eatingGaps(blocks: DayBlock[]): EatingGap[] {
  const sorted = sortedBlocks(blocks);
  const gaps: EatingGap[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    const minutes = (b.start - a.end) / 60000;
    if (minutes > 0 && minutes < MIN_MEAL_MINUTES) {
      gaps.push({ afterTitle: a.title, beforeTitle: b.title, start: a.end, end: b.start, minutes: Math.round(minutes) });
    }
  }
  return gaps;
}

export type EatingWindowAction = "packed_snack" | "earlier_leave_by" | "parent_task";

export interface EatingWindowOffer {
  gap: EatingGap;
  action: EatingWindowAction;
  line: string; // the plain offer, contains no nutrition content
}

/** One offer per gap. The action is always a schedule action, never advice
 *  about what or how much to eat. */
export function eatingWindowOffers(blocks: DayBlock[]): EatingWindowOffer[] {
  return eatingGaps(blocks).map((gap) => ({
    gap,
    action: "packed_snack",
    line: "Pack Something For Between " + gap.afterTitle + " And " + gap.beforeTitle,
  }));
}
