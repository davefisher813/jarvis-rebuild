import type { Project } from "../projects/types";
import type { TaskItem } from "../tasks/TasksService";
import { daysBetween } from "../upnext/upnext";
import { nextActionOf } from "./related";

// Stalled-project First Step (6.7, deferred from 6.6). A project with no open
// task has no next action and is stuck BY DEFINITION; the offer drafts the
// smallest opening move and creates it born-linked. One offer at a time, ever,
// and a dismissed project stays quiet for 7 days (same rhythm as the task-level
// First Step).

export interface DismissStore { read(): string | null; write(v: string): void }

const KEY = "jarvis.projstep.dismissed";
const QUIET_DAYS = 7;

function localStore(): DismissStore {
  return {
    read: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
    write: (v) => { try { localStorage.setItem(KEY, v); } catch { /* private mode */ } },
  };
}

export function isProjStepDismissed(projectId: string, todayIso: string, store: DismissStore = localStore()): boolean {
  try {
    const d = JSON.parse(store.read() || "{}") as Record<string, string>;
    const when = d[projectId];
    return !!when && daysBetween(when, todayIso) < QUIET_DAYS;
  } catch {
    return false;
  }
}

export function dismissProjStep(projectId: string, todayIso: string, store: DismissStore = localStore()): void {
  try {
    const d = JSON.parse(store.read() || "{}") as Record<string, string>;
    d[projectId] = todayIso;
    store.write(JSON.stringify(d));
  } catch {
    /* private mode */
  }
}

/**
 * The one project to offer on: active, never started, not recently dismissed.
 *
 * LIFE-F-19 (2026-09-05): "no open task" used to conflate NEVER STARTED with
 * ALL FINISHED, and pick 6 later defined the second one as done. A project
 * whose every task was ticked was folded into "1 Done project" with a Close
 * offer on the Projects lens while the notice row at the top of the same page
 * said "Nothing is moving here" and offered to draft it a new opening move.
 * Finished work is not stalled work: a project with tasks, all of them done,
 * is skipped here and closed by the row that already offers it
 * (progress.ts:150-153).
 */
export function stalledCandidate(
  projects: Project[],
  tasks: TaskItem[],
  todayIso: string,
  store: DismissStore = localStore(),
): Project | null {
  const finished = (id: string) => {
    const mine = tasks.filter((t) => t.data.projectId === id);
    return mine.length > 0 && mine.every((t) => t.data.done);
  };
  return (
    projects
      .filter((p) => p.data.status === "active")
      .filter((p) => nextActionOf(tasks, p.id) === null)
      .filter((p) => !finished(p.id))
      .filter((p) => !isProjStepDismissed(p.id, todayIso, store))[0] ?? null
  );
}
