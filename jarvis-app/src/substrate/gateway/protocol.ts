// THE AGENT PROTOCOL, v1 (IMPLEMENTATION-SPEC.md section 05; API-AND-
// VALIDATION.md "Error vocabulary"). Transport independent: one JSON request
// `{ protocol_version, method, params }` with a bearer token, one JSON answer.
// The HTTPS gateway is api/agent.ts; the manual export/import route uses the
// same shapes without any transport.
//
// There is no execute method and no approve method. An assistant reads what
// it was granted, proposes, writes an inert draft, and asks after the state
// of an action a person dispatched.

import type { Schema } from "../schema";

export const PROTOCOL_VERSION = 1;

export const AGENT_METHODS = [
  "capabilities", "context.preview", "context.issue", "proposal.submit", "draft.submit", "review.link", "action.status", "connection.revoke",
  // Phase 0 (PHASE0-DESIGN.md D6): an outside app hands JARVIS records; each lands as a proposal on the
  // app surface and nothing else. Behind the vyzn_sync_v1 flag at the handler.
  "record.push",
] as const;
export type AgentMethod = (typeof AGENT_METHODS)[number];

/** Request body caps (API-AND-VALIDATION.md "Request limits"). */
export const LIMITS = {
  requestBytes: 65536,
  contextBytes: 32768,
  contextRecords: 50,
  proposalBytes: 16384,
  draftBytes: 65536,
  recipients: 20,
  evidenceRefs: 20,
  importBytes: 262144,
  recordsPerPush: 50,
  recordBytes: 8192,
} as const;

/** The apps that may push or be pulled: the TS mirror of jarvis_vyzn_apps() (migration 0061). */
export const VYZN_APPS = ["backend-inbox", "bridge", "tucci"] as const;
export type VyznApp = (typeof VYZN_APPS)[number];

/** The record kinds Phase 0 accepts (task and event have adapters; note and person approve into the writers' own shapes). */
export const RECORD_KINDS = ["task", "event", "note", "person"] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export const ERROR_CODES = [
  "AUTH_REQUIRED", "AI_DISABLED", "ADMIN_AI_DISABLED", "SCOPE_DENIED", "CAPABILITY_UNVERIFIED", "MODE_CEILING",
  "SOURCE_CHANGED", "STALE_SCOPE", "IDEMPOTENCY_CONFLICT", "PACKAGE_EXPIRED", "CONNECTION_REVOKED",
  "INVALID_PAYLOAD", "IMPORT_INVALID", "RATE_LIMITED", "UNAVAILABLE", "NOT_FOUND",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** The HTTP status and the one safe line an outside assistant may see. Never a record's title, never a count it was not granted. */
export const PROTOCOL_ERRORS: Record<ErrorCode, { status: number; safe_message: string; retryable: boolean }> = {
  AUTH_REQUIRED: { status: 401, safe_message: "Sign in to continue.", retryable: false },
  AI_DISABLED: { status: 403, safe_message: "AI is off. Your manual tools still work.", retryable: false },
  ADMIN_AI_DISABLED: { status: 403, safe_message: "Turned off by admin.", retryable: false },
  SCOPE_DENIED: { status: 403, safe_message: "This context wasn't shared with this assistant.", retryable: false },
  CAPABILITY_UNVERIFIED: { status: 403, safe_message: "This assistant isn't verified for that.", retryable: false },
  MODE_CEILING: { status: 403, safe_message: "The current mode doesn't allow that.", retryable: false },
  SOURCE_CHANGED: { status: 409, safe_message: "Email changed. Review these details.", retryable: false },
  STALE_SCOPE: { status: 409, safe_message: "The shared context changed. Preview it again.", retryable: false },
  IDEMPOTENCY_CONFLICT: { status: 409, safe_message: "That request id was already used for something else.", retryable: false },
  PACKAGE_EXPIRED: { status: 410, safe_message: "This shared context expired.", retryable: false },
  CONNECTION_REVOKED: { status: 410, safe_message: "Access was revoked.", retryable: false },
  INVALID_PAYLOAD: { status: 422, safe_message: "The request didn't match the protocol.", retryable: false },
  IMPORT_INVALID: { status: 422, safe_message: "This file isn't a supported JARVIS context response.", retryable: false },
  RATE_LIMITED: { status: 429, safe_message: "Too many requests. Try again shortly.", retryable: true },
  UNAVAILABLE: { status: 503, safe_message: "Not available yet.", retryable: true },
  NOT_FOUND: { status: 404, safe_message: "Not found.", retryable: false },
};

export function isErrorCode(x: unknown): x is ErrorCode {
  return typeof x === "string" && (ERROR_CODES as readonly string[]).includes(x);
}

export interface ProtocolError { code: ErrorCode; safe_message: string; retryable: boolean; correlation_id: string }

export function protocolError(code: ErrorCode, correlationId: string): ProtocolError {
  const e = PROTOCOL_ERRORS[code];
  return { code, safe_message: e.safe_message, retryable: e.retryable, correlation_id: correlationId };
}

const uuid: Schema = { type: "uuid" };
const uuids = (max: number): Schema => ({ type: "array", items: uuid, max });
const strings = (max: number, each: number): Schema => ({ type: "array", items: { type: "string", max: each }, max });

/** The params each method accepts, and nothing else. */
export const PARAM_SCHEMAS: Record<AgentMethod, Schema> = {
  capabilities: { type: "object", fields: {} },
  "context.preview": {
    type: "object",
    fields: { job_id: uuid, requested_resource_ids: uuids(200), requested_fields: strings(32, 64), purpose: { type: "string", max: 200 } },
    optional: ["requested_resource_ids", "requested_fields", "purpose"],
  },
  "context.issue": {
    type: "object",
    fields: { job_id: uuid, manifest_hash: { type: "string", min: 64, max: 64, pattern: /^[0-9a-f]{64}$/ }, requested_resource_ids: uuids(200), requested_fields: strings(32, 64), purpose: { type: "string", max: 200 } },
    optional: ["requested_resource_ids", "requested_fields", "purpose"],
  },
  "proposal.submit": {
    type: "object",
    fields: {
      package_id: uuid,
      surface: { type: "string", enum: ["project", "email"] },
      type: { type: "string", enum: ["decision", "constraint_change", "capture"] },
      payload: { type: "json", maxBytes: LIMITS.proposalBytes },
      evidence_refs: uuids(LIMITS.evidenceRefs),
      idempotency_key: { type: "string", min: 1, max: 128 },
    },
    optional: ["evidence_refs"],
  },
  "draft.submit": {
    type: "object",
    fields: {
      package_id: uuid,
      draft: {
        type: "object",
        fields: {
          account_id: uuid,
          thread_id: { type: "string", max: 256 },
          to: strings(LIMITS.recipients, 320),
          cc: strings(LIMITS.recipients, 320),
          bcc: strings(LIMITS.recipients, 320),
          subject: { type: "string", max: 998 },
          body_text: { type: "string", max: LIMITS.draftBytes },
          reply_headers: { type: "object", fields: { in_reply_to: { type: "string", max: 998 }, references: strings(50, 998) }, optional: ["in_reply_to", "references"] },
        },
        optional: ["thread_id", "cc", "bcc", "subject", "body_text", "reply_headers"],
      },
    },
  },
  "record.push": {
    type: "object",
    fields: {
      source_app: { type: "string", enum: VYZN_APPS },
      records: {
        type: "array", max: LIMITS.recordsPerPush,
        items: {
          type: "object",
          fields: {
            source_record_id: { type: "string", min: 1, max: 128, pattern: /^[A-Za-z0-9._:-]+$/ },
            revision: { type: "integer", min: 1, max: 2147483647 },
            kind: { type: "string", enum: RECORD_KINDS },
            data: { type: "json", maxBytes: LIMITS.recordBytes },
            source: { type: "object", fields: { url: { type: "string", max: 512 }, label: { type: "string", max: 120 } }, optional: ["url", "label"] },
            client_at: { type: "string", max: 40, pattern: /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/ },
          },
          optional: ["source", "client_at"],
        },
      },
    },
  },
  "review.link": { type: "object", fields: { proposal_id: uuid } },
  "action.status": { type: "object", fields: { action_id: uuid } },
  "connection.revoke": { type: "object", fields: { connection_id: uuid } },
};

export const REQUEST_SCHEMA: Schema = {
  type: "object",
  fields: {
    protocol_version: { type: "integer", min: 1, max: 1 },
    method: { type: "string", enum: AGENT_METHODS },
    params: { type: "json", maxBytes: LIMITS.requestBytes },
  },
  optional: ["params"],
};
