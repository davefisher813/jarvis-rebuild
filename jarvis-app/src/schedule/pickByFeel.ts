import type { PlanCandidate } from "./screens/PlanDaySheet";

// PICK BY FEEL (P9, Dave 2026-08-20). Same family as "Just Pick One For Me"
// on the Tasks page, which he approved on 2026-08-19.
//
// Some days the list IS the problem. Reading eleven task names and choosing
// between them is the exact executive-function tax this app exists to remove.
// Three buttons that each add one task, no reading required:
//
//   quick  the shortest thing here, for momentum
//   hard   the biggest thing here, for while the energy lasts
//   goal   something that actually moves a goal, for when nothing feels worth it
//
// Laws:
//   - Deterministic. The same list and the same button give the same task, so
//     tapping twice is not a slot machine.
//   - Never returns something already picked.
//   - Overdue breaks every tie. A thing that is late is late whatever it feels
//     like.

export type Feel = "quick" | "hard" | "goal";

export const FEEL_LABEL: Record<Feel, string> = {
  quick: "Something Quick",
  hard: "The Hard One",
  goal: "Moves a Goal",
};

export function pickByFeel(
  tasks: PlanCandidate[],
  feel: Feel,
  picked: string[],
  durOf: (id: string) => number,
): string | null {
  const taken = new Set(picked);
  const pool = tasks.filter((t) => !taken.has(t.id));
  if (pool.length === 0) return null;

  const byId = (a: PlanCandidate, b: PlanCandidate) => a.id.localeCompare(b.id); // stable last resort
  const overdueFirst = (a: PlanCandidate, b: PlanCandidate) => Number(b.overdue) - Number(a.overdue);

  if (feel === "goal") {
    const withGoal = pool.filter((t) => !!t.goal);
    if (withGoal.length === 0) return null; // nothing to claim: say nothing
    return [...withGoal].sort((a, b) => overdueFirst(a, b) || byId(a, b))[0]!.id;
  }

  const sorted = [...pool].sort((a, b) => {
    const da = durOf(a.id);
    const db = durOf(b.id);
    const cmp = feel === "quick" ? da - db : db - da;
    return cmp || overdueFirst(a, b) || byId(a, b);
  });
  return sorted[0]!.id;
}

// Whether the button is worth showing at all. "Moves a Goal" over a list with
// no linked tasks is a button that does nothing, which is worse than no
// button (the Button Law, catalog O).
export function feelAvailable(tasks: PlanCandidate[], feel: Feel, picked: string[]): boolean {
  const taken = new Set(picked);
  const pool = tasks.filter((t) => !taken.has(t.id));
  if (pool.length === 0) return false;
  return feel !== "goal" || pool.some((t) => !!t.goal);
}
