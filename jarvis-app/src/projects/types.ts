export const ENTITY_PROJECT = "project";
export type ProjectStatus = "active" | "on_hold" | "done";

export interface ProjectData { title: string; category?: string; status: ProjectStatus; order?: number; }
export interface Project { id: string; data: ProjectData; }

export const PROJECT_META: Record<ProjectStatus, { label: string; cls: string }> = {
  active: { label: "Active", cls: "good" },
  on_hold: { label: "On hold", cls: "warn" },
  done: { label: "Done", cls: "mute" },
};
export const PROJECT_STATES: ProjectStatus[] = ["active", "on_hold", "done"];
