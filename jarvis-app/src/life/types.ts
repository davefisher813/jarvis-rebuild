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
// ARCHITECTURE C (2026-08-22): `tags` are category ids the goal WATCHES. A
// task in one of them is work toward this goal with no filing at all, which
// is the half the app never had: projects pointed down at tasks and nothing
// pointed back up. Tags are a saved filter, never a scoreboard, so they feed
// the goal's open-work count and NEVER its done/total (see bigger/reach.ts
// for why: an ordinary task carries no completion date, so a freshly tagged
// goal would inherit every closed task in that category).
export interface GoalData { title: string; state: GoalState; areaId?: string; order?: number; moneyTarget?: number; saved?: SavedEntry[]; tags?: string[]; }
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
// AREA_STATES/GOAL_STATES lists were removed in the 2026-08-10 audit: nothing
// anywhere iterated them. The union types above are the source of truth.
