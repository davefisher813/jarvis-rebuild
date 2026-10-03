/** Logical v1 contracts. Adapt physical columns to the existing repo; not a migration. */
export type UUID = string;
export type ISODate = string;
export type Instant = string;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type AgentMode = 'read_only' | 'help_me' | 'just_handle_it';
export type AgentCapability = 'read_context' | 'propose' | 'write_inert_draft' | 'open_review_link';
// No public execute capability. The user dispatcher is the sole execution entry point.
export type ActionState = 'proposed' | 'approved' | 'running' | 'confirmed' | 'failed' | 'cancelled' | 'outcome_unknown';
export type Surface = 'project' | 'email';
export interface Versioned { id: UUID; owner_id: UUID; revision: number; schema_version: 1; created_at: Instant; updated_at: Instant }
export interface EvidenceField { evidence_id: UUID; source_hash: string; text_start?: number; text_end?: number; structured_path?: string; entered_by_user: boolean }
export interface MoneyAmount { minor_units: number; currency: string }
export interface BillPayload { kind: 'bill'; issuer: string; amount: MoneyAmount; due_date: ISODate | null; no_due_date_confirmed: boolean; invoice_number?: string }
export interface ReceiptPayload { kind: 'receipt'; merchant: string; amount: MoneyAmount; purchase_date: ISODate; transaction_type: 'purchase' | 'refund'; receipt_number?: string }
export interface TaskPayload { kind: 'task'; title: string; due_date: ISODate | null; notes: string }
export type EventTime = { all_day: true; start_date: ISODate; end_date_exclusive: ISODate } | { all_day: false; start_at: Instant; end_at: Instant; timezone: string; selected_offset: string };
export interface EventPayload { kind: 'event'; title: string; time: EventTime; location: string | null; external_uid: string | null }
export interface WaitingPayload { kind: 'waiting'; title: string; waiting_for: string; counterparty_display: string; contact_id: UUID | null; follow_up_on: ISODate | null }
export type CapturePayload = BillPayload | ReceiptPayload | TaskPayload | EventPayload | WaitingPayload;
export interface Candidate extends Versioned {
  account_id: UUID; message_id: string; source_hash: string; extractor_version: string;
  payload: CapturePayload; provenance_by_field: Record<string, EvidenceField>;
  missing_fields: string[]; status: 'proposed'|'needs_details'|'saved'|'dismissed'|'stale'|'conflict';
  destination_id: UUID | null; payload_hash: string; fingerprint: string;
  origin: 'rule'|'manual'|'agent'; agent_id: UUID | null;
}
export interface DecisionPayload {
  project_id: UUID; statement: string; rationale: string; alternatives: string[];
  constraints: { label: string; value: Json; evidence_ids: UUID[] }[];
  dependency_refs: { item_id: UUID; expected_revision: number; kind: 'depends_on'|'blocked_by'|'informed_by' }[];
  evidence_ids: UUID[];
}
export interface DecisionVersion extends DecisionPayload {
  id: UUID; item_id: UUID; version: number; status: 'active'|'superseded'|'withdrawn';
  supersedes_version_id: UUID | null; committed_by: UUID; committed_at: Instant;
  withdrawal_reason: string | null;
}
export interface ContextManifestEntry { resource_id: UUID; revision: number; fields: string[]; redactions: string[]; evidence_refs: UUID[] }
export interface ContextPackage {
  protocol_version: 1; package_id: UUID; job_id: UUID; agent_id: UUID; project_id: UUID;
  purpose: string; manifest: ContextManifestEntry[]; expires_at: Instant; auth_epoch: number;
  package_hash: string; data: Record<UUID, Record<string, Json>>;
  omitted_counts: { unauthorized: number; over_limit: number };
}
// Public error must not reveal counts of unauthorized resources. omitted_counts.unauthorized
// is exposed only in the authenticated owner's preview, never to an ungranted agent.
export interface ProposalSubmission {
  protocol_version: 1; package_id: UUID; surface: Surface; type: 'decision'|'constraint_change'|'capture';
  payload: DecisionPayload | CapturePayload; evidence_refs: UUID[]; idempotency_key: string;
}
export interface ApproveCaptureRequest { candidate_id: UUID; expected_revision: number; shown_payload_hash: string; idempotency_key: string }
export interface Approval {
  id: UUID; user_id: UUID; action_id: UUID; payload_hash: string; source_revision: number;
  destination_revision: number | null; account_id: UUID | null; granted_at: Instant;
  expires_at: Instant; consumed_at: Instant | null; auth_epoch: number | null; nonce: string;
}
export interface ReceiptEvent {
  id: UUID; action_id: UUID; sequence: number; state: ActionState; exact_verb: string; timestamp: Instant;
  actor: { kind: 'user'|'rule'|'agent'; id: UUID | null; display_name: string };
  initiated_by_user_id: UUID | null; scope_summary: string;
  diff: { field: string; before: Json; after: Json }[]; evidence_refs: UUID[];
  provider_ack: { provider: string; account_id: UUID; message_id: string; accepted_at: Instant } | null;
  assurance: 'verified_jarvis'|'provider_ack'|'reported_external';
  error_code: string | null; reversal_action_id: UUID | null;
}
export interface ExactSend {
  account_id: UUID; from_identity: string; to: string[]; cc: string[]; bcc: string[];
  subject: string; body_text: string;
  attachments: { storage_id: UUID; filename: string; size_bytes: number; sha256: string; mime_type: string }[];
  reply_headers: { in_reply_to: string | null; references: string[]; thread_id: string | null };
  draft_id: UUID; draft_revision: number;
}
export interface SendReview { exact: ExactSend; payload_hash: string; review_nonce: string; expires_at: Instant }
export interface SendCommand { review_nonce: string; shown_payload_hash: string; idempotency_key: string }
export interface ActionResult { action_id: UUID; state: ActionState; destination_id: UUID | null; receipt_id: UUID; safe_message: string }
export interface ApiError { code: string; safe_message: string; retryable: boolean; correlation_id: UUID }
export interface DestinationPrepared { normalizedPayload: CapturePayload; destinationKind: string; displaySummary: string; payloadHash: string; moduleVersion: string }
export interface DestinationAdapter<TTransaction> {
  prepare(input: CapturePayload, evidence: EvidenceField[], expectedRevision?: number): Promise<DestinationPrepared>;
  commit(tx: TTransaction, input: CapturePayload, evidence: EvidenceField[], actionId: UUID): Promise<{itemId: UUID; revision: number; exactEffect: string}>;
  canUndo(itemId: UUID, revision: number): Promise<{eligible: boolean; reason: string | null}>;
}
