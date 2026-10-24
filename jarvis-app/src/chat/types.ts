// Chat (addendum item 23). One box that answers, acts, and captures.
// Messages are entities (registry migration 0024) so history syncs and the
// Settings delete button really deletes. Files routing is the follow-up pass
// (the bucket from 0020 is live); nothing here pretends otherwise.

export const ENTITY_CHAT = "chat_message";

// Where an answer came from, rendered as the bubble's provenance line.
// Grounded answers cite records; AI answers say so; action receipts say what
// changed. Facts, not editable.
export interface ChatProvenance {
  // "error" marks a turn that failed (the AI could not answer, a draft was not written). It is shown, and it is never sent back to
  // the model as if it were part of the conversation.
  kind: "records" | "ai" | "action" | "error";
  refs?: { kind: string; id: string; label: string }[];
}

export interface ChatMessageData {
  role: "user" | "jarvis";
  text: string;
  ts: string; // ISO
  provenance?: ChatProvenance;
}
