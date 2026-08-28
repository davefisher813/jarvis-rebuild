// THE QUICK ADJUSTMENTS AN EVENT ROW OFFERS (2026-08-28): shift by a swipe
// action, retime to an exact clock time, resize how long it runs, skip just
// today, push to tomorrow. ScheduleFlow had all five; Today did not (Dave:
// "make sure it all translates to the home page... max editing/adjusting
// ability for all scheduling features on all pages"). Extracted here for the
// exact reason eventMoves.ts documents at its own top: copying these into
// TodayFlow verbatim would have made a second implementation that must
// behave identically to the first, and second implementations drift. Same
// shape as eventMoves.ts and runningLate.ts - pure writers, the caller owns
// attemptWrite, the toast, and reload.

import type { EventData } from "./types";
import { addDays, addMinutes, minutesBetween } from "./calendar";

interface EventWriter {
  event(id: string): Promise<EventData | null>;
  editTime(id: string, start: string): Promise<unknown>;
  editEnd(id: string, end: string): Promise<unknown>;
  addExdate(id: string, date: string): Promise<unknown>;
  removeExdate(id: string, date: string): Promise<unknown>;
  moveDay(id: string, date: string): Promise<unknown>;
  createEvent(title: string, opts: Record<string, unknown>): Promise<string | null>;
  deleteEvent(id: string): Promise<unknown>;
}

// MOVE TO AN EXACT START TIME. Used by both the swipe shift (-15/+15/+1h)
// and the time-tap picker: both are "put this event at a new start", they
// just compute toStart differently.
//
// A one-off event edits in place. A REPEATING event never does (Dave,
// 2026-08-19: "locked in stuff should be moveable with no issue", but moving
// a whole SERIES from a swipe is the footgun): it excludes viewedDate on the
// series and drops a standalone copy at the new time instead, so only that
// one occurrence moves.
export interface MoveOutcome {
  ok: boolean;
  event?: EventData;
  repeating: boolean;
  copyId?: string | null;
}

export async function moveEvent(id: string, toStart: string, viewedDate: string, events: EventWriter): Promise<MoveOutcome> {
  const e = await events.event(id);
  if (!e) return { ok: false, repeating: false };
  const repeating = (e.recurrence ?? "none") !== "none";
  const dur = e.end ? minutesBetween(e.start, e.end) : null;
  const newEnd = dur !== null ? addMinutes(toStart, dur) : undefined;

  if (!repeating) {
    await events.editTime(id, toStart);
    if (e.end) await events.editEnd(id, newEnd!);
    return { ok: true, event: e, repeating: false };
  }

  await events.addExdate(id, viewedDate);
  const copyId = await events.createEvent(e.title, {
    date: viewedDate, start: toStart, end: newEnd,
    category: e.category || undefined, location: e.location || undefined,
  });
  return { ok: true, event: e, repeating: true, copyId };
}

export async function undoMoveEvent(id: string, viewedDate: string, outcome: MoveOutcome, events: EventWriter): Promise<void> {
  if (!outcome.event) return;
  if (!outcome.repeating) {
    await events.editTime(id, outcome.event.start);
    if (outcome.event.end) await events.editEnd(id, outcome.event.end);
    return;
  }
  if (outcome.copyId) await events.deleteEvent(outcome.copyId);
  await events.removeExdate(id, viewedDate);
}

// Shift by a relative amount (the swipe actions: -15m/+15m/+1h). Just
// moveEvent with the new start computed from the old one.
export async function shiftEvent(id: string, mins: number, viewedDate: string, events: EventWriter): Promise<MoveOutcome> {
  const e = await events.event(id);
  if (!e) return { ok: false, repeating: false };
  return moveEvent(id, addMinutes(e.start, mins), viewedDate, events);
}

// RESIZE: change how long an event runs without opening the full editor. A
// repeating event resizes for the whole series - correct, and not the same
// footgun as moving one: every instance keeps its slot, just gets longer or
// shorter.
export interface ResizeOutcome { ok: boolean; before?: string; minutes?: number }

export async function resizeEvent(id: string, end: string, events: EventWriter): Promise<ResizeOutcome> {
  const e = await events.event(id);
  if (!e) return { ok: false };
  const before = e.end;
  await events.editEnd(id, end);
  return { ok: true, before, minutes: minutesBetween(e.start, end) };
}

export async function undoResizeEvent(id: string, before: string | undefined, events: EventWriter): Promise<void> {
  // A row that never had an end goes back to not having one, rather than to
  // a default invented on its behalf.
  await events.editEnd(id, before ?? "");
}

// SKIP JUST TODAY: a repeating thing not happening today should not need
// deleting or an editor visit. The series never notices.
export async function skipEventToday(id: string, date: string, events: EventWriter): Promise<{ ok: boolean }> {
  const e = await events.event(id);
  if (!e) return { ok: false };
  await events.addExdate(id, date);
  return { ok: true };
}

export async function undoSkipEventToday(id: string, date: string, events: EventWriter): Promise<void> {
  await events.removeExdate(id, date);
}

// PUSH TO TOMORROW: one event, one day later, same time.
export async function pushEventTomorrow(id: string, events: EventWriter): Promise<{ ok: boolean; fromDate?: string }> {
  const e = await events.event(id);
  if (!e) return { ok: false };
  await events.moveDay(id, addDays(e.date, 1));
  return { ok: true, fromDate: e.date };
}

export async function undoPushEventTomorrow(id: string, fromDate: string, events: EventWriter): Promise<void> {
  await events.moveDay(id, fromDate);
}
