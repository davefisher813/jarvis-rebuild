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

// ---- Candidate ranking (2026-08-09) ----
// Dave: Plan My Day "should account for daily tasks and honestly what your
// goals are." Both were invisible to the pick list: a daily task with no due
// date ranked as an afterthought, and a task that moves a stated goal ranked
// identically to one that moves nothing. Pick order became placement priority
// when the planner went first-fit, so this ordering now decides who gets the
// best slots.

/** Daily rhythm tasks and anything due count as suggested (pre-picked). */
export function isSuggested(due: string, selected: string, recurrence?: string): boolean {
  return (!!due && due <= selected) || recurrence === "daily";
}

/**
 * Suggested first; inside each tier, goal-moving tasks before goalless ones
 * (a pick that advances something the user said they want outranks one that
 * does not); then due date, earliest first.
 */
export function rankCandidates(
  a: { suggested: boolean; goal?: string | null; due?: string },
  b: { suggested: boolean; goal?: string | null; due?: string },
): number {
  if (a.suggested !== b.suggested) return a.suggested ? -1 : 1;
  const ag = a.goal ? 0 : 1;
  const bg = b.goal ? 0 : 1;
  if (ag !== bg) return ag - bg;
  return (a.due || "z").localeCompare(b.due || "z");
}
