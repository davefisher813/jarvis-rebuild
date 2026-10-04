// THE MOVES A TASK CAN MAKE (2026-08-24).
//
// A page-by-page audit found four sheets that are WEAKER depending on where
// you opened them. The task sheet was one: opened from the Tasks tab it
// offers "Add to Schedule" and "Break It Down"; opened from Today it offers
// neither, because TaskSheet renders each of those only when the matching
// callback is passed and TodayFlow passed neither.
//
// The reason it stayed that way is that both handlers lived inside
// TasksFlow's closure, tangled with its sheet state, its `parts` list and its
// reload. Copying them into TodayFlow would have made two implementations of
// a move that must behave identically, which is exactly how the app grew two
// steppers and two schedule formats.
//
// So they move here, taking the services they need and returning what
// happened. The CALLER keeps its own toasts, its own reload and its own sheet
// state, because those differ per surface and should. What must not differ is
// what the move actually does.

import type { AIService } from "../ai/AIService";
import type { TaskData } from "../notes/types";
import { breakdownPrompt, parseBreakdown } from "./breakdown";
import { nextFreeSlot as calendarFreeSlot, addMinutes } from "../schedule/calendar";
import { dayItemsFor, nextFreeSlot, minToHhmm } from "../schedule/conflicts";
import { withConflictCheck, type AskFn } from "../schedule/withConflictCheck";
import { activeHoursFor, protectedRangesOn, type RoutineData } from "../routine/types";
import type { EventItem } from "../schedule/types";
import { madeBy } from "../shared/provenance";
import { lineCase } from "../shared/casing";

// LIFE-F-15 (2026-09-05): this said five fields, though both callers hand it
// a whole TaskItem. Undo of a Break It Down rebuilt the original from those
// five and dropped its checklist, its plan, its extra areas, its bill and its
// provenance. It carries the whole record now, and Undo goes through
// recreateFrom, which is the one function every Undo-after-delete calls.
export interface TaskLike {
  id: string;
  data: TaskData;
}

interface TaskWriter {
  task(id: string): Promise<{ text: string; category?: string; due?: string | null } | null>;
  createTask(text: string, opts: Record<string, unknown>): Promise<string | null>;
  recreateFrom(t: TaskData, id?: string): Promise<string | null>;
  deleteTask(id: string): Promise<unknown>;
}

interface ScheduleWriter {
  eventsOn(date: string): Promise<unknown[]>;
  createEvent(title: string, opts: Record<string, unknown>): Promise<unknown>;
}

// ADD TO SCHEDULE. The next free slot on the task's due day, or today, as a
// one-hour block. Returns false when the task has vanished underneath us,
// which the caller reports rather than silently doing nothing.
//
// LIFE-F-04 (2026-09-05): the day is the due day only while the due day is
// still ahead. An overdue task used to book its block on the date it was due,
// so the one move you most want on a late task put an hour on a day that is
// already gone and nothing showed up on today.
//
// TRACE-01 (2026-09-07, Dave: "there is no trace of events or steps (for
// tasks) anywhere in the app"). This wrote the block with no sourceTaskId,
// which is the one field the whole app reads to know a task already has a
// time. Every other door onto the calendar sets it (ScheduleService.
// commitPlan, Start Fifteen in TasksFlow and CategoryDetail); this one never
// did, from the day it was written. Three things followed, all of them what
// he was looking at: anytime.ts:32 kept the task in the Anytime strip above
// a block of itself, Plan My Day and the Day Loop kept offering work that
// was already booked, and Move to Anytime on that block minted a SECOND copy
// of the task because eventMoves.ts:47 only skips that when the link exists.
// The block also carries where it came from, so the row says so out loud:
// the trace he says is missing is a fact the app had and never wrote down.
export async function scheduleTask(
  taskId: string,
  today: string,
  tasks: TaskWriter,
  schedule: ScheduleWriter,
  now = new Date(),
  // The routine, so its protected blocks count as taken time, and the prompt
  // for the rare case there is no free slot (both optional: a caller without
  // them behaves as it always did, minus the overlap with events).
  opts: { routine?: RoutineData; ask?: AskFn } = {},
): Promise<{ ok: boolean; date?: string; start?: string; cancelled?: true }> {
  const t = await tasks.task(taskId);
  if (!t) return { ok: false };
  const date = t.due && t.due >= today ? t.due : today;
  const events = await schedule.eventsOn(date) as EventItem[];
  // THE NEXT FREE SLOT, NOT THE FIRST ONE (audit 2026-10-01, P0 #2). This
  // asked the events alone and stepped on the half hour, so it booked a task
  // at 9:30 straight across the Breakfast block with one tap and no word. It
  // now reads the same day the conflict check reads: events AND the routine's
  // blocks, and lands in the nearest stretch that touches none of them.
  const dow = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))).getDay();
  // By DATE, so a block's This Day exception is seen (2026-10-04): a skipped
  // block no longer steps the task around it, a retimed one does at its new time.
  const items = dayItemsFor(events, date, opts.routine ? protectedRangesOn(opts.routine, date) : []);
  let from = 9 * 60;
  if (opts.routine) from = Math.max(from, activeHoursFor(opts.routine, dow).wakeMin);
  if (date === today) from = Math.max(from, Math.ceil((now.getHours() * 60 + now.getMinutes()) / 30) * 30);
  const free = nextFreeSlot(items, 60, from, { forTask: true });
  // No free hour anywhere: the old walk's answer, and the prompt says so.
  const start = free !== null ? minToHhmm(free) : calendarFreeSlot(events, date, now);
  const placed = await withConflictCheck({ items, start, end: addMinutes(start, 60), forTask: true }, opts.ask, async (slot) => {
    await schedule.createEvent(t.text, {
      date,
      start: slot.start,
      end: slot.end ?? addMinutes(slot.start, 60),
      category: t.category || undefined,
      sourceTaskId: taskId,
      source: madeBy("task", taskId),
    });
  });
  if (placed.status === "cancelled") return { ok: true, date, start, cancelled: true };
  return { ok: true, date, start: placed.start };
}

export interface BreakdownResult {
  steps: string[];
  made: string[];
  // The task that was split, so the caller can offer a real Undo.
  original: TaskLike | null;
  reason?: "no-ai" | "not-found";
}

// BREAK IT DOWN. Asks for the steps, creates one task per step inheriting the
// original's category, due date and project, and deletes the original.
//
// Deliberately does NOT reload or toast: those belong to whichever surface
// called it. It DOES return everything an Undo needs, because an undo that
// only half restores is the thing this project keeps writing laws against.
export async function breakDownTask(
  text: string,
  original: TaskLike | null,
  today: string,
  ai: AIService,
  tasks: TaskWriter,
  identity: string,
): Promise<BreakdownResult> {
  let steps: string[] = [];
  try {
    const p = breakdownPrompt(text, identity);
    steps = parseBreakdown(await ai.complete([{ role: "user", content: p.user }], p.system));
  } catch {
    steps = [];
  }
  if (steps.length === 0) return { steps: [], made: [], original, reason: "no-ai" };

  const made: string[] = [];
  for (const step of steps) {
    const id = await tasks.createTask(step, {
      category: original?.data.category ?? "",
      // LIFE-F-15: the steps inherit every area the original wore, not just
      // its primary, or splitting a task quietly unfiled it from the others.
      extraCategories: original?.data.extraCategories,
      due: original?.data.due ?? today,
      projectId: original?.data.projectId,
      source: { type: "chat", ts: Date.now() },
    });
    if (id) made.push(id);
  }
  if (original) await tasks.deleteTask(original.id);
  return { steps, made, original };
}

// Putting a split back: delete what it made, recreate what it replaced.
export async function undoBreakdown(
  made: string[],
  original: TaskLike | null,
  tasks: TaskWriter,
): Promise<void> {
  for (const id of made) await tasks.deleteTask(id);
  // LIFE-F-15: the whole record, under its own id, so what comes back is the
  // task that was split and not a thin copy of it.
  if (original) await tasks.recreateFrom(original.data, original.id);
}

export const splitLine = (n: number): string => lineCase(`Split into ${n} ${n === 1 ? "step" : "steps"}`);
