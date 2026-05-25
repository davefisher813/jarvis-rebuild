// Pure aggregation helpers for the Today home. All read-only derivations over
// data produced (and already tested) by the Schedule and Tasks services.
import type { EventItem } from "../schedule/types";
import type { TaskItem } from "../tasks/TasksService";
import { partition } from "../tasks/filters";

const DAY = 86400000;

function isoOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

// The day after the given YYYY-MM-DD (handles month/year rollover).
export function tomorrowISO(today: string): string {
  return isoOf(new Date(new Date(today + "T00:00:00").getTime() + DAY));
}

// Current wall-clock as "HH:MM" (24h), to compare against event start times.
export function nowHHMM(now: Date = new Date()): string {
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

export interface DaySummary {
  events: number;
  due: number;
  overdue: number;
}

// Counts for the one-line briefing under the greeting.
export function daySummary(todayEvents: EventItem[], tasks: TaskItem[], today: string): DaySummary {
  const p = partition(tasks, today);
  return { events: todayEvents.length, due: p.today.length, overdue: p.overdue.length };
}

// Home "Today's Tasks" = overdue first, then due-today. Done and later tasks excluded.
export function todaysTasks(tasks: TaskItem[], today: string): TaskItem[] {
  const p = partition(tasks, today);
  return [...p.overdue, ...p.today];
}

// Index where the "Now" line belongs in a time-sorted event list:
// before the first event that has not started yet. All past -> end.
export function nowIndex(events: EventItem[], now: string): number {
  for (let i = 0; i < events.length; i++) {
    if (events[i]!.data.start >= now) return i;
  }
  return events.length;
}

// An event is "past" once its start time is earlier than the current time.
export function isPast(ev: EventItem, now: string): boolean {
  return ev.data.start < now;
}
