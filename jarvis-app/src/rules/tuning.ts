// TUNE THE AUTOMATION WHERE IT HAPPENS (UP-CORE-14, 2026-09-05).
//
// "The app itself": long-press any automated element and it writes a rule to
// What JARVIS Learned. The rule kind and the doctrine have existed since the
// Uncertainty Protocol shipped (rules/types.ts:9-13 names automation tunings
// outright), and exactly two tuning rules were ever written, both from the
// planner. Every other card JARVIS produces on its own could only be waved
// off for a day, over and over, forever.
//
// The deal this keeps is the one in types.ts: no learned behavior without a
// visible row, and deleting the row fully reverts it. Every choice here is a
// row in What JARVIS Learned, in words, with the card's own text as its
// evidence, and deleting it brings the card back.
//
// Three choices, and each one means something specific and small:
//   NEVER   retires that producer for good. Not "for a while": the card is
//           gone until the rule is deleted.
//   LESS    halves how often it may appear: it shows on alternate days.
//           Deliberately arithmetic on the DATE rather than a counter, so it
//           needs no storage, syncs by construction, and cannot drift.
//   MORE    lifts the card in the stream (stream.ts's own weights), which is
//           the only honest meaning of "more" for a producer that already
//           speaks whenever it has something to say. It never invents a card.

import type { LearnedRule } from "./LearnedRulesService";

export type TuningChoice = "more" | "less" | "never";

export const TUNING_SCOPE_PREFIX = "automation.";

// The producers a person can tune, and what to call them in a sentence. A
// card without a name here is not tunable, which is the difference between
// an automation and a thing the person did themselves.
export const AUTOMATION_LABEL: Record<string, string> = {
  "gap-fill": "Gap Fill",
  "goal-nudge": "Goal Nudges",
  momentum: "Keep Going",
  "sweep-receipt": "Auto-Sweep Receipts",
  "close-offer": "Finished Projects",
  birthday: "Birthday Heads-Up",
  "live-gym": "Back to Training",
  "mail-notice": "Mail Notices",
};

export function tuningScope(name: string): string {
  return TUNING_SCOPE_PREFIX + name;
}

// The tunings in force, from the rules list. One pass, so a surface reads the
// list once and asks about each of its cards.
export function tuningsFrom(rules: LearnedRule[]): Record<string, TuningChoice> {
  const out: Record<string, TuningChoice> = {};
  for (const r of rules) {
    if (r.data.kind !== "tuning" || !r.data.scope.startsWith(TUNING_SCOPE_PREFIX)) continue;
    if (r.data.from !== "frequency") continue;
    const to = r.data.to;
    if (to === "more" || to === "less" || to === "never") out[r.data.scope.slice(TUNING_SCOPE_PREFIX.length)] = to;
  }
  return out;
}

// Days since the epoch, from a local ISO date. The parity of this number is
// what "alternate days" means: it is the same answer on every device, needs
// nothing stored, and cannot fall out of step.
function dayNumber(todayIso: string): number {
  const [y, m, d] = todayIso.split("-").map(Number) as [number, number, number];
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / 86400000);
}

// May this producer speak today?
export function tuningAllows(tunings: Record<string, TuningChoice>, name: string, todayIso: string): boolean {
  const t = tunings[name];
  if (t === "never") return false;
  if (t === "less") return dayNumber(todayIso) % 2 === 0;
  return true;
}

// How much this producer's card is lifted in the stream. Only "more" moves
// anything, and it moves it by one band, never past a thing that is failing.
export const TUNING_BOOST = 10;
export function tuningWeight(tunings: Record<string, TuningChoice>, name: string, base: number): number {
  return tunings[name] === "more" ? base + TUNING_BOOST : base;
}

// The row in What JARVIS Learned, in words rather than in scope strings.
// Null for a rule that is not an automation tuning, so the caller keeps its
// existing sentence for those.
export function tuningLine(r: LearnedRule): string | null {
  if (r.data.kind !== "tuning" || !r.data.scope.startsWith(TUNING_SCOPE_PREFIX)) return null;
  const name = r.data.scope.slice(TUNING_SCOPE_PREFIX.length);
  const label = AUTOMATION_LABEL[name] ?? name;
  if (r.data.to === "never") return `${label} · Never show`;
  if (r.data.to === "less") return `${label} · Show less often`;
  if (r.data.to === "more") return `${label} · Show more often`;
  return null;
}
