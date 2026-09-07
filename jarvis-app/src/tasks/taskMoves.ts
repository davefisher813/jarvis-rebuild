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
import { nextFreeSlot, addMinutes } from "../schedule/calendar";
import { madeBy } from "../shared/provenance";

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
): Promise<{ ok: boolean; date?: string; start?: string }> {
  const t = await tasks.task(taskId);
  if (!t) return { ok: false };
  const date = t.due && t.due >= today ? t.due : today;
  const start = nextFreeSlot(await schedule.eventsOn(date) as never, date, now);
  await schedule.createEvent(t.text, {
    date,
    start,
    end: addMinutes(start, 60),
    category: t.category || undefined,
    sourceTaskId: taskId,
    source: madeBy("task", taskId),
  });
  return { ok: true, date, start };
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

export const splitLine = (n: number): string => `Split into ${n} ${n === 1 ? "step" : "steps"}`;
