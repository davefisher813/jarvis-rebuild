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

/** The one project to offer on: active, nothing open under it, not recently dismissed. */
export function stalledCandidate(
  projects: Project[],
  tasks: TaskItem[],
  todayIso: string,
  store: DismissStore = localStore(),
): Project | null {
  return (
    projects
      .filter((p) => p.data.status === "active")
      .filter((p) => nextActionOf(tasks, p.id) === null)
      .filter((p) => !isProjStepDismissed(p.id, todayIso, store))[0] ?? null
  );
}
