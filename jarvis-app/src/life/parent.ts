// THE PARENT LINE (The Row and Health, Dave 2026-09-02: "The parent's own
// glyph leads the line"; on the two-word short names and the green marks
// before it: "very, very sloppy this whole goals thing").
//
// A task row's second line says where the task lives, and it says it the
// way the Projects and Goals pages already do: with the parent's OWN glyph,
// in its category colour, then the parent's full name in plain grey. The
// project's pie (filling as the project closes), the goal's target when a
// task hangs straight off a goal, the category dot when it is loose.
// Nothing invented, nothing shortened, one glyph per kind learned once.
//
// The upward look is the same one Today has always used (reach.ts): the
// filed project first, then the goal a task moves, then the category. The
// only new fact here is the project's progress, which is why this module
// takes the task list.

import type { TaskItem } from "../tasks/TasksService";
import type { Project } from "../projects/types";
import type { Goal } from "./types";
import { catColor, catName, goalTone } from "../shared/categories";
import { buildGoalIndex, goalIdsForTask, liveGoals, type GoalIndex } from "../bigger/reach";
import { projectProgress } from "../bigger/progress";

export type ParentKind = "project" | "goal" | "category";

export interface ParentLine {
  kind: ParentKind;
  name: string;
  /** A cat-fg-* class: the colour the glyph wears. */
  tone: string;
  /** Project progress, 0-100; null for a project with no tasks and for every other kind. */
  pct: number | null;
}

export interface ParentIndex {
  projects: Map<string, { title: string; tone: string; pct: number | null }>;
  goals: GoalIndex;
  goalTone: Map<string, string>;
}

/** Build once per render pass; every row on the page reads from it. */
export function buildParentIndex(projects: Project[], goals: Goal[], tasks: TaskItem[]): ParentIndex {
  const live = liveGoals(goals);
  const pmap = new Map<string, { title: string; tone: string; pct: number | null }>();
  for (const p of projects) {
    pmap.set(p.id, {
      title: p.data.title,
      tone: "cat-fg-" + catColor(p.data.category ?? ""),
      pct: projectProgress(tasks, p.id)?.pct ?? null,
    });
  }
  const gtone = new Map<string, string>();
  for (const g of live) gtone.set(g.id, goalTone(g.data.tags));
  return { projects: pmap, goals: buildGoalIndex(projects, live), goalTone: gtone };
}

/** Where this task lives, or null when it has no project, no goal and no category. */
export function parentForTask(idx: ParentIndex, task: TaskItem): ParentLine | null {
  const pid = task.data.projectId;
  const p = pid ? idx.projects.get(pid) : undefined;
  if (p) return { kind: "project", name: p.title, tone: p.tone, pct: p.pct };
  const gid = goalIdsForTask(idx.goals, task)[0];
  if (gid) {
    const title = idx.goals.titleOf.get(gid);
    if (title) return { kind: "goal", name: title, tone: idx.goalTone.get(gid) ?? "cat-fg-brand", pct: null };
  }
  const cat = task.data.category;
  const name = cat ? catName(cat) : "";
  if (!name) return null;
  return { kind: "category", name, tone: "cat-fg-" + catColor(cat), pct: null };
}
