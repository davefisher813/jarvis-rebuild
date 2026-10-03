// THE COMMAND PATH'S ANSWERS (IMPLEMENTATION-SPEC.md 07, API-AND-VALIDATION.md
// "Error vocabulary and recovery"). Every user command is a database function
// that returns either its result or { error: CODE, ...owned facts }. This
// module turns that into one shape the screens read, and holds the one line
// each code shows, in the house style: fragments, a middle dot, no sentence.

import type { RpcClient } from "../agentClient";
import { ERROR_CODES } from "../gateway/protocol";

export type { RpcClient };

export const COMMAND_ERROR_CODES = [
  ...ERROR_CODES,
  "MISSING_DETAILS", "MODULE_UNAVAILABLE", "DESTINATION_CHANGED", "REVIEW_CHANGED", "APPROVAL_EXPIRED",
  "OUTCOME_UNKNOWN", "PROVIDER_AUTH", "OFFLINE", "UNSUPPORTED",
  // Slice 07: a draft in the send's hands, a draft edited on another device, a mailbox whose sign-in cannot send.
  "DRAFT_SENT", "DRAFT_CONFLICT", "PROVIDER_SCOPE",
] as const;
export type CommandErrorCode = (typeof COMMAND_ERROR_CODES)[number];

export function isCommandErrorCode(x: unknown): x is CommandErrorCode {
  return typeof x === "string" && (COMMAND_ERROR_CODES as readonly string[]).includes(x);
}

/** The line a screen shows for each refusal. Recovery is the screen's: the candidate, the draft, the details all stay. */
export const COMMAND_LINES: Record<CommandErrorCode, string> = {
  AUTH_REQUIRED: "Sign In to Continue",
  AI_DISABLED: "AI Is Off · Your Manual Tools Still Work",
  ADMIN_AI_DISABLED: "Turned Off by Admin",
  SCOPE_DENIED: "Not Shared With This Assistant",
  CAPABILITY_UNVERIFIED: "Not Verified for This Assistant",
  MODE_CEILING: "Not Allowed in This Mode",
  SOURCE_CHANGED: "Email Changed · Review These Details",
  STALE_SCOPE: "Preview Changed · Look Again Before Sharing",
  IDEMPOTENCY_CONFLICT: "Saved From Another Device · Open It to Review",
  PACKAGE_EXPIRED: "This Shared Context Expired",
  CONNECTION_REVOKED: "Access Was Revoked",
  INVALID_PAYLOAD: "This Can't Be Saved as It Is",
  IMPORT_INVALID: "Not a JARVIS Context Response",
  RATE_LIMITED: "Gmail Needs a Moment · Try Again Shortly",
  UNAVAILABLE: "Couldn't Reach JARVIS · Try Again",
  NOT_FOUND: "Item Removed",
  MISSING_DETAILS: "Add the Highlighted Details Before Saving",
  MODULE_UNAVAILABLE: "Not Ready Yet · Your Details Are Still Here",
  DESTINATION_CHANGED: "This Item Changed · Open It to Review",
  REVIEW_CHANGED: "Message Changed · Review It Again",
  APPROVAL_EXPIRED: "Approval Expired · Review It Again",
  OUTCOME_UNKNOWN: "Send Status Unknown · Check Gmail Before Trying Again",
  PROVIDER_AUTH: "Reconnect Gmail to Continue",
  OFFLINE: "Connect to Save · Your Details Are Still Here",
  UNSUPPORTED: "Not Supported Yet · Your Details Are Still Here",
  DRAFT_SENT: "Already Sent · Nothing Left to Change",
  DRAFT_CONFLICT: "Edited on Another Device · Choose Which Draft to Keep",
  PROVIDER_SCOPE: "Gmail Needs Permission to Send · Reconnect in Connections",
};

export interface CommandFailure {
  ok: false;
  code: CommandErrorCode;
  /** The function's own word for what was wrong ("dismissed", "email changed"), never shown raw. */
  detail?: string;
  /** The owned facts the function returned with the refusal: a current revision, the fresh payload, the missing fields. */
  data: Record<string, unknown>;
}
export type CommandResult<T> = { ok: true; value: T } | CommandFailure;

export function failure(code: CommandErrorCode, data: Record<string, unknown> = {}, detail?: string): CommandFailure {
  return detail === undefined ? { ok: false, code, data } : { ok: false, code, detail, data };
}

export function lineFor(f: Pick<CommandFailure, "code">): string {
  return COMMAND_LINES[f.code];
}

function offline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** One database function, one answer. A transport failure is OFFLINE when the browser says so, UNAVAILABLE otherwise. */
export async function callCommand<T>(client: RpcClient, fn: string, args: Record<string, unknown>): Promise<CommandResult<T>> {
  let res: { data: unknown; error: unknown };
  try {
    res = await client.rpc(fn, args);
  } catch {
    return failure(offline() ? "OFFLINE" : "UNAVAILABLE");
  }
  if (res.error) return failure(offline() ? "OFFLINE" : "UNAVAILABLE");
  const d = res.data;
  if (d && typeof d === "object" && "error" in d) {
    const { error, detail, ...rest } = d as { error: unknown; detail?: unknown } & Record<string, unknown>;
    return failure(isCommandErrorCode(error) ? error : "UNAVAILABLE", rest, typeof detail === "string" ? detail : undefined);
  }
  return { ok: true, value: d as T };
}

/** A request id for one tap. The server derives the logical key itself; this is recorded, never trusted. */
export function newRequestId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
