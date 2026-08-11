import type { Category, CategoryData, CategoryKind } from "./types";

// Kind derivation (2026-08-03). suggestKind maps a category NAME to a kind so
// existing categories get sensible pages with zero setup. Deliberately
// conservative: unknown names are plain, because a wrong module block is worse
// than the skeleton. NEVER auto-written to storage; the editor's save makes a
// kind explicit. effectiveKind is the one lookup every surface uses.

const ORG_NAMES = ["work", "job", "office", "business", "company", "clients", "operations", "sales", "admin", "school", "org"];
const PEOPLE_NAMES = ["family", "friends", "people", "team"];
const MONEY_NAMES = ["money", "finance", "finances", "budget", "bills"];
const HEALTH_NAMES = ["health", "fitness", "gym", "wellness", "training"];

export function suggestKind(name: string): CategoryKind {
  const n = name.trim().toLowerCase();
  if (ORG_NAMES.includes(n)) return "org";
  if (PEOPLE_NAMES.includes(n)) return "people";
  if (MONEY_NAMES.includes(n)) return "money";
  if (HEALTH_NAMES.includes(n)) return "health";
  return "plain";
}

export function effectiveKind(data: CategoryData): CategoryKind {
  return data.kind ?? suggestKind(data.name);
}

/** Categories whose suggestions are paused (Season). Bills are exempt at the call sites. */
export function pausedCategoryIds(categories: Category[]): Set<string> {
  return new Set(categories.filter((c) => c.data.season === "paused").map((c) => c.id));
}

/**
 * Work-hours categories go quiet outside the work window (audit 2026-08-10:
 * placement respected work hours but suggestions kept offering work tasks at
 * 9 PM). Only suggestion OFFERS are gated; the tasks themselves, receipts,
 * and deliberate navigation are untouched. No routine or an inverted window
 * means no gating, matching workWindowOf's own validity rule.
 */
export function offHoursCategoryIds(
  categories: Category[],
  routine: { workStartMin: number; workEndMin: number } | null,
  nowMin: number,
): Set<string> {
  if (!routine || !(routine.workEndMin > routine.workStartMin)) return new Set();
  if (nowMin >= routine.workStartMin && nowMin < routine.workEndMin) return new Set();
  return new Set(categories.filter((c) => c.data.workHours).map((c) => c.id));
}
