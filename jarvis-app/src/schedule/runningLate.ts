import type { EventItem } from "./types";
import { addMinutes, shiftFitsDay } from "./calendar";

// Shift the rest of the day (extracted 2026-08-09 so Today and Schedule share
// one implementation instead of drifting copies). Future one-off events move
// by `mins`; recurring events stay put, because shifting a whole series from
// one bad morning is wrong. Returns what moved, what was skipped, and the
// prior times so the caller's Undo can restore every one.

export interface ShiftSvc {
  editTime(id: string, start: string): Promise<unknown>;
  editEnd(id: string, end: string): Promise<unknown>;
}

export interface ShiftResult {
  moved: number;
  skipped: number; // recurring events left in place
  // SCHED-F-18 (2026-09-05): events the shift would have pushed past
  // midnight. They stay where they are and the caller says how many, rather
  // than being clamped into a zero-length row at 23:59.
  crossed: number;
  prior: { id: string; start: string; end: string | null }[];
}

// TODAY-F-08 (2026-09-05): which events a shift is ABOUT, worked out before a
// single write goes out. The loop below can throw on its third event with two
// already moved, and a caller that only learns the prior times from the
// resolved result has nothing left to undo with. Pure, so the caller can hold
// the restore list first and still offer Undo on a half-finished shift.
export function shiftPlan(
  dayEvents: EventItem[],
  nowHHMM: string,
  mins = 0,
): { future: EventItem[]; skipped: number; crossed: number; prior: ShiftResult["prior"] } {
  const ahead = dayEvents.filter((e) => (!e.data.recurrence || e.data.recurrence === "none") && e.data.start >= nowHHMM);
  // SCHED-F-18: an event the shift would carry past midnight stays put. The
  // plan decides it, not the write loop, so the restore list the caller holds
  // covers exactly what moves.
  const future = ahead.filter((e) => shiftFitsDay(e.data.start, e.data.end, mins));
  const skipped = dayEvents.filter((e) => e.data.recurrence && e.data.recurrence !== "none" && e.data.start >= nowHHMM).length;
  return { future, skipped, crossed: ahead.length - future.length, prior: future.map((e) => ({ id: e.id, start: e.data.start, end: e.data.end ?? null })) };
}

export async function shiftFutureEvents(
  svc: ShiftSvc,
  dayEvents: EventItem[],
  nowHHMM: string,
  mins: number,
): Promise<ShiftResult> {
  const { future, skipped, crossed, prior } = shiftPlan(dayEvents, nowHHMM, mins);
  for (const e of future) {
    await svc.editTime(e.id, addMinutes(e.data.start, mins));
    if (e.data.end) await svc.editEnd(e.id, addMinutes(e.data.end, mins));
  }
  return { moved: future.length, skipped, crossed, prior };
}

export async function restoreShift(svc: ShiftSvc, prior: ShiftResult["prior"]): Promise<void> {
  for (const p of prior) {
    await svc.editTime(p.id, p.start);
    if (p.end) await svc.editEnd(p.id, p.end);
  }
}
