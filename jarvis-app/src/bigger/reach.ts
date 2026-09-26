import type { TaskItem } from "../tasks/TasksService";
import type { Project } from "../projects/types";
import type { Goal } from "../life/types";
import type { Progress } from "./progress";
import { lineCase } from "../shared/casing";

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

/**
 * LIFE-F-26 (2026-09-05): the goals a project can be FILED to. The pickers
 * offered every goal, so you could file a project under one that was achieved
 * or dropped and it would then show under its category as if unfiled. This is
 * liveGoals with one exception: the goal a project is ALREADY under stays in
 * the list even when it stopped counting, or the menu would read None for a
 * value that is really set.
 */
export function fileableGoals(goals: Goal[], currentId?: string): Goal[] {
  return goals.filter((g) => (g.data.state !== "achieved" && !g.data.dropped) || g.id === currentId);
}

/** The goal picker's options for a task or event sheet (2026-09-26): the
 *  fileable goals, as the id-and-title pair the sheets take. */
export function sheetGoals(goals: Goal[], currentId?: string): { id: string; title: string }[] {
  return fileableGoals(goals, currentId).map((g) => ({ id: g.id, title: g.data.title }));
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
  // A GOAL OWNS WHAT WAS FILED TO IT, AND NOTHING ELSE (Dave 2026-09-13, from
  // two goal pages on his phone: "what is going on with the logic? Why are all
  // of these random tasks and projects and goals combining? Figure out what's
  // wrong and fix it... I can't even manually clean it up").
  // The tagged route below this note was architecture C: every open task in
  // an area a goal watched counted as that goal's work. Two goals watching
  // Bridge showed the same Bridge tasks, a goal row said "5 tagged open" about
  // work nobody put there, and none of it could be cleaned up by hand because
  // nothing had ever been attached. The route is closed. A goal's tags still
  // say which area it lives under; its work is the projects filed to it.
  // taggedIds and openTagged stay on the shape, always empty, so every reader
  // of a reach keeps compiling and reads the honest zero.
  const projIds = new Set(projectsOfGoal(projects, goal.id).map((p) => p.id));

  const filedIds: string[] = [];
  const taggedIds: string[] = [];
  const openTagged = 0;
  let filedDone = 0;

  for (const t of tasks) {
    const pid = t.data.projectId;
    if (pid && projIds.has(pid)) {
      filedIds.push(t.id);
      if (t.data.done) filedDone++;
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
export function reachLine(r: GoalReach, done = false): string {
  // A FINISHED GOAL DOES NOT ADVERTISE WORK IT NEVER OWNED (2026-09-06).
  // Dave's screenshot: "Get Health Insurance / DONE / 9 Tasks open". The nine
  // were tagged, not filed: open tasks in an area this goal watches, none of
  // them about health insurance. On a live goal that count is a useful filter
  // and it says so. On a finished one it is a contradiction in the same
  // three lines, so the honest line is the filed record, or silence.
  // Silence, not the word: with no filed record this said "Done" under a
  // hero whose status already says it (§AK, 2026-09-26), which is the "says
  // done twice" shape Dave objected to on the Goals lens.
  // Title Case on the line, "0 of 1 Projects Done" (Dave's pass-off,
  // 2026-09-26: every word the app writes, the last one included).
  if (done) {
    const p0 = r.progress;
    return p0 ? lineCase(`${p0.done} of ${p0.total} done`) : "";
  }
  const p = r.progress;
  // Filed work only (2026-09-13): no "tagged open" tail, no open count borrowed
  // from an area.
  if (p) return lineCase(`${p.done} of ${p.total} done`);
  // PLAIN WORDS (Dave 2026-09-03, pic 4: "'open in your tags' maybe just
  // open or something"). "In your tags" is this file's own vocabulary
  // leaking onto a goal row: the reader does not think in tags, and the
  // line has to say only what is true, which is that some work under this
  // goal is still open. The sibling line above names its noun ("2 of 5
  // Projects done"), so this one does too, and stops there.
  //
  // AND WHEN THERE IS NOTHING, IT SAYS NOTHING (§AK, 2026-09-21). This
  // returned "Nothing under it yet", which drew a grey line with no
  // information in it under every goal that had no work yet -- six in a
  // row on Dave's screen. A placeholder is exactly the grey subtext the
  // ruling is about. The row with nothing under it shows nothing under it.
  return "";
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

/** Goal ids this task moves: the goal its project is filed to. Empty when it
 *  moves nothing. Sharing an area with a goal is not moving it (Dave
 *  2026-09-13); byCategory stays on the index for listing a goal under its
 *  area, never for claiming a task. */
export function goalIdsForTask(idx: GoalIndex, task: TaskItem): string[] {
  if (idx.size === 0) return [];
  const out: string[] = [];
  // THE PICKED GOAL FIRST (Dave's pass-off, 2026-09-26). A task filed to a
  // goal on its sheet moves that goal; the project chain still answers for
  // every task filed before the pick existed. A pick on a goal that is no
  // longer live (not in the index) moves nothing, like a stale project.
  const gid = task.data.goalId;
  if (gid && idx.titleOf.has(gid)) out.push(gid);
  const pid = task.data.projectId;
  if (pid) for (const g of idx.byProject.get(pid) ?? []) if (!out.includes(g)) out.push(g);
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

// LIFE-F-22 (2026-09-05): countMovingGoals had no caller. The goal-aware
// hero count it was written for renders through reachLine now, and movesGoal
// above is what the rows themselves ask.

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
