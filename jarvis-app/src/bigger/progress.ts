import type { TaskItem } from "../tasks/TasksService";
import type { Project } from "../projects/types";
import type { Goal } from "../life/types";
import { capAfterNumber } from "../shared/casing";

// Bigger Picture (roadmap v2, Session 6). "What you're working toward and what
// is ACTUALLY moving." The word actually is the whole design: every number here
// is derived from real tasks, never from a status the user typed months ago and
// never revisited. A self-reported dashboard decays into confident nonsense.
//
// The chain is goal -> project -> task. Anything we cannot derive, we do not
// claim: a project with no tasks reports null, not zero and not "on track".

export interface Progress {
  done: number;
  total: number;
  pct: number; // 0-100, rounded
}

// Days without a completion before open work is called stalled. Three weeks is
// long enough that a normal busy fortnight never trips it.
export const STALE_DAYS = 21;

export function tasksOfProject(tasks: TaskItem[], projectId: string): TaskItem[] {
  return tasks.filter((t) => t.data.projectId === projectId);
}

// Null when there is nothing to measure. Callers must render that as "no tasks
// yet", never as 0%.
export function projectProgress(tasks: TaskItem[], projectId: string): Progress | null {
  const mine = tasksOfProject(tasks, projectId);
  if (mine.length === 0) return null;
  const done = mine.filter((t) => t.data.done).length;
  return { done, total: mine.length, pct: Math.round((done / mine.length) * 100) };
}

// A goal rolls up every task under every project pointing at it.
export function goalProgress(tasks: TaskItem[], projects: Project[], goalId: string): Progress | null {
  const ids = projects.filter((p) => p.data.goalId === goalId).map((p) => p.id);
  if (ids.length === 0) return null;
  const mine = tasks.filter((t) => t.data.projectId && ids.includes(t.data.projectId));
  if (mine.length === 0) return null;
  const done = mine.filter((t) => t.data.done).length;
  return { done, total: mine.length, pct: Math.round((done / mine.length) * 100) };
}

// Time Sense samples: { id?: task id, t: epoch ms }. Device-local, so absence of
// evidence is NOT evidence of absence. `lastActivity` returns null when we
// simply do not know, and stalled() stays silent in that case.
export function lastActivity(samples: { id?: string; t: number }[], taskIds: string[]): number | null {
  let latest: number | null = null;
  for (const s of samples) {
    if (!s.id || !taskIds.includes(s.id)) continue;
    if (latest === null || s.t > latest) latest = s.t;
  }
  return latest;
}

// True only with positive evidence of neglect: the project has open work, we
// have seen completions on it before, and the most recent one is older than
// STALE_DAYS. Never guesses from silence.
export function isStalled(
  tasks: TaskItem[],
  samples: { id?: string; t: number }[],
  projectId: string,
  now: number,
): boolean {
  const mine = tasksOfProject(tasks, projectId);
  if (mine.length === 0) return false;
  if (!mine.some((t) => !t.data.done)) return false; // finished work is not stalled
  const last = lastActivity(samples, mine.map((t) => t.id));
  if (last === null) return false; // no evidence either way: say nothing
  return now - last > STALE_DAYS * 86400000;
}

export interface ProjectRow {
  project: Project;
  progress: Progress | null;
  stalled: boolean;
  lastAt: number | null;
}

// Projects ordered by what is actually moving: recently touched first, then
// projects with progress, then untouched ones. Done projects sink.
export function rankProjects(
  projects: Project[],
  tasks: TaskItem[],
  samples: { id?: string; t: number }[],
  now: number,
): ProjectRow[] {
  return projects
    .map((project): ProjectRow => {
      const ids = tasksOfProject(tasks, project.id).map((t) => t.id);
      return {
        project,
        progress: projectProgress(tasks, project.id),
        stalled: isStalled(tasks, samples, project.id, now),
        lastAt: lastActivity(samples, ids),
      };
    })
    .sort((a, b) => {
      const doneA = a.project.data.status === "done" ? 1 : 0;
      const doneB = b.project.data.status === "done" ? 1 : 0;
      if (doneA !== doneB) return doneA - doneB;
      if (a.lastAt !== b.lastAt) return (b.lastAt ?? -1) - (a.lastAt ?? -1);
      return (b.progress?.total ?? 0) - (a.progress?.total ?? 0);
    });
}

// The one honest line under a project. No tasks means we say exactly that.
export function progressLabel(p: Progress | null, stalled: boolean): string {
  if (!p) return "No tasks yet";
  if (p.done === p.total) return `All ${p.total} done`;
  return capAfterNumber(`${p.done} of ${p.total} done`) + (stalled ? " · Stalled" : "");
}

// ---------------------------------------------------------------------------
// WAVE 1, THE HONESTY PASS (Dave's picks 6, 9, 10, 2026-08-22).
//
// "Moving Now" counted projects whose STATUS said active while the list below
// rendered every project, so the header said five and seven rows appeared, and
// a card reading "Nothing is moving here" sat inside a section called Moving.
// A section is a claim about reality, so the claim gets derived like every
// other number on this surface.
// ---------------------------------------------------------------------------

export type Bucket = "moving" | "stalled" | "unstarted" | "done";

// The order sections are shown in, and the order a reader needs them: what is
// alive, what has stopped, what never began, what is over.
export const BUCKETS: Bucket[] = ["moving", "stalled", "unstarted", "done"];
export const BUCKET_LABEL: Record<Bucket, string> = {
  moving: "Moving", stalled: "Stalled", unstarted: "Not Started", done: "Done",
};

// A project is DONE when its own tasks say so, not only when someone closed
// it. That is the whole of pick 6: clearsProject already existed in
// shared/completion.ts and only ran at the instant of a tick, so a project
// that finished any other way stayed open forever.
export function bucketOf(row: ProjectRow): Bucket {
  if (row.project.data.status === "done") return "done";
  const p = row.progress;
  if (!p) return "unstarted";
  if (p.done >= p.total) return "done";
  return row.stalled ? "stalled" : "moving";
}

// True when the work is finished but the project has not been closed. The row
// offers to close itself; nothing closes silently.
export function closable(row: ProjectRow): boolean {
  const p = row.progress;
  return !!p && p.total > 0 && p.done >= p.total && row.project.data.status !== "done";
}

// GOALS ORDER BY WHAT IS TRUE (pick 10). They sorted by an `order` field
// nothing ever set, so the tiebreaker was the title and the list ran A to Z:
// "Build Massive Recruiting Network" led because of its first letter, and a
// finished goal sank to the bottom only because R is late in the alphabet.
//
// Nearest to finishing leads, because that is the one worth another hour.
// Goals with nothing to measure follow. Finished goals sink.
export interface GoalRank { id: string; progress: Progress | null }
export function rankGoals<T extends GoalRank>(rows: T[]): T[] {
  const tier = (r: T): number => {
    if (!r.progress) return 1;                       // nothing to measure
    if (r.progress.done >= r.progress.total) return 2; // finished, sink
    return 0;                                        // live work
  };
  return [...rows].sort((a, b) => {
    const ta = tier(a), tb = tier(b);
    if (ta !== tb) return ta - tb;
    return (b.progress?.pct ?? 0) - (a.progress?.pct ?? 0);
  });
}
