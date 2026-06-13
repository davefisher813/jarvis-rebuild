import { groupFor, urgencyFor, todayISO } from "./grouping";
import type { TaskData } from "../notes/types";
import type { TaskItem } from "./TasksService";

// The four filter chips on the Tasks page. Overdue is split out of Today here
// (the page shows one filter at a time); the service still groups overdue into
// "today" for the grouped() view. Pure + tested.
export type TaskFilter = "daily" | "today" | "overdue" | "upcoming" | "done";
export const FILTERS: TaskFilter[] = ["daily", "today", "overdue", "upcoming", "done"];
export const FILTER_LABEL: Record<TaskFilter, string> = {
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
  const p: Partitioned = { daily: [], today: [], overdue: [], upcoming: [], done: [] };
  for (const it of items) {
    p[filterOf(it.data, today)].push(it);
    if (it.data.recurrence === "daily" && !it.data.done) p.daily.push(it);
  }
  const key = (it: TaskItem) => it.data.due ?? "9999-99-99";
  p.today.sort((a, b) => key(a).localeCompare(key(b)));
  p.overdue.sort((a, b) => key(a).localeCompare(key(b)));
  p.upcoming.sort((a, b) => key(a).localeCompare(key(b)));
  return p;
}

// Narrow a list to a single category. "all" or "" means no filtering. Pure.
export function byCategory(items: TaskItem[], categoryId: string): TaskItem[] {
  if (!categoryId || categoryId === "all") return items;
  return items.filter((it) => (it.data.category ?? "") === categoryId);
}
