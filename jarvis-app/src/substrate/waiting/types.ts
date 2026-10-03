// WAITING (IMPLEMENTATION-SPEC.md sections 03.2 and 12). A request the person
// is waiting on somebody else for: approved from an email, tracked here,
// resolved by the person. A committed life record, so it lives in `item`
// under its own kind (registered by migration 0044). Never a task: a follow
// up date is tracker metadata, not a deadline.

import type { Source } from "../../shared/provenance";

export const ENTITY_WAITING = "waiting";

export type WaitingStatus = "open" | "resolved" | "withdrawn";

export interface WaitingData {
  title: string;
  /** What is owed: "the transcript", "a signed agreement". */
  waitingFor: string;
  /** Who owes it, as shown: a name, never a guessed address. */
  counterpartyDisplay: string;
  contactId?: string;
  /** The source_evidence row this was tracked from. */
  sourceEvidenceId?: string;
  status: WaitingStatus;
  /** ISO instant. */
  startedAt: string;
  /** Local date, chosen by the person. Absent means no date and no urgency. */
  followUpOn?: string;
  resolvedAt?: string;
  resolutionNote?: string;
  /** The mail thread and account it came from, for Open in Gmail and New reply. */
  threadId?: string;
  account?: string;
  source?: Source;
}

export interface WaitingItem { id: string; data: WaitingData }
