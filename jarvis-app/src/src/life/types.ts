export const ENTITY_AREA = "life_area";
export const ENTITY_GOAL = "goal";

export type AreaState = "strong" | "steady" | "drifting";
export type GoalState = "on_track" | "steady" | "at_risk";

export interface AreaData { name: string; state: AreaState; order?: number; }
export interface GoalData { title: string; state: GoalState; areaId?: string; order?: number; }
export interface Area { id: string; data: AreaData; }
export interface Goal { id: string; data: GoalData; }

// state -> label, color class suffix (good/warn/bad), bar fill percent
export const AREA_META: Record<AreaState, { label: string; cls: string; pct: number }> = {
  strong: { label: "Strong", cls: "good", pct: 85 },
  steady: { label: "Steady", cls: "warn", pct: 55 },
  drifting: { label: "Drifting", cls: "bad", pct: 30 },
};
export const GOAL_META: Record<GoalState, { label: string; cls: string }> = {
  on_track: { label: "On track", cls: "good" },
  steady: { label: "Steady", cls: "warn" },
  at_risk: { label: "At risk", cls: "bad" },
};
export const AREA_STATES: AreaState[] = ["strong", "steady", "drifting"];
export const GOAL_STATES: GoalState[] = ["on_track", "steady", "at_risk"];
