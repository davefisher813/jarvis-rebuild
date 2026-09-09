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
// The upward look is the filed project first, then the category. It was
// "project, then the goal a task moves, then the category" until 2026-09-06;
// see parentForTask for why the middle step could never state a real fact.
// The only new fact here is the project's progress, which is why this module
// takes the task list.

import type { TaskItem } from "../tasks/TasksService";
import type { Project } from "../projects/types";
import type { EventItem } from "../schedule/types";
import type { Goal } from "./types";
import { catColor, catName } from "../shared/categories";
import { projectProgress } from "../bigger/progress";

export type ParentKind = "event" | "project" | "goal" | "category";

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
  /** EVENTS ARE FIRST-CLASS (2026-09-09). An event a task belongs to, by the
   *  event's own id. Empty for a caller that has no events to hand, which is
   *  every caller that has not been given them yet: an absent index reads as
   *  "no event parent" and the row falls through to the project it always
   *  used, so this could be added without touching a single call site. */
  events: Map<string, { title: string; tone: string }>;
}

/** Build once per render pass; every row on the page reads from it.
 *  `goals` is still taken so every call site keeps its shape, and because a
 *  task that can be filed to a goal directly would read it again. */
export function buildParentIndex(projects: Project[], _goals: Goal[], tasks: TaskItem[], events: EventItem[] = []): ParentIndex {
  const pmap = new Map<string, { title: string; tone: string; pct: number | null }>();
  for (const p of projects) {
    pmap.set(p.id, {
      title: p.data.title,
      tone: "cat-fg-" + catColor(p.data.category ?? ""),
      pct: projectProgress(tasks, p.id)?.pct ?? null,
    });
  }
  const emap = new Map<string, { title: string; tone: string }>();
  for (const e of events) {
    emap.set(e.id, { title: e.data.title, tone: "cat-fg-" + catColor(e.data.category ?? "") });
  }
  return { projects: pmap, events: emap };
}

/** Where this task lives, or null when it has no project, no goal and no category. */
export function parentForTask(idx: ParentIndex, task: TaskItem): ParentLine | null {
  // THE EVENT COMES FIRST (2026-09-09). A task filed to an event is DEFINED by
  // it: the roster has to be printed before Saturday's tournament, and that is
  // a stronger statement of where the task lives than the project it also sits
  // in. A task with both still belongs to the project; the row says the thing
  // that decides when it has to happen, and the project is one tap away on the
  // sheet. A task with no event falls straight through to the line this
  // function has always drawn.
  const eid = task.data.eventId;
  const e = eid ? idx.events.get(eid) : undefined;
  if (e) return { kind: "event", name: e.title, tone: e.tone, pct: null };
  const pid = task.data.projectId;
  const p = pid ? idx.projects.get(pid) : undefined;
  if (p) return { kind: "project", name: p.title, tone: p.tone, pct: p.pct };
  // WHERE A TASK LIVES IS A LINK SOMEONE MADE, NOT A FILTER THAT MATCHES IT
  // (2026-09-06, Dave: "unlabeled tasks randomly go into projects and goals
  // that have nothing to do with them").
  //
  // This line used to ask goalIdsForTask, which answers "which goals does
  // this task MOVE" and counts a tag match. A tag is a saved filter over a
  // CATEGORY: tag the goal "Make apartment aesthetic" with Personal and every
  // Personal task in the app starts claiming that goal as its home. Submit
  // job apps read as apartment work. Check WWBA read as apartment work.
  //
  // A task carries projectId and nothing else pointing up (notes/types.ts:
  // there is no goalId on a task), so the branch that stood here could ONLY
  // ever fire on a tag. It was never able to state a real one, which is why
  // deleting it loses nothing: a task filed through a project already
  // answered above, and a loose task lives in its area, which is true and is
  // what the row now says.
  //
  // reach.ts's own law still holds everywhere it belongs: tags feed what a
  // task MOVES (ranking, Plan My Day, the goal page's own From Your Areas
  // list, which says "from your areas" and means it). They do not feed where
  // it lives.
  const cat = task.data.category;
  const name = cat ? catName(cat) : "";
  if (!name) return null;
  return { kind: "category", name, tone: "cat-fg-" + catColor(cat), pct: null };
}
