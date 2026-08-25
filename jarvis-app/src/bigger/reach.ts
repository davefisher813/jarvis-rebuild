import type { TaskItem } from "../tasks/TasksService";
import type { Project } from "../projects/types";
import type { Goal } from "../life/types";
import type { Progress } from "./progress";
import { categoriesOf } from "../tasks/categories";
import { capAfterNumber } from "../shared/casing";

// ---------------------------------------------------------------------------
// ARCHITECTURE C (Dave's pick, 2026-08-22): a goal reaches its work TWO ways.
//
//   FILED   a project points at the goal (project.data.goalId). The project's
//           tasks are the goal's tasks. This is the existing chain and it is
//           what the progress numbers have always been derived from.
//
//   TAGGED  the goal names categories (goal.data.tags). Any task in one of
//           those categories is work toward the goal, with NO filing at all.
//
// Dave picked "both: tags by default, attach projects when big enough."
// Filing is for work that deserves a plan. Tagging covers everything else,
// which in his data is most of it: four of his seven projects were unstarted,
// not unlinked, and the app's whole sense of a bigger picture died at the
// word "project" because nothing below it ever pointed up.
//
// WHY TAGS DO NOT FEED THE PROGRESS NUMBER
// A tag is a SAVED FILTER, which is the exact phrase in the catalog. It shows
// what matches right now; it is not a scoreboard. Feeding it into done/total
// would break the oldest law on this surface, "anything we cannot derive we
// do not claim", in a specific and ugly way: an ordinary task carries no
// completion date (only bills and recurring tasks stamp lastDone), so the
// moment a goal is tagged Health it would inherit every Health task ever
// closed and read "312 of 400 done, 78%" on the day it was created. True
// about the tag. A lie about the goal.
//
// So the split is:
//   progress  = FILED work only. Tags never move this number.
//   tagged    = the live filter. Counted as OPEN work, which needs no history.
// Both are shown, both are labelled, and neither pretends to be the other.
// ---------------------------------------------------------------------------

/** The categories a goal watches. Always an array, empties dropped. */
export function goalTags(goal: Goal): string[] {
  return (goal.data.tags ?? []).map((t) => (t ?? "").trim()).filter(Boolean);
}

/**
 * Goals that can still be moved. An achieved goal is not "moved" by anything,
 * and neither is one that was put down on purpose (pick 17): a dropped goal
 * keeps its record and its reason, but it stops counting, stops ranking, and
 * stops nudging from Today.
 */
export function liveGoals(goals: Goal[]): Goal[] {
  return goals.filter((g) => g.data.state !== "achieved" && !g.data.dropped);
}

export interface GoalReach {
  /** Tasks reached through a project filed under this goal. */
  filedIds: string[];
  /** Tasks reached ONLY by a tag. Never overlaps filedIds. */
  taggedIds: string[];
  /** Open tasks among taggedIds. The filter's honest headline. */
  openTagged: number;
  /** FILED work only, so this number cannot be inflated by tagging. */
  progress: Progress | null;
}

/** Every project filed under this goal. */
export function projectsOfGoal(projects: Project[], goalId: string): Project[] {
  return projects.filter((p) => p.data.goalId === goalId);
}

/**
 * What this goal reaches, both ways, deduped. A task filed through a project
 * AND matching a tag counts once, on the filed side, because filing is the
 * stronger statement of intent.
 */
export function reachOf(tasks: TaskItem[], projects: Project[], goal: Goal): GoalReach {
  const projIds = new Set(projectsOfGoal(projects, goal.id).map((p) => p.id));
  const tags = new Set(goalTags(goal));

  const filedIds: string[] = [];
  const taggedIds: string[] = [];
  let openTagged = 0;
  let filedDone = 0;

  for (const t of tasks) {
    const pid = t.data.projectId;
    if (pid && projIds.has(pid)) {
      filedIds.push(t.id);
      if (t.data.done) filedDone++;
      continue;
    }
    if (tags.size === 0) continue;
    if (categoriesOf(t.data).some((c) => tags.has(c))) {
      taggedIds.push(t.id);
      if (!t.data.done) openTagged++;
    }
  }

  const progress: Progress | null = filedIds.length === 0
    ? null
    : { done: filedDone, total: filedIds.length, pct: Math.round((filedDone / filedIds.length) * 100) };

  return { filedIds, taggedIds, openTagged, progress };
}

/**
 * The one line under a goal. Filed work speaks in fractions because it has a
 * real denominator; tagged work speaks in open counts because it does not.
 * A goal with neither says so.
 */
export function reachLine(r: GoalReach): string {
  const p = r.progress;
  if (p) {
    const base = capAfterNumber(`${p.done} of ${p.total} done`);
    return r.openTagged > 0 ? `${base} · ${r.openTagged} tagged open` : base;
  }
  if (r.openTagged > 0) return capAfterNumber(`${r.openTagged} open in your tags`);
  if (r.taggedIds.length > 0) return "Tagged work all done";
  return "Nothing under it yet";
}

// ---------------------------------------------------------------------------
// THE UPWARD LOOK: given a task, which goals does finishing it move?
//
// This is the direction the app never had. Everything pointed down (goal ->
// project -> task) and nothing pointed up, so a task on Today could not say
// what it was for. Items 1 and 5 both need this answer for EVERY task on the
// screen, so it is an index, built once per render pass, not a scan per row.
// ---------------------------------------------------------------------------

export interface GoalIndex {
  byProject: Map<string, string[]>;  // projectId  -> goalIds
  byCategory: Map<string, string[]>; // categoryId -> goalIds
  titleOf: Map<string, string>;      // goalId     -> title
  size: number;
}

const EMPTY_INDEX: GoalIndex = {
  byProject: new Map(), byCategory: new Map(), titleOf: new Map(), size: 0,
};

/** Build the upward index. Pass live goals only; achieved ones move nothing. */
export function buildGoalIndex(projects: Project[], goals: Goal[]): GoalIndex {
  if (goals.length === 0) return EMPTY_INDEX;
  const byProject = new Map<string, string[]>();
  const byCategory = new Map<string, string[]>();
  const titleOf = new Map<string, string>();
  const push = (m: Map<string, string[]>, key: string, goalId: string) => {
    const list = m.get(key);
    if (list) { if (!list.includes(goalId)) list.push(goalId); }
    else m.set(key, [goalId]);
  };
  for (const g of goals) {
    titleOf.set(g.id, g.data.title);
    for (const t of goalTags(g)) push(byCategory, t, g.id);
  }
  for (const p of projects) {
    const gid = p.data.goalId;
    if (gid && titleOf.has(gid)) push(byProject, p.id, gid);
  }
  return { byProject, byCategory, titleOf, size: goals.length };
}

/** Goal ids this task moves, filed route first. Empty when it moves nothing. */
export function goalIdsForTask(idx: GoalIndex, task: TaskItem): string[] {
  if (idx.size === 0) return [];
  const out: string[] = [];
  const pid = task.data.projectId;
  if (pid) for (const g of idx.byProject.get(pid) ?? []) if (!out.includes(g)) out.push(g);
  for (const c of categoriesOf(task.data)) {
    for (const g of idx.byCategory.get(c) ?? []) if (!out.includes(g)) out.push(g);
  }
  return out;
}

/** Does finishing this task move anything the user is working toward? */
export function movesGoal(idx: GoalIndex, task: TaskItem): boolean {
  return goalIdsForTask(idx, task).length > 0;
}

/**
 * The goal title to show on a task, or null. One title, never a list: a row
 * that names three goals has stopped being a row. The filed route wins because
 * it is the deliberate one.
 */
export function goalTitleForTask(idx: GoalIndex, task: TaskItem): string | null {
  const ids = goalIdsForTask(idx, task);
  const first = ids[0];
  return first ? idx.titleOf.get(first) ?? null : null;
}

/** How many of these tasks move a goal. The goal-aware hero count (pick 5). */
export function countMovingGoals(idx: GoalIndex, tasks: TaskItem[]): number {
  if (idx.size === 0) return 0;
  return tasks.filter((t) => movesGoal(idx, t)).length;
}

/**
 * Earliest due first, undated after dated, original order breaking ties.
 * The tagged list leads with what is actually next rather than with whatever
 * the store happened to return first.
 */
export function byDue<T extends { due?: string | null }>(rows: T[]): T[] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const da = a.r.due || "9999-99-99";
      const db = b.r.due || "9999-99-99";
      return da === db ? a.i - b.i : da.localeCompare(db);
    })
    .map((x) => x.r);
}
