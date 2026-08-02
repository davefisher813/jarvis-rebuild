export const ENTITY_AREA = "life_area";
export const ENTITY_GOAL = "goal";

export type AreaState = "strong" | "steady" | "drifting";
export type GoalState = "on_track" | "steady" | "at_risk";

export interface AreaData { name: string; state: AreaState; order?: number; }
export interface GoalData { title: string; state: GoalState; areaId?: string; order?: number; }
export interface Area { id: string; data: AreaData; }
export interface Goal { id: string; data: GoalData; }

// AREA_META was removed in Session 6: Life Areas have no UI, so a table of
// labels, colour classes and bar percentages described something nothing draws.
// AreaState and AreaData stay because existing records still hold them.
export const GOAL_META: Record<GoalState, { label: string; cls: string }> = {
  on_track: { label: "On track", cls: "ok" },
  steady: { label: "Steady", cls: "muted" },
  at_risk: { label: "At risk", cls: "attention" },
};
export const AREA_STATES: AreaState[] = ["strong", "steady", "drifting"];
export const GOAL_STATES: GoalState[] = ["on_track", "steady", "at_risk"];
