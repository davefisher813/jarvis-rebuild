export const ENTITY_AREA = "life_area";
export const ENTITY_GOAL = "goal";

export type AreaState = "strong" | "steady" | "drifting";
// "achieved" was missing entirely: a goal could be on track forever and never
// be finished. There was nothing to reach, and so nothing to celebrate.
export type GoalState = "on_track" | "steady" | "at_risk" | "achieved";

export interface AreaData { name: string; state: AreaState; order?: number; }
// Money v1 savings (2026-08-03): a goal may carry a dollar target. Progress is
// DERIVED from dated entries the user logged, never self-reported, and skipped
// purchases NEVER feed it (not-spending is not saving).
export interface SavedEntry { d: string; amount: number }
export interface GoalData { title: string; state: GoalState; areaId?: string; order?: number; moneyTarget?: number; saved?: SavedEntry[]; }
export interface Area { id: string; data: AreaData; }
export interface Goal { id: string; data: GoalData; }

// AREA_META was removed in Session 6: Life Areas have no UI, so a table of
// labels, colour classes and bar percentages described something nothing draws.
// AreaState and AreaData stay because existing records still hold them.
export const GOAL_META: Record<GoalState, { label: string; cls: string }> = {
  on_track: { label: "On track", cls: "ok" },
  steady: { label: "Steady", cls: "muted" },
  at_risk: { label: "At risk", cls: "attention" },
  achieved: { label: "Achieved", cls: "ok" },
};
export const AREA_STATES: AreaState[] = ["strong", "steady", "drifting"];
export const GOAL_STATES: GoalState[] = ["on_track", "steady", "at_risk", "achieved"];
