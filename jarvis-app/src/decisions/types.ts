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

export interface DecisionRecordData {
  // The decision, one line. The only required field; Save is never disabled.
  decision: string;
  // The reason you will forget. Optional; empty renders "No reason recorded".
  why?: string;
  // The options you closed. The block that stops you relitigating.
  ruledOut?: string[];
  // Attached To.
  linkedType?: DecisionLinkType;
  linkedId?: string;
  linkedLabel?: string;
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
