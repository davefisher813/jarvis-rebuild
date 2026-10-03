// EXPLORATION NOTE (IMPLEMENTATION-SPEC.md sections 03.1 and 06). A Mentioned
// item the person chose to keep: "Keep as note". A committed record in `item`
// (registered by migration 0044), but never a decision: it cannot enter an
// active-constraint query, a context package's committed set, or a dependency.
// Promotion to a decision is a separate explicit act that writes a decision
// item and its first version.

export const ENTITY_EXPLORATION_NOTE = "exploration_note";

export interface ExplorationNoteData {
  text: string;
  projectId?: string;
  /** source_evidence ids, or empty for "Entered by you". */
  evidenceIds?: string[];
  /** The proposal this was kept from, when an agent or an import put it forward. */
  proposalId?: string;
  /** ISO instant. */
  createdAt: string;
  /** Set when the person later promoted it; the note stays as history. */
  promotedToItemId?: string;
}

export interface ExplorationNote { id: string; data: ExplorationNoteData }
