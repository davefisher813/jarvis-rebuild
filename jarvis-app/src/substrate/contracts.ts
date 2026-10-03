// THE SHARED CONTRACT (JARVIS unified substrate, slice 01, 2026-10-03).
//
// The logical names come from docs/jarvis-unified/CONTRACTS.ts and
// IMPLEMENTATION-SPEC.md section 03; docs/jarvis-unified/REPO-MAP.md says
// where each one lands in this repo. Types and closed vocabularies only:
// nothing here reads a store, calls a model or touches the network. The
// physical rows are migration 0044 in jarvis-core.
//
// Two rules the rest of the substrate inherits from this file:
//   - There is no execute capability. An outside assistant may read what it
//     was granted, propose, and write an inert draft. Only a person's own
//     tap dispatches anything, through the user command functions.
//   - A capture payload is provisional until the server command commits it.
//     The same shapes carry a rule's extraction, a person's manual capture
//     and an agent's suggestion, so none of the three has an advantage.

export type UUID = string;
/** A local calendar day, YYYY-MM-DD. */
export type ISODate = string;
/** A UTC instant, ISO 8601. */
export type Instant = string;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export const AGENT_MODES = ["read_only", "help_me", "just_handle_it"] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

export const AGENT_CAPABILITIES = ["read_context", "propose", "write_inert_draft", "open_review_link"] as const;
export type AgentCapability = (typeof AGENT_CAPABILITIES)[number];

export const ACTION_STATES = [
  "proposed", "approved", "running", "confirmed", "failed", "cancelled", "outcome_unknown", "cancellation_requested",
] as const;
export type ActionState = (typeof ACTION_STATES)[number];

export type Surface = "project" | "email";

export interface MoneyAmount {
  /** Integer minor units (cents for a two-decimal currency). Never a float. */
  minor_units: number;
  /** ISO 4217. */
  currency: string;
}

export interface BillPayload {
  kind: "bill";
  issuer: string;
  amount: MoneyAmount;
  due_date: ISODate | null;
  /** The person chose No due date on purpose; a null date without this is a missing detail. */
  no_due_date_confirmed: boolean;
  invoice_number?: string;
}

export interface ReceiptPayload {
  kind: "receipt";
  merchant: string;
  amount: MoneyAmount;
  purchase_date: ISODate;
  transaction_type: "purchase" | "refund";
  receipt_number?: string;
}

export interface TaskPayload {
  kind: "task";
  title: string;
  /** null is an explicit No deadline, never a guess. */
  due_date: ISODate | null;
  notes: string;
}

export type EventTime =
  | { all_day: true; start_date: ISODate; end_date_exclusive: ISODate }
  | { all_day: false; start_at: Instant; end_at: Instant; timezone: string; selected_offset: string };

export interface EventPayload {
  kind: "event";
  title: string;
  time: EventTime;
  location: string | null;
  /** An ICS UID, when the source carried one. */
  external_uid: string | null;
}

export interface WaitingPayload {
  kind: "waiting";
  title: string;
  waiting_for: string;
  counterparty_display: string;
  contact_id: UUID | null;
  follow_up_on: ISODate | null;
}

export type CapturePayload = BillPayload | ReceiptPayload | TaskPayload | EventPayload | WaitingPayload;
export type CaptureKind = CapturePayload["kind"];
export const CAPTURE_KINDS: readonly CaptureKind[] = ["bill", "receipt", "task", "event", "waiting"];

/** Where one field's value came from: an offset into a stable evidence row, or the person. */
export interface EvidenceField {
  evidence_id: UUID;
  source_hash: string;
  text_start?: number;
  text_end?: number;
  structured_path?: string;
  entered_by_user: boolean;
}

export type CandidateStatus = "proposed" | "needs_details" | "saved" | "dismissed" | "stale" | "conflict";
export type CandidateOrigin = "rule" | "manual" | "agent";

/** The version stamped on every validated capture payload. Migrate readers before writing a new one. */
export const CAPTURE_PAYLOAD_VERSION = 1;
