import type { Project } from "../../projects/types";
import type { Goal } from "../../life/types";
import type { Person } from "../../people/types";
import type { SheetProject } from "./TaskSheet";

// THE ONE BUILDER FOR THE SHEET'S LINKS (Dave 2026-09-16: "Why do some have
// goals and some don't? They should all have the same 5 options"; Dave's
// pass-off, 2026-09-26). Five screens open the task sheet and each built the
// Project list by hand, two never handed over people or events at all, so
// Where read as four fields on one screen and three on another. The lists
// are built here, once, from the records every flow already holds, so a
// screen cannot hand the sheet a different shape of project than the next.
// Events keep their own builder (schedule/sheetEvents.ts): they need a day.

/** A project as the sheet's Project menu takes it: its area, so a pick can
 *  fill the Area row, and the LIVE goal it climbs to, so a pick answers the
 *  Goal row (a goal that is achieved or dropped is not offered). */
export function sheetProjects(projects: Project[], goals: Goal[]): SheetProject[] {
  const live = new Map(goals.filter((g) => !g.data.dropped && g.data.state !== "achieved").map((g) => [g.id, g.data.title] as const));
  return projects.map((p) => {
    const gid = p.data.goalId && live.has(p.data.goalId) ? p.data.goalId : undefined;
    return {
      id: p.id,
      title: p.data.title,
      category: p.data.category || undefined,
      ...(gid ? { goalId: gid, goalTitle: live.get(gid) } : {}),
    };
  });
}

/** A contact as the sheet's Person menu takes it. */
export function sheetPeople(people: Person[]): { id: string; name: string }[] {
  return people.map((p) => ({ id: p.id, name: p.data.name }));
}
