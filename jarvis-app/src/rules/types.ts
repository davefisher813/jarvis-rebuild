// Learned rules (Uncertainty Protocol, addendum item 25; unification law from
// the editing coverage map). One entity, one list, one doctrine:
//
// - A rule is born from TWO identical corrections, never from one, never
//   from a guess. The pair of observed corrections is its evidence.
// - Every rule announces itself on first use. Visibility is what licenses
//   creating it without a tap.
// - A rule dies instantly on ONE contradiction and never generalizes past
//   its scope.
// - ALL learned behavior lands here: aliases ("practice" means Elite Squad),
//   automation tunings (More Like This / Less of This / Never), and voice
//   learnings from edited-draft diffs. No learned behavior may exist without
//   a row in this list, and deleting the row fully reverts the behavior
//   (laws-as-tests).

export const ENTITY_LEARNED_RULE = "learned_rule";

export type RuleKind = "alias" | "tuning" | "voice";

export interface LearnedRuleData {
  kind: RuleKind;
  // Where the rule applies and nowhere else, e.g. "capture.category" or
  // "automation.weather-line" or "voice.email.vendor".
  scope: string;
  // The trigger within that scope, e.g. "practice".
  from: string;
  // What it resolves to, e.g. a category id, "less", "never", or a voice note.
  to: string;
  // The observed corrections that created it, human-readable, shown in
  // What JARVIS Learned. Facts, not editable; delete the rule instead.
  evidence: string[];
  createdAt: string;
  // First-use announcement delivered (rules announce exactly once).
  announced?: boolean;
}
