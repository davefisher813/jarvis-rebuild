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
}
export interface Project { id: string; data: ProjectData; }

export const PROJECT_META: Record<ProjectStatus, { label: string; cls: string }> = {
  active: { label: "Active", cls: "ok" },
  on_hold: { label: "On hold", cls: "muted" },
  done: { label: "Done", cls: "mute" },
};
export const PROJECT_STATES: ProjectStatus[] = ["active", "on_hold", "done"];
