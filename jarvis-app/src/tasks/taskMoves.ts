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
import { breakdownPrompt, parseBreakdown } from "./breakdown";
import { nextFreeSlot, addMinutes } from "../schedule/calendar";

export interface TaskLike {
  id: string;
  data: { text: string; category?: string; due?: string | null; recurrence?: string; projectId?: string };
}

interface TaskWriter {
  task(id: string): Promise<{ text: string; category?: string; due?: string | null } | null>;
  createTask(text: string, opts: Record<string, unknown>): Promise<string | null>;
  deleteTask(id: string): Promise<unknown>;
}

interface ScheduleWriter {
  eventsOn(date: string): Promise<unknown[]>;
  createEvent(title: string, opts: Record<string, unknown>): Promise<unknown>;
}

// ADD TO SCHEDULE. The next free slot on the task's due day, or today, as a
// one-hour block. Returns false when the task has vanished underneath us,
// which the caller reports rather than silently doing nothing.
export async function scheduleTask(
  taskId: string,
  today: string,
  tasks: TaskWriter,
  schedule: ScheduleWriter,
  now = new Date(),
): Promise<{ ok: boolean; date?: string; start?: string }> {
  const t = await tasks.task(taskId);
  if (!t) return { ok: false };
  const date = t.due || today;
  const start = nextFreeSlot(await schedule.eventsOn(date) as never, date, now);
  await schedule.createEvent(t.text, {
    date,
    start,
    end: addMinutes(start, 60),
    category: t.category || undefined,
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
  if (original) {
    await tasks.createTask(original.data.text, {
      category: original.data.category,
      due: original.data.due ?? null,
      recurrence: original.data.recurrence,
      projectId: original.data.projectId,
    });
  }
}

export const splitLine = (n: number): string => `Split into ${n} ${n === 1 ? "step" : "steps"}`;
