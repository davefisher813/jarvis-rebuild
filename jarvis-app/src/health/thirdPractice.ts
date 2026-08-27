// THE THIRD PRACTICE (catalog Part 2, rank #1). Detects when one day carries
// more than one sport commitment across DIFFERENT orgs -- school team,
// travel team, private trainer -- and names it as a fact once, with an
// offer. Never a warning, never red, never a recurring nag: this file
// returns one row per calendar day with more than one distinct org, and the
// caller is responsible for showing it once per occurrence, not repeating it.

import type { SportSession } from "./loadCandidates";

export interface ThirdPracticeFact {
  date: string;
  orgs: string[]; // distinct orgs that day, in the order first seen
  count: number; // orgs.length, named for readability at the call site
}

export function thirdPracticeDays(sessions: SportSession[]): ThirdPracticeFact[] {
  const byDate = new Map<string, string[]>();
  for (const s of sessions) {
    const orgs = byDate.get(s.date) ?? [];
    if (!orgs.includes(s.org)) orgs.push(s.org);
    byDate.set(s.date, orgs);
  }
  const out: ThirdPracticeFact[] = [];
  for (const [date, orgs] of byDate) {
    if (orgs.length >= 2) out.push({ date, orgs, count: orgs.length });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export type ThirdPracticeAction = "protect_gap" | "move_task" | "add_ride";

export interface ThirdPracticeOffer {
  fact: ThirdPracticeFact;
  action: ThirdPracticeAction;
  line: string;
}

/** The fact, stated once, paired with an offer -- never a verdict about
 *  whether the day is too much. */
export function thirdPracticeOffers(sessions: SportSession[]): ThirdPracticeOffer[] {
  return thirdPracticeDays(sessions).map((fact) => ({
    fact,
    action: "protect_gap",
    line: fact.count + " Sport Commitments, One Day",
  }));
}
