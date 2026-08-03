import type { Project } from "../projects/types";
import type { Goal } from "../life/types";
import type { Category } from "../categories/types";

// Plan My Day candidate metadata (6.7). Pure lookups both flows share.

/** The goal a task moves, via its project's goal link. Null when unlinked. */
export function goalTitleOf(projects: Project[], goals: Goal[], projectId: string | undefined): string | null {
  if (!projectId) return null;
  const p = projects.find((x) => x.id === projectId);
  if (!p?.data.goalId) return null;
  return goals.find((g) => g.id === p.data.goalId)?.data.title ?? null;
}

/**
 * The placement window for a task's category. Work-hours org categories pin
 * their tasks inside the Routine's work hours; everything else is unwindowed.
 */
export function workWindowOf(
  categories: Category[],
  categoryId: string | undefined,
  routine: { workStartMin: number; workEndMin: number } | null,
): { s: number; e: number } | null {
  if (!categoryId || !routine) return null;
  const cat = categories.find((c) => c.id === categoryId);
  if (!cat?.data.workHours) return null;
  if (!(routine.workEndMin > routine.workStartMin)) return null;
  return { s: routine.workStartMin, e: routine.workEndMin };
}
