import { groupFor, urgencyFor, todayISO } from "./grouping";
import type { TaskData } from "../notes/types";
import type { TaskItem } from "./TasksService";

// The filter chips on the Tasks page. All leads (every open task in one list,
// Dave 2026-07-30); Overdue is split out of Today here (the page shows one
// filter at a time); the service still groups overdue into "today" for the
// grouped() view. Pure + tested.
export type TaskFilter = "all" | "daily" | "today" | "overdue" | "upcoming" | "done";
export const FILTERS: TaskFilter[] = ["all", "daily", "today", "overdue", "upcoming", "done"];
export const FILTER_LABEL: Record<TaskFilter, string> = {
  all: "All",
  daily: "Daily",
  today: "Today",
  overdue: "Overdue",
  upcoming: "Upcoming",
  done: "Done",
};

export function filterOf(t: TaskData, today: string): TaskFilter {
  if (t.done) return "done";
  if (groupFor(t, today) === "upcoming") return "upcoming";
  return urgencyFor(t, today)?.kind === "overdue" ? "overdue" : "today";
}

export type Partitioned = Record<TaskFilter, TaskItem[]>;

export function partition(items: TaskItem[], today: string = todayISO()): Partitioned {
  const p: Partitioned = { all: [], daily: [], today: [], overdue: [], upcoming: [], done: [] };
  for (const it of items) {
    // REMINDERS ARE NOT TASKS (2026-08-19). They ride the task entity for
    // storage, but a reminder in a task list is exactly the clutter that made
    // "just remind me to take my meds" unusable: it would show as due, then
    // as overdue, forever. They live on their own strip and are filtered out
    // here, at the one chokepoint every task list goes through.
    if (it.data.reminder) continue;
    p[filterOf(it.data, today)].push(it);
    if (it.data.recurrence === "daily" && !it.data.done) p.daily.push(it);
  }
  // TASKS AUDIT 2026-08-29, FINDING #3. This used to sort by DATE only. Every
  // row inside "Today" shares the same date, so among them the sort was a
  // no-op and the list fell back to insertion order: an if-then plan cued
  // for 8:30 AM (see ifThen.ts) could sit under three tasks with no time
  // attached at all, which is exactly what the screenshot that started this
  // audit showed. A task with a time-kind cue is the closest thing this data
  // model has to "when today", so it is now the tie-break within a date:
  // timed tasks lead, earliest first, and everything with no cue keeps the
  // order it already had (no cue means no claim about when, so nothing here
  // invents one).
  const timeOf = (it: TaskItem) => (it.data.plan?.cue.kind === "time" ? it.data.plan.cue.what : "99:99");
  const key = (it: TaskItem) => (it.data.due ?? "9999-99-99") + "T" + timeOf(it);
  p.today.sort((a, b) => key(a).localeCompare(key(b)));
  p.overdue.sort((a, b) => key(a).localeCompare(key(b)));
  p.upcoming.sort((a, b) => key(a).localeCompare(key(b)));
  // All = every open task, soonest first (overdue leads), no-date last. Done
  // stays in its own chip so All is never a graveyard.
  p.all = [...p.overdue, ...p.today, ...p.upcoming];
  return p;
}

// Narrow a list to a single category. "all" or "" means no filtering. Pure.
export function byCategory(items: TaskItem[], categoryId: string): TaskItem[] {
  if (!categoryId || categoryId === "all") return items;
  return items.filter((it) => (it.data.category ?? "") === categoryId);
}
