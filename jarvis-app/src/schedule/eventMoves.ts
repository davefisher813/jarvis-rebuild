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

import { duplicateOf } from "./dayEdit";
import type { EventData, EventItem } from "./types";

interface EventWriter {
  event(id: string): Promise<EventData | null>;
  createEvent(title: string, opts: Record<string, unknown>): Promise<string | null>;
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
): Promise<{ ok: boolean; event?: EventData; madeTaskId?: string }> {
  const e = await events.event(id);
  if (!e) return { ok: false };
  let madeTaskId: string | undefined;
  if (!e.sourceTaskId) {
    madeTaskId = (await tasks.createTask(e.title, { category: e.category || undefined })) ?? undefined;
  }
  await events.deleteEvent(id);
  return { ok: true, event: e, madeTaskId };
}

export async function undoMoveToAnytime(
  e: EventData,
  madeTaskId: string | undefined,
  events: EventWriter,
  tasks: TaskMaker,
): Promise<void> {
  if (madeTaskId) await tasks.deleteTask(madeTaskId);
  await events.createEvent(e.title, {
    date: e.date, start: e.start, end: e.end,
    category: e.category || undefined, location: e.location,
    recurrence: e.recurrence, sourceTaskId: e.sourceTaskId,
  });
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
  });
  return { ok: true, madeId: madeId ?? undefined };
}
