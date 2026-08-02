export const ENTITY_PROJECT = "project";
export type ProjectStatus = "active" | "on_hold" | "done";

// goalId completes the roadmap's goal -> project -> task chain, so progress can
// be DERIVED from real task completion instead of typed in by hand.
export interface ProjectData { title: string; category?: string; status: ProjectStatus; order?: number; goalId?: string; }
export interface Project { id: string; data: ProjectData; }

export const PROJECT_META: Record<ProjectStatus, { label: string; cls: string }> = {
  active: { label: "Active", cls: "ok" },
  on_hold: { label: "On hold", cls: "muted" },
  done: { label: "Done", cls: "mute" },
};
export const PROJECT_STATES: ProjectStatus[] = ["active", "on_hold", "done"];
