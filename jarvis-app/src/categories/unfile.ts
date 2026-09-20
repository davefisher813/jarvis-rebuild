import type { TasksService } from "../tasks/TasksService";
import type { ScheduleService } from "../schedule/ScheduleService";

// WHAT DELETING AN AREA DOES TO THE THINGS FILED UNDER IT (2026-09-20).
//
// It did nothing at all, and said otherwise. CategoryDetail computes a cost
// line -- "Untags 12 Tasks" -- and shows it on the armed step, and then the
// delete removed the area row and left every task and event pointing at an
// id that no longer resolves. The app stated the consequence and then did
// not carry it out.
//
// An orphaned id is worse than an empty one. Both read as "no area" on the
// row, but an empty one can be filed from any sheet, while an orphan carries
// a pointer nothing can resolve: it is not counted by the area it names,
// because that area is gone, and it is not counted as unfiled either.
//
// Found in his live data, where it had already happened: one area deleted in
// June left 28 tasks and 6 events stranded, and they have been invisible to
// every area filter since.
//
// Undo keeps its promise too, which is why this returns what it changed.
// The area comes back under its own id (catsSvc.restore), so the rows can be
// put back exactly where they were rather than approximately.

export interface Unfiled {
  tasks: { id: string; categories: string[] }[];
  events: { id: string; category: string }[];
}

/** Take the area off everything that carries it. Returns what to put back. */
export async function unfileArea(
  areaId: string,
  tasks: TasksService,
  schedule: ScheduleService,
): Promise<Unfiled> {
  const out: Unfiled = { tasks: [], events: [] };
  if (!areaId) return out;

  for (const t of await tasks.listTasks()) {
    const had = [t.data.category ?? "", ...(t.data.extraCategories ?? [])].filter(Boolean);
    if (!had.includes(areaId)) continue;
    out.tasks.push({ id: t.id, categories: had });
    // setCategories REPLACES the set (TasksService.ts), so the remaining
    // areas are handed back whole; a task filed under two areas keeps the
    // other one rather than being unfiled outright.
    await tasks.setCategories(t.id, had.filter((c) => c !== areaId));
  }

  for (const e of await schedule.listEvents()) {
    if ((e.data.category ?? "") !== areaId) continue;
    out.events.push({ id: e.id, category: areaId });
    await schedule.editCategory(e.id, "");
  }
  return out;
}

/** Put back what unfileArea took off, for Undo. */
export async function refileArea(
  prior: Unfiled,
  tasks: TasksService,
  schedule: ScheduleService,
): Promise<void> {
  for (const t of prior.tasks) await tasks.setCategories(t.id, t.categories);
  for (const e of prior.events) await schedule.editCategory(e.id, e.category);
}
