import type { TaskItem } from "../tasks/TasksService";
import type { Project } from "../projects/types";
import type { Goal } from "../life/types";
import { capAfterNumber } from "../shared/casing";
import { daysBetween } from "../upnext/upnext";

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

// A PROJECT WITH A DATE (UP-CORE-18, 2026-09-05).
//
// The same arithmetic goals have had since PICK 14 (measure.ts's paceLine),
// on the other thing in this app that finishes: N tasks left, D days, is the
// pace real. Deliberately the same sentence shape, so the two surfaces read
// as one idea rather than two features.
//
// Null when there is nothing to pace: no date, no tasks, or already finished.
// Never a scolding and never a prescription: "2 a day from here" is what the
// arithmetic says, not what anyone should do about it.
export function projectPace(progress: Progress | null, due: string | undefined, today: string): string | null {
  if (!due || !progress || progress.total === 0) return null;
  const left = progress.total - progress.done;
  if (left <= 0) return null;
  const days = daysBetween(today, due);
  // The count reads "3 of 8 left" so the fraction is visible, and the rate
  // segment leads with a WORD ("About 2 a day"), which is the same trick
  // paceLine uses to keep the number-lead casing law reading as English.
  const count = `${left} of ${progress.total} left`;
  if (days < 0) return capAfterNumber(`${count} · Past its date`);
  if (days === 0) return capAfterNumber(`${count} · Due today`);
  if (days === 1) return capAfterNumber(`${count} · Due tomorrow`);
  // Fewer things left than days: one a day is more than enough, and a rate
  // under one ("0.4 a day") is arithmetic nobody can act on.
  const perDay = left / days;
  if (perDay <= 1) return capAfterNumber(`${count} · Due in ${days} days`);
  return capAfterNumber(`${count} · About ${Math.ceil(perDay)} a day from here`);
}

// LIFE-F-22 (2026-09-05): goalProgress had no caller, and laws.test.ts:1494
// is the reason: a goal's line is derived ONCE, through reach, because two
// passes over the same data drift (the list row said "No projects yet" while
// the hero said "8 open in your tags"). The law forbids the Bigger Picture
// pages from calling this; nothing else wanted it.

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
//
// ARCHITECTURE C (2026-08-22): openTagged joins the ranking. A goal that
// watches areas but holds no projects has no fraction at all, and under the
// old tiers it fell in with the goals that have nothing to measure, below
// every filed goal. It is live work; it just was not filed. It ranks as live,
// after the goals that can say how close they are, because those can.
export interface GoalRank { id: string; progress: Progress | null; openTagged?: number }
export function rankGoals<T extends GoalRank>(rows: T[]): T[] {
  const tier = (r: T): number => {
    if (!r.progress) return (r.openTagged ?? 0) > 0 ? 0 : 1; // tagged work is live work
    if (r.progress.done >= r.progress.total) return (r.openTagged ?? 0) > 0 ? 0 : 2;
    return 0;                                        // live work
  };
  return [...rows].sort((a, b) => {
    const ta = tier(a), tb = tier(b);
    if (ta !== tb) return ta - tb;
    return (b.progress?.pct ?? 0) - (a.progress?.pct ?? 0);
  });
}
