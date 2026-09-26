export const ENTITY_PROJECT = "project";
export type ProjectStatus = "active" | "on_hold" | "done";

// goalId completes the roadmap's goal -> project -> task chain, so progress can
// be DERIVED from real task completion instead of typed in by hand.
// PICK 20 (2026-08-24): holdUntil is the day a parked project comes back.
// "On hold" with no date is a project that disappeared, and the list had no
// way to tell one from a project that was simply never started.
export interface ProjectData {
  title: string; category?: string; status: ProjectStatus; order?: number; goalId?: string; holdUntil?: string;
  // Stamped by ProjectsService.update on the transition INTO done (audit
  // 2026-08-25), so the monthly report can name the month's closures.
  closedOn?: string;
  // UP-CORE-18 (2026-09-05): the day this is due. A school project due
  // Friday and a client deliverable due the 30th are the same shape, and a
  // project could hold neither: it had a status, an order, a goal and a hold
  // date, and no deadline at all. Optional, so a project without one behaves
  // exactly as every project did before.
  due?: string;
}
export interface Project { id: string; data: ProjectData; }

// §AM, the Colour Key (2026-09-22): green means done. A project that is
// merely active is not done or on track, so its word is the grey; the green
// it wore belongs to Done, which had lost it.
export const PROJECT_META: Record<ProjectStatus, { label: string; cls: string }> = {
  active: { label: "Active", cls: "muted" },
  on_hold: { label: "On Hold", cls: "muted" },
  done: { label: "Done", cls: "ok" },
};
export const PROJECT_STATES: ProjectStatus[] = ["active", "on_hold", "done"];
