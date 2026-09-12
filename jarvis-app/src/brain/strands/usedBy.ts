import type { StrandCategory } from "./types";

// USED BY (C-43, Astra, 2026-09-12). Which surfaces read a strand of each
// category. A static map, on purpose: the truth is in ai/context.ts's packs
// and the surfaces that call them, and this is the plain-words version he
// can read on the row. When a pack gains or loses a category, this line is
// the one to update with it; the usedBy test pins the shape, not the truth.
export const USED_BY: Record<StrandCategory, readonly string[]> = {
  energy: ["Schedule", "Plan My Day", "Your Move"],
  routine: ["Schedule", "Plan My Day"],
  work_style: ["Your Move", "Plan My Day"],
  writing: ["Email"],
  people: ["Email", "Contacts"],
  values: ["Your Move", "Schedule", "Decisions"],
};

export function usedBy(category: StrandCategory): readonly string[] {
  return USED_BY[category] ?? [];
}
