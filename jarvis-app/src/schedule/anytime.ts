import type { EventItem } from "./types";
import type { TaskItem } from "../tasks/TasksService";

// Roadmap v2, the Anytime row. Every task without a time lives in a strip above
// the timed grid on the Schedule day view: visible, checkable, never "late".
//
// A task has "a time" only once it has been given one, which creates an event
// carrying its id in sourceTaskId (see Plan My Day / tap-to-schedule). So the
// Anytime pool for a day is: open tasks, not yet turned into a block that day,
// that either have no due date or are due on/before the day. Undated tasks sort
// last; among dated ones the soonest comes first.
// `claimed` (blend, 2026-08-22): task ids a STANDING PROPOSAL holds. A
// proposal has no event yet, so without this a proposed task shows as a
// dashed row in the day AND again in the Anytime strip above it -- the same
// task twice on one screen, which the no-repetition law forbids. Committed
// work is excluded by its event; proposed work has to be named.
export function anytimeTasksForDay(
  tasks: TaskItem[],
  dayEvents: EventItem[],
  date: string,
  claimed: ReadonlySet<string> = new Set(),
): TaskItem[] {
  const planned = new Set([
    ...dayEvents.map((e) => e.data.sourceTaskId).filter((x): x is string => !!x),
    ...claimed,
  ]);
  return tasks
    .filter(
      (t) =>
        !t.data.done &&
        !planned.has(t.id) &&
        (!t.data.due || (t.data.due as string) <= date),
    )
    .sort((a, b) => {
      const da = (a.data.due as string) || "9999-99-99";
      const db = (b.data.due as string) || "9999-99-99";
      return da.localeCompare(db);
    });
}
