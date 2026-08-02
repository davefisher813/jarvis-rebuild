import type { EventItem } from "./types";
import type { TaskItem } from "../tasks/TasksService";

// Event-task attachments (roadmap v2, Session 4 connections). Pure helpers;
// storage and UI belong to the callers. Links live on the event and die with
// it, so there is nothing to migrate and nothing to go stale.

export interface AttachInfo {
  total: number;
  done: number;
}

// Done/total for one event's attached tasks. Attached ids whose task was
// deleted are simply not counted (the link died with the task).
export function attachInfo(e: EventItem, tasks: TaskItem[]): AttachInfo | null {
  const ids = e.data.taskIds;
  if (!ids || ids.length === 0) return null;
  const byId = new Map(tasks.map((t) => [t.id, t] as const));
  const attached = ids.map((id) => byId.get(id)).filter((t): t is TaskItem => !!t);
  if (attached.length === 0) return null;
  return { total: attached.length, done: attached.filter((t) => t.data.done).length };
}

// One line of meta for the day row. Sentence case: meta talks, it never names.
export function attachLabel(info: AttachInfo): string {
  if (info.done === 0) return `${info.total} ${info.total === 1 ? "task" : "tasks"} attached`;
  return `${info.done} of ${info.total} ${info.total === 1 ? "task" : "tasks"} done`;
}

function toMin(hhmm: string): number {
  const p = hhmm.split(":");
  return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0);
}

export interface FollowUp {
  eventId: string;
  title: string;
  openCount: number;
}

// The one question after an event ends: "N tasks were attached. Any done?"
// Fires for today's most recently ended non-recurring event that still has
// open attached tasks and has not been asked before. Callers persist `asked`.
export function followUpCandidate(
  events: EventItem[],
  tasks: TaskItem[],
  date: string,
  nowHHMM: string,
  asked: Set<string>,
): FollowUp | null {
  const now = toMin(nowHHMM);
  const byId = new Map(tasks.map((t) => [t.id, t] as const));
  const ended = events
    .filter((e) => e.data.date === date)
    .filter((e) => !e.data.recurrence || e.data.recurrence === "none")
    .filter((e) => !asked.has(e.id))
    .filter((e) => (e.data.end ? toMin(e.data.end) : toMin(e.data.start) + 60) <= now)
    .sort((a, b) => (b.data.end ?? b.data.start).localeCompare(a.data.end ?? a.data.start));
  for (const e of ended) {
    const open = (e.data.taskIds ?? [])
      .map((id) => byId.get(id))
      .filter((t): t is TaskItem => !!t && !t.data.done);
    if (open.length > 0) return { eventId: e.id, title: e.data.title, openCount: open.length };
  }
  return null;
}
