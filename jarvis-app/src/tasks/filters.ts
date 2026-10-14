import { groupFor, urgencyFor, todayISO } from "./grouping";
import { isIn } from "./categories";
import type { TaskData } from "../notes/types";
import type { TaskItem } from "./TasksService";
import { emailTasksGoToList, isFromEmail } from "./emailTasks";

// The filter chips on the Tasks page. All leads (every open task in one list,
// Dave 2026-07-30); Overdue is split out of Today here (the page shows one
// filter at a time); the service still groups overdue into "today" for the
// grouped() view. Pure + tested.
export type TaskFilter = "all" | "today" | "tomorrow" | "overdue" | "nodate" | "email" | "done";
export const FILTERS: TaskFilter[] = ["all", "today", "tomorrow", "overdue", "nodate", "email", "done"];
export const FILTER_LABEL: Record<TaskFilter, string> = {
  all: "All",
  today: "Today",
  // Dave 2026-10-13: "Upcoming is identical to All". It held everything not due today, which is what All holds. It is Tomorrow now:
  // what is due the day after today and nothing else.
  tomorrow: "Tomorrow",
  overdue: "Overdue",
  // The Anytime pile: open tasks with no due date.
  nodate: "No Date",
  // Dave 2026-09-13: "In the dropdown it should have a from email tab."
  email: "From Email",
  done: "Done",
};
// Daily is not a filter (Dave 2026-10-13): a daily item is a reminder, and the Reminders page holds those.

const dayAfter = (iso: string): string => {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(y!, m! - 1, d! + 1);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};

/** The filter a task is listed under. A task due later than tomorrow has no filter of its own and answers "all": it is in All and nowhere else. */
export function filterOf(t: TaskData, today: string): TaskFilter {
  if (t.done) return "done";
  if (groupFor(t, today) === "upcoming") {
    if (!t.due) return "nodate";
    return t.due === dayAfter(today) ? "tomorrow" : "all";
  }
  return urgencyFor(t, today)?.kind === "overdue" ? "overdue" : "today";
}

export type Partitioned = Record<TaskFilter, TaskItem[]>;

export function partition(items: TaskItem[], today: string = todayISO(), emailToList: boolean = emailTasksGoToList()): Partitioned {
  const p: Partitioned = { all: [], today: [], tomorrow: [], overdue: [], nodate: [], email: [], done: [] };
  // Open tasks due after today that are not overdue: Tomorrow, No Date, and the later ones that only All holds.
  const ahead: TaskItem[] = [];
  for (const it of items) {
    // REMINDERS ARE NOT TASKS (2026-08-19). They ride the task entity for
    // storage, but a reminder in a task list is exactly the clutter that made
    // "just remind me to take my meds" unusable: it would show as due, then
    // as overdue, forever. They live on their own strip and are filtered out
    // here, at the one chokepoint every task list goes through.
    if (it.data.reminder) continue;
    // A TASK THE MAIL MADE WAITS UNDER FROM EMAIL (Dave 2026-09-13). Open ones
    // are listed there always, and join the ordinary lists only when he has
    // said they should (tasks/emailTasks.ts). A finished one is finished and
    // goes to Done like any other.
    if (!it.data.done && isFromEmail(it.data)) {
      p.email.push(it);
      if (!emailToList) continue;
    }
    const f = filterOf(it.data, today);
    if (f !== "all") p[f].push(it);
    if (!it.data.done && f !== "today" && f !== "overdue") ahead.push(it);
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
  p.tomorrow.sort((a, b) => key(a).localeCompare(key(b)));
  p.nodate.sort((a, b) => key(a).localeCompare(key(b)));
  ahead.sort((a, b) => key(a).localeCompare(key(b)));
  p.email.sort((a, b) => key(a).localeCompare(key(b)));
  // All = every open task, soonest first (overdue leads), no-date last. Done
  // stays in its own chip so All is never a graveyard.
  p.all = [...p.overdue, ...p.today, ...ahead];
  return p;
}

// Narrow a list to a single category. "all" or "" means no filtering. Pure.
//
// LIFE-F-10 (2026-09-05): this compared the PRIMARY category only, so a task
// tagged Work (main) and Family (extra) was missing from Area = Family even
// though the Family category page listed it (CategoryDetail reads isIn).
// extraCategories were promised to "put the task on those category pages and
// in those filters" (categories.ts:14-15); the filter now reads through the
// same isIn every other area rollup uses.
export function byCategory(items: TaskItem[], categoryId: string): TaskItem[] {
  if (!categoryId || categoryId === "all") return items;
  return items.filter((it) => isIn(it.data, categoryId));
}
