// THE MOVES AN EVENT CAN MAKE (2026-08-24).
//
// Last of the four sheets the audit found weaker depending on where it was
// opened. EventSheet renders "Move to Anytime" only when onMoveToAnytime is
// passed and "Duplicate" only when onDuplicate is passed, and only
// ScheduleFlow passed either, so the same event edited from Today offered
// neither.
//
// Same shape as tasks/taskMoves.ts, and for the same reason: copying the
// handlers into TodayFlow would have made a second implementation of a move
// that must behave identically. That is precisely how TodayFlow ended up with
// a breakdown that had quietly drifted away from the one in TasksFlow.
//
// Each function does the writes and returns what an Undo needs. Toasts,
// reloads and sheet state stay with the caller, because those legitimately
// differ per surface.

import { carriedFields, duplicateOf } from "./dayEdit";
import { minToHHMM } from "./calendar";
import { moveEvent, undoMoveEvent, type MoveOutcome } from "./eventAdjust";
import type { EventData, EventItem } from "./types";

interface EventWriter {
  event(id: string): Promise<EventData | null>;
  createEvent(title: string, opts: Record<string, unknown>): Promise<string | null>;
  // SCHED-F-09 (2026-09-05): the whole-record restore. An undo puts back what
  // was there, not the handful of fields this file happened to list.
  recreateFrom(e: EventData, id?: string): Promise<string | null>;
  deleteEvent(id: string): Promise<unknown>;
}

interface TaskMaker {
  createTask(text: string, opts: Record<string, unknown>): Promise<string | null>;
  deleteTask(id: string): Promise<unknown>;
}

// MOVE TO ANYTIME. The event leaves the calendar and becomes a task again.
//
// An event that CAME from a task already has one waiting, so this only makes a
// new task when there is no sourceTaskId; making one anyway would leave the
// user with two of the same thing, which is the bug this branch exists to
// avoid. Returns the created task id so an Undo can remove it.
export async function moveEventToAnytime(
  id: string,
  events: EventWriter,
  tasks: TaskMaker,
): Promise<{ ok: boolean; event?: EventData; eventId?: string; madeTaskId?: string }> {
  const e = await events.event(id);
  if (!e) return { ok: false };
  let madeTaskId: string | undefined;
  if (!e.sourceTaskId) {
    madeTaskId = (await tasks.createTask(e.title, { category: e.category || undefined })) ?? undefined;
  }
  await events.deleteEvent(id);
  return { ok: true, event: e, eventId: id, madeTaskId };
}

export async function undoMoveToAnytime(
  e: EventData,
  madeTaskId: string | undefined,
  events: EventWriter,
  tasks: TaskMaker,
  eventId?: string,
): Promise<void> {
  if (madeTaskId) await tasks.deleteTask(madeTaskId);
  // SCHED-F-09: the whole record, under its own id. The hand-listed subset
  // here dropped the attached tasks, the Training Door and the series end.
  await events.recreateFrom(e, eventId);
}

// DUPLICATE. onto `date`, defaulting to the event's own day. duplicateOf
// already strips the things a copy must not inherit: the repeat, the calendar
// id, the source task and its task links.
export async function duplicateEvent(
  id: string,
  all: EventItem[],
  date: string,
  events: EventWriter,
): Promise<{ ok: boolean; madeId?: string }> {
  const src = all.find((e) => e.id === id);
  if (!src) return { ok: false };
  const d = duplicateOf(src.data, date);
  const madeId = await events.createEvent(d.title, {
    date: d.date, start: d.start, end: d.end,
    category: d.category || undefined, location: d.location,
    ...carriedFields(d),
  });
  return { ok: true, madeId: madeId ?? undefined };
}

// COMMIT A NEW TIME (2026-10-01). Every way of saying "this event starts
// here now" goes through this one function: the swipe nudges, the retime
// sheet, the Overlaps sheet's nudge. They were each calling moveEvent on
// their own, which is three doors into the same write. One door means a
// check that has to look at the new time (an overlap warning, a bedtime
// guard) hooks in at exactly one place, not at every surface that can move
// an event.
//
// `end` is optional: the retime sheet changes when AND how long in one
// commit, and everything else keeps the length it had. A repeating event
// moves ONE occurrence, never the series (see moveEvent); the outcome is
// what undoRetime needs.
type RetimeWriter = Parameters<typeof moveEvent>[3];
export interface RetimeChange { start: string; end?: string }

export function commitRetime(id: string, change: RetimeChange, viewedDate: string, events: RetimeWriter): Promise<MoveOutcome> {
  return moveEvent(id, change.start, viewedDate, events, change.end);
}

export function undoRetime(id: string, viewedDate: string, outcome: MoveOutcome, events: RetimeWriter): Promise<void> {
  return undoMoveEvent(id, viewedDate, outcome, events);
}

// A NUDGE THAT REFUSES RATHER THAN CLAMPS. addMinutes stops at the edge of the
// day, which would pin the start and quietly change how long the block is:
// a "move" that resizes is a bug, not a nudge. Returns the new start, or null
// when the move would carry the block (start plus its length) off the day.
export function nudgeStart(start: string, delta: number, lengthMin: number | null): string | null {
  const p = start.split(":");
  const next = Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0) + delta;
  if (next < 0 || next + (lengthMin ?? 0) > 24 * 60 - 1) return null;
  return minToHHMM(next);
}
