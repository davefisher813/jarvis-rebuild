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
export function anytimeTasksForDay(
  tasks: TaskItem[],
  dayEvents: EventItem[],
  date: string,
): TaskItem[] {
  const planned = new Set(
    dayEvents.map((e) => e.data.sourceTaskId).filter((x): x is string => !!x),
  );
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
