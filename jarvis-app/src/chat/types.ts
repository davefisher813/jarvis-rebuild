// Chat (addendum item 23). One box that answers, acts, and captures.
// Messages are entities (registry migration 0024) so history syncs and the
// Settings delete button really deletes. Files routing is the follow-up pass
// (the bucket from 0020 is live); nothing here pretends otherwise.

export const ENTITY_CHAT = "chat_message";

// Where an answer came from, rendered as the bubble's provenance line.
// Grounded answers cite records; AI answers say so; action receipts say what
// changed. Facts, not editable.
export interface ChatProvenance {
  kind: "records" | "ai" | "action";
  refs?: { kind: string; id: string; label: string }[];
}

export interface ChatMessageData {
  role: "user" | "jarvis";
  text: string;
  ts: string; // ISO
  provenance?: ChatProvenance;
}
