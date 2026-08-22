import { openSlots, type FreeSlot } from "../schedule/calendar";
import type { EventItem } from "../schedule/types";

// BLOCK TIME FOR IT (2026-08-21, wiring the mail alternates).
//
// "Block Time For It" is a promise about a real slot, so it has to find one
// the same way the Schedule tab finds one, or the two disagree about what
// "open" means and Dave gets a block on top of dinner.
//
// Three rules, all borrowed from the Schedule tab's own definition of busy:
//   - Events are busy.
//   - Hard routine blocks are busy. A FOCUS block is not: focus time is time
//     set aside FOR work, which is exactly what this is.
//   - Today only counts from now. An 8am opening at 3pm is not an opening.
//
// When today has nothing left, tomorrow is the honest answer rather than a
// silent failure or a block at 6am.

export const BOOK_MIN = 30;

const MIN = (t: string) => {
  const p = t.split(":");
  return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0);
};
const HHMM = (m: number) =>
  String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");

export interface Booking { date: string; start: string; end: string }

function firstFit(slots: FreeSlot[], notBefore: number): { s: number; e: number } | null {
  for (const sl of slots) {
    const s = Math.max(MIN(sl.start), notBefore);
    if (MIN(sl.end) - s >= BOOK_MIN) return { s, e: MIN(sl.end) };
  }
  return null;
}

export function nextOpening(
  today: { date: string; events: EventItem[]; busy: { s: number; e: number }[] },
  tomorrow: { date: string; events: EventItem[]; busy: { s: number; e: number }[] },
  nowMin: number,
): Booking | null {
  // Round up to the next quarter hour: nobody books a thing at 3:07.
  const soon = Math.ceil((nowMin + 5) / 15) * 15;
  const t = firstFit(openSlots(today.events, "08:00", "21:00", BOOK_MIN, today.busy), soon);
  if (t) return { date: today.date, start: HHMM(t.s), end: HHMM(t.s + BOOK_MIN) };
  const m = firstFit(openSlots(tomorrow.events, "08:00", "21:00", BOOK_MIN, tomorrow.busy), 0);
  if (m) return { date: tomorrow.date, start: HHMM(m.s), end: HHMM(m.s + BOOK_MIN) };
  return null;
}
