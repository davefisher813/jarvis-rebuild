import type { LearnedRule } from "../rules/LearnedRulesService";
import { DRAFT_EDIT_SENTENCE, type DraftEditKind } from "../messages/draftEdit";

// THE WRITING PROPOSAL (C-56, Astra, 2026-09-12). Two identical draft edits
// make a voice rule (scope draft.edit). The rule's first use is not a toast
// here: it is a NEEDS CONFIRMATION row in Needs You and on How You Write,
// and That's Right accepts it into a writing strand with a channel. Until
// he answers, the rule stays unannounced, which is the doctrine's own
// "visibility licenses creation" honoured in the one place a voice rule
// is visible.

export const DRAFT_EDIT_SCOPE = "draft.edit";

export interface WritingProposal { rule: LearnedRule; kind: DraftEditKind; text: string; edits: number }

export function writingProposals(rules: LearnedRule[]): WritingProposal[] {
  return rules
    .filter((r) => r.data.kind === "voice" && r.data.scope === DRAFT_EDIT_SCOPE && !r.data.announced)
    .map((r) => {
      const kind = r.data.from as DraftEditKind;
      const text = DRAFT_EDIT_SENTENCE[kind];
      return text ? { rule: r, kind, text, edits: r.data.evidence.length } : null;
    })
    .filter((p): p is WritingProposal => p !== null);
}
