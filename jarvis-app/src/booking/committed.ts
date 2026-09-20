import type { EventData } from "../schedule/types";

// HOURS HE HAS ALREADY SPOKEN FOR (Track 3, 2026-09-19).
//
// THE BUG THIS CLOSES. The public grid subtracted bookings other people had
// made and nothing else, so a link published for Tuesday afternoons cheerfully
// offered the hour he already had a meeting in. A booking link that
// double-books its owner is worse than no booking link: two people turn up
// expecting him and he is in neither place.
//
// WHY THE APP COMPUTES IT AND THE SERVER DOES NOT. api/book.ts has no auth in
// front of it and names no live-project credential, which is exactly why a
// mistake in it cannot reach the app's real data. Teaching it to read his
// calendar would end that. So the app, which already holds the calendar, works
// out which hours are taken and pushes them as rows he owns in Track 3.
//
// Kept pure so the parts that are easy to get wrong can be argued with: a
// recurring event is not one event, an all-day event is not a window, and two
// meetings that touch are one busy stretch rather than two.

/** One window of a day the owner is not free, in their own wall clock. */
export interface Block { date: string; startTime: string; endTime: string }

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const toMin = (hhmm: string): number => {
  const m = HHMM.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
const toHhmm = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** How long an event blocks for, when it never said. An event with a start and
 *  no end is a real thing in this app; treating it as instantaneous would offer
 *  a stranger the hour he is already in. */
export const ASSUMED_MIN = 60;

/** The window one event occupies on its own day, or null.
 *
 *  Travel and buffer count. "Leave by" is time he is in a car, and a booking
 *  taken then is a meeting he is driving through. */
export function blockFor(d: Pick<EventData, "date" | "start" | "end" | "travelMin" | "bufferMin">): Block | null {
  if (!d.date || !DATE.test(d.date)) return null;
  const startMin = toMin(d.start ?? "");
  if (!Number.isFinite(startMin)) return null;
  const endRaw = toMin(d.end ?? "");
  // An end before its start is a bad row, not an overnight event: this app
  // stores a day per event, so it is read as unknown rather than as 23 hours.
  const endMin = Number.isFinite(endRaw) && endRaw > startMin ? endRaw : startMin + ASSUMED_MIN;
  const before = Math.max(0, d.travelMin ?? 0);
  const after = Math.max(0, d.bufferMin ?? 0);
  // Clamped to the day. An event running past midnight blocks to the end of its
  // own day and no further, because the row it becomes carries one date.
  const from = Math.max(0, startMin - before);
  const to = Math.min(24 * 60, endMin + after);
  if (to <= from) return null;
  return { date: d.date, startTime: toHhmm(from), endTime: toHhmm(to) };
}

/** Two windows that touch or overlap become one. A grid asked about fifty
 *  fragments is a grid asked fifty questions, and the answer is the same. */
export function mergeBlocks(blocks: Block[]): Block[] {
  const byDay = new Map<string, Block[]>();
  for (const b of blocks) byDay.set(b.date, [...(byDay.get(b.date) ?? []), b]);
  const out: Block[] = [];
  for (const date of [...byDay.keys()].sort()) {
    const day = byDay.get(date)!.slice().sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
    let open: Block | undefined;
    for (const b of day) {
      if (open !== undefined && toMin(b.startTime) <= toMin(open.endTime)) {
        const wider: Block = { date: open.date, startTime: open.startTime, endTime: b.endTime };
        if (toMin(b.endTime) > toMin(open.endTime)) open = wider;
        continue;
      }
      if (open !== undefined) out.push(open);
      open = b;
    }
    if (open !== undefined) out.push(open);
  }
  return out;
}

/** Every hour taken between two dates, inclusive, merged.
 *
 *  `occurrences` is passed in rather than computed here: the schedule already
 *  knows how to expand a series, including the days removed from one, and a
 *  second expansion in this file would be a second answer to argue with. */
export type Occurrence = { date: string; data: Pick<EventData, "start" | "end" | "travelMin" | "bufferMin"> };

export function committedBlocks(occurrences: Occurrence[], fromDate: string, toDate: string): Block[] {
  const blocks: Block[] = [];
  for (const o of occurrences) {
    if (o.date < fromDate || o.date > toDate) continue;
    // The occurrence DATE wins over the events own anchor date: a weekly
    // meeting occurs on many days and the row it becomes names the one it is on.
    const b = blockFor({
      date: o.date,
      start: o.data.start,
      end: o.data.end,
      travelMin: o.data.travelMin,
      bufferMin: o.data.bufferMin,
    });
    if (b) blocks.push(b);
  }
  return mergeBlocks(blocks);
}
