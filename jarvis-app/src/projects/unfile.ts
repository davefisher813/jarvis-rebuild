import type { TasksService } from "../tasks/TasksService";

// WHAT DELETING A PROJECT DOES TO ITS TASKS (2026-09-22).
//
// BiggerPictureFlow's removeWithUndo already said so in its own comment:
// "Deleting a project also orphans every task pointing at it." The
// LIFE-F-25 fix (recreating the project under its OWN id on Undo) only
// repairs this when Undo is tapped -- a delete that is never undone leaves
// every task's projectId aimed at a row that is gone, the same
// unresolved-pointer defect unfileArea (categories/unfile.ts) fixes for
// areas.

export interface UnfiledFromProject {
  tasks: { id: string }[];
}

/** Take the project off every task that carries it. Returns what to put back. */
export async function unfileProject(projectId: string, tasks: TasksService): Promise<UnfiledFromProject> {
  const out: UnfiledFromProject = { tasks: [] };
  if (!projectId) return out;
  for (const t of await tasks.listTasks()) {
    if (t.data.projectId !== projectId) continue;
    out.tasks.push({ id: t.id });
    await tasks.setProject(t.id, null);
  }
  return out;
}

/** Put back what unfileProject took off, for Undo. */
export async function refileProject(projectId: string, prior: UnfiledFromProject, tasks: TasksService): Promise<void> {
  for (const t of prior.tasks) await tasks.setProject(t.id, projectId);
}
