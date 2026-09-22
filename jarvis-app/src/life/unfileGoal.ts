import type { ProjectsService } from "../projects/ProjectsService";

// WHAT DELETING A GOAL DOES TO ITS PROJECTS (2026-09-22).
//
// Same shape as unfileProject (projects/unfile.ts), one link up the chain:
// removeWithUndo's own comment says "deleting a goal orphans its projects."
// Undo repairs it only because the goal comes back under its own id; a
// delete that is never undone leaves every project's goalId aimed at a row
// that is gone. Named unfileGoal (not life/unfile.ts) so it is not mistaken
// for life/AreaService.ts's unrelated, UI-less life_area entity.

export interface UnfiledFromGoal {
  projects: { id: string }[];
}

/** Take the goal off every project that carries it. Returns what to put back. */
export async function unfileGoal(goalId: string, projects: ProjectsService): Promise<UnfiledFromGoal> {
  const out: UnfiledFromGoal = { projects: [] };
  if (!goalId) return out;
  for (const p of await projects.list()) {
    if (p.data.goalId !== goalId) continue;
    out.projects.push({ id: p.id });
    await projects.update(p.id, { goalId: undefined });
  }
  return out;
}

/** Put back what unfileGoal took off, for Undo. */
export async function refileGoal(goalId: string, prior: UnfiledFromGoal, projects: ProjectsService): Promise<void> {
  for (const p of prior.projects) await projects.update(p.id, { goalId });
}
