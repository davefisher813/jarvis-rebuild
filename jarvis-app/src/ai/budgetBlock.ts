// The client's memory of a budget refusal. One value, in memory only: a new
// session starts open and the first call the person asks for finds out.
//
// Why it exists: background callers (triage, briefs, pre-generation) retry on
// failure. At the cap that is a retry storm against a server that will refuse
// every one. After the first refusal they stop asking until something changes:
// the limit is saved (clearBudgetBlock), or a call the person asked for goes
// through, which proves there is room again.

import type { AIBudgetError } from "./aiBudget";

let blocked: AIBudgetError | null = null;

export function budgetBlocked(): AIBudgetError | null {
  return blocked;
}

export function noteBudgetRefusal(e: AIBudgetError): void {
  // A replay is about one request id, not about money: it says nothing about
  // whether the next call would be refused.
  if (e.code === "AI_BUDGET_REPLAY") return;
  blocked = e;
}

export function clearBudgetBlock(): void {
  blocked = null;
}
