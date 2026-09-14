// Decision Record (brainstorm shipment 1). No AI, four fields, one payoff:
// six weeks later the reason you chose this is still here. Entities are
// decision_record rows (registry migration 0025, same commit).

export const ENTITY_DECISION = "decision_record";

// What a decision can attach to. The link is what colors the list glyph and
// what surfaces the payoff banner on the linked record's page.
export type DecisionLinkType = "project" | "goal" | "org" | "person" | "task";

// Revisit lifecycle. none = no date set. pending = date set, not reached or
// not yet shown. shown = it rendered on Today today. confirmed = Still Good.
// expired = the day passed without an answer; it never renders after that.
// Ignored means gone, not repeated.
export type RevisitState = "none" | "pending" | "shown" | "confirmed" | "expired";

// C-53 (Astra, 2026-09-12): where a decision came from, what he expected of
// it, and how it turned out. All optional; a record written before this
// date reads exactly as it did.
export type DecisionSourceKind = "chat" | "note" | "email" | "manual";
export interface DecisionSource { kind: DecisionSourceKind; entityId?: string; at: string }
export type OutcomeWord = "worked" | "mixed" | "didnt";
export interface DecisionLink { type: DecisionLinkType; id: string; label: string }

export interface DecisionRecordData {
  // The decision, one line. The only required field; Save is never disabled.
  decision: string;
  // The reason you will forget. Optional; empty renders "No reason recorded".
  why?: string;
  // THE NOTES (the writing system, wave 3c): the longer thinking under a
  // decision, as Markdown from the shared editor. Optional structure: a
  // decision with one line stays one line.
  notes?: string;
  // The options you closed. The block that stops you relitigating.
  ruledOut?: string[];
  // Attached To. The triple stays for every record written before C-53 and
  // is read as links[0]; new writes fill both so an old reader still works.
  linkedType?: DecisionLinkType;
  linkedId?: string;
  linkedLabel?: string;
  links?: DecisionLink[];
  // C-53
  source?: DecisionSource;
  expected?: string;
  outcome?: { word: OutcomeWord; at: string };
  // C-54: the values strand this decision became, when he made it a rule.
  // One memory, two relationships: the strand carries the decision as its
  // link, the decision carries the strand here.
  ruleStrandId?: string;
  // Revisit day (local ISO date, YYYY-MM-DD) and its lifecycle.
  revisitOn?: string;
  revisitState?: RevisitState;
  confirmedAt?: string; // ISO datetime stamped by Still Good
  // The supersede chain. A reversal links, it never deletes.
  supersedesId?: string;
  supersededById?: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface DecisionRecord {
  id: string;
  data: DecisionRecordData;
}

// Every home a decision is attached to, old shape and new read as one list.
export function linksOf(d: DecisionRecordData): DecisionLink[] {
  if (d.links && d.links.length > 0) return d.links;
  if (d.linkedType && d.linkedId) return [{ type: d.linkedType, id: d.linkedId, label: d.linkedLabel ?? "" }];
  return [];
}

export const OUTCOME_LABEL: Record<OutcomeWord, string> = { worked: "Worked", mixed: "Mixed", didnt: "Didn't" };
export const SOURCE_LABEL: Record<DecisionSourceKind, string> = { chat: "Chat", note: "Note", email: "Email", manual: "Manual" };
