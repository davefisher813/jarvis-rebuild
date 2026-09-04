// Strands: Brain Layer 2 (queue item 04, design in claude/BRAIN_REBUILD_DESIGN.md).
// A strand is one plain-language fact about the user, one line, categorized,
// visible, editable. The genome, not the log: low-volume, so it rides the
// item table (registry migration 0027).
//
// Doctrine carried in the shape:
// - source ranks: told outranks everything, and told is EARNED (typed or
//   corrected in the app). watched carries evidence receipts. asked is a
//   half-attention self-report that watched data may later challenge.
// - strength: influence biases, rule binds. Rules are ONLY user-stated;
//   nothing in the app ever promotes an influence to a rule.
// - evidence is typed numbers and days, never free text, matching the event
//   log's own payload law: receipts render from numbers at display time.

export const ENTITY_STRAND = "strand";

export type StrandCategory = "energy" | "work_style" | "writing" | "people" | "values" | "routine";
export type StrandSource = "watched" | "asked" | "told" | "uploaded";
export type StrandStrength = "influence" | "rule";
export type StrandStatus = "active" | "paused";

// The launch derivations: the only facts the log honestly supports.
//
// The first four were the launch set (design doc, locked). The next two are
// the Brain build handoff's item 3, "one new detector per newly-instrumented
// module", and they land under exactly the gates the original four use:
//
//   training_window  reads workout rows that have been in the durable log
//                    since the gym shipped. Nothing new was instrumented for
//                    it. Every derivation filtered them out (taskDone drops
//                    kind "workout", correctly, because a session is not a
//                    task) and then nothing else read them, so a month of
//                    real training taught the Brain nothing. It does now.
//   email_window     reads email.handled, the semantic act added for it.
//
// Both are the same three-hour band shape completion_window proved, sharing
// completionBand() so there is one definition of "when does this happen" and
// four readers of it.
export type DerivationKey =
  | "completion_window" | "slip_category" | "plan_rate" | "task_timing"
  | "training_window" | "email_window";

// One receipt. Meaning of a/b depends on the derivation and is decided by the
// renderer: completion_window a=hour; slip_category a=count;
// plan_rate a=done b=picked; task_timing a=planned b=committed minutes.
export interface StrandEvidence { day: string; a?: number; b?: number }

export interface StrandData {
  text: string;
  category: StrandCategory;
  source: StrandSource;
  strength: StrandStrength;
  status: StrandStatus;
  createdAt: string; // ISO date
  // ISO date. Written on accept, on a re-derivation, on an edit, and by
  // confirm(); READ by the Brain page, which shows "Confirmed 12 Aug".
  //
  // The comment here used to say "strands expire, confirmation refreshes".
  // Nothing expires. No code anywhere reads this date and acts on it, and a
  // strand from March is exactly as loud today as one confirmed this morning.
  // Corrected rather than implemented (2026-08-24) because an expiry policy
  // is a decision about JARVIS quietly forgetting things it was told, and how
  // long is long enough is Dave's call, not a number to invent in a type.
  lastConfirmed: string;
  derivation?: DerivationKey; // watched strands only: which derivation said it
  evidence?: StrandEvidence[]; // watched strands only, capped
}

export interface Strand {
  id: string;
  data: StrandData;
}

export const STRAND_CATEGORY_LABEL: Record<StrandCategory, string> = {
  energy: "Energy",
  work_style: "Work Style",
  writing: "Writing",
  people: "People",
  values: "Values",
  routine: "Routine",
};

// Genome constraints (design doc): the whole point is ten certain facts over
// fifty maybes. Caps enforced at creation time by the service.
export const STRAND_CAP_TOTAL = 50;
export const STRAND_CAP_PER_CATEGORY = 12;
export const EVIDENCE_CAP = 6;
