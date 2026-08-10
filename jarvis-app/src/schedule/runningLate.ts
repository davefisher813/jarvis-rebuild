import type { EventItem } from "./types";
import { addMinutes } from "./calendar";

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
  prior: { id: string; start: string; end: string | null }[];
}

export async function shiftFutureEvents(
  svc: ShiftSvc,
  dayEvents: EventItem[],
  nowHHMM: string,
  mins: number,
): Promise<ShiftResult> {
  const future = dayEvents.filter((e) => (!e.data.recurrence || e.data.recurrence === "none") && e.data.start >= nowHHMM);
  const skipped = dayEvents.filter((e) => e.data.recurrence && e.data.recurrence !== "none" && e.data.start >= nowHHMM).length;
  const prior = future.map((e) => ({ id: e.id, start: e.data.start, end: e.data.end ?? null }));
  for (const e of future) {
    await svc.editTime(e.id, addMinutes(e.data.start, mins));
    if (e.data.end) await svc.editEnd(e.id, addMinutes(e.data.end, mins));
  }
  return { moved: future.length, skipped, prior };
}

export async function restoreShift(svc: ShiftSvc, prior: ShiftResult["prior"]): Promise<void> {
  for (const p of prior) {
    await svc.editTime(p.id, p.start);
    if (p.end) await svc.editEnd(p.id, p.end);
  }
}
