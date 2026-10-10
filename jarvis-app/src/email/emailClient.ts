// THE EMAIL TAB'S READS AND COMMANDS (docs/jarvis-unified, slice 05;
// IMPLEMENTATION-SPEC.md 08, 11, 14). Two doors, kept apart on purpose:
//
//   - the cache, read with the person's own session through migration 0048's
//     functions (email_accounts, email_inbox, email_message_read,
//     email_search_cached): the row policies decide, nothing else;
//   - the provider, reached only through api/email/*, where the Gmail token
//     lives. The browser sends the person's JARVIS session and the command;
//     it never sees a Google token and never calls Gmail itself.
//
// Nothing here runs on its own: every call is a tap, a pull, or an open.

import { callCommand, failure, isCommandErrorCode, type CommandFailure, type CommandResult, type RpcClient } from "../substrate/commands/errors";
import { apiUrl } from "../shared/apiBase";
import { b64urlDecodeBytes } from "../connections/google/map";

export type { RpcClient, CommandFailure, CommandResult };

export const PAGE = 30;
const SEARCH_LIMIT = 50;

export interface AttachmentMeta { filename: string; mime: string; attachmentId: string; size: number }
export interface MailAddress { address: string; name: string }
export type AccountState = "connected" | "reauth" | "disconnected";

export interface EmailAccount {
  id: string;
  address: string;
  state: AccountState;
  last_sync_at: string | null;
  sync_error: string | null;
  capabilities: Record<string, boolean>;
  connected_at: string;
  scopes: string[];
  cached: number;
  /** The one saved plain-text signature for this account (spec L3). Empty is a valid, explicit save. */
  signature_text: string;
  /** Bumped on every signature save; the optimistic-concurrency check for email_signature_set, and what a draft's own signature_revision is compared against. */
  signature_revision: number;
  /** The sync dimension (Email v1 spec 8.1; migration 0065). Absent before 0065: freshness is then last_sync_at alone. */
  sync_state?: SyncState | null;
  /** When the 90-day Inbox and Sent window was last fully listed and reconciled through Gmail's history. */
  verified_through_at?: string | null;
  coverage_start?: string | null;
}

/** 8.1's values. The server writes catching_up and current; the rest are the spec's, read honestly if they ever arrive. */
export type SyncState = "not_started" | "syncing" | "current" | "catching_up" | "stale" | "failed" | "paused";

/** One inbox row as email_inbox returns it: the provider's facts, nothing derived. */
export interface InboxRow {
  id: string;
  account_id: string;
  account: string;
  provider_id: string;
  thread_id: string;
  internal_date: string;
  from_address: string;
  from_name: string;
  subject: string;
  snippet: string;
  has_body: boolean;
  attachment_metadata: AttachmentMeta[];
  provider_labels: string[];
  source_hash: string;
  read: boolean;
}

export interface MessageDetail {
  id: string;
  account_id: string;
  account: string;
  provider_id: string;
  thread_id: string;
  internal_date: string;
  from_address: string;
  from_name: string;
  to_addresses: MailAddress[];
  cc_addresses: MailAddress[];
  subject: string;
  snippet: string;
  provider_labels: string[];
  read: boolean;
  deleted: boolean;
  source_hash: string;
  attachments: AttachmentMeta[];
  has_body: boolean;
  text: string | null;
  html: string | null;
  /** The headers a reply needs, kept with the body on open (slice 07). */
  reply_headers?: ReplyHeadersOf;
}

export interface ReplyHeadersOf { message_id?: string; in_reply_to?: string; references?: string[]; reply_to?: string }

export interface InboxPage { rows: InboxRow[]; cached_total: number; page: number }
export interface CachedSearch { rows: InboxRow[]; coverage: "cached"; q: string; window: number }

// ---- the cache, through the session ---------------------------------------

export function listAccounts(client: RpcClient): Promise<CommandResult<EmailAccount[]>> {
  return callCommand<EmailAccount[]>(client, "email_accounts", {});
}

export interface PageCursor { internal_date: string; provider_id: string }

export function inboxPage(client: RpcClient, o: { accounts?: string[] | null; before?: PageCursor | null; limit?: number } = {}): Promise<CommandResult<InboxPage>> {
  return callCommand<InboxPage>(client, "email_inbox", {
    p_accounts: o.accounts ?? null,
    p_before: o.before?.internal_date ?? null,
    p_before_id: o.before?.provider_id ?? null,
    p_limit: o.limit ?? PAGE,
  });
}

export function readMessage(client: RpcClient, id: string): Promise<CommandResult<MessageDetail>> {
  return callCommand<MessageDetail>(client, "email_message_read", { p_message: id });
}

export function searchCached(client: RpcClient, q: string, accounts: string[] | null = null): Promise<CommandResult<CachedSearch>> {
  return callCommand<CachedSearch>(client, "email_search_cached", { p_q: q, p_accounts: accounts, p_limit: SEARCH_LIMIT });
}

export interface RuleShape { sender_exact: string; account_id: string; category_id: string }

/** Save the account's one signature (spec L3): email_signature_set. Empty text is a valid, explicit save. p_expected_revision null skips the conflict check. */
export function setSignature(client: RpcClient, ownerId: string, accountId: string, text: string, expectedRevision: number | null = null): Promise<CommandResult<{ account_id: string; signature_text: string; signature_revision: number }>> {
  return callCommand(client, "email_signature_set", { p_owner: ownerId, p_account: accountId, p_text: text, p_expected_revision: expectedRevision });
}

export function offerSuggestion(client: RpcClient, rule: RuleShape, tapIds: string[]): Promise<CommandResult<{ suggestion_id: string; status: string; replay: boolean }>> {
  return callCommand(client, "policy_suggestion_offer", { p_rule: rule, p_evidence_tap_ids: tapIds });
}

export function answerSuggestion(client: RpcClient, id: string, answer: "accepted" | "dismissed"): Promise<CommandResult<{ suggestion_id: string; status: string; replay: boolean }>> {
  return callCommand(client, "policy_suggestion_answer", { p_suggestion: id, p_answer: answer });
}

// ---- the provider, through the server --------------------------------------

/** `coverage_complete` false: the coverage crawl has more to list or reconcile, so call again (a little later). Absent before migration 0065. */
export interface SyncResult { synced: number; removed: number; next_page: string | null; complete: boolean; resynced: boolean; last_sync_at?: string | null; coverage_complete?: boolean; sync_state?: SyncState }
export interface OpenResult { message_id: string; labels: string[]; attachments: number }
export interface LabelResult { message_id: string; labels: string[]; read: boolean; in_inbox: boolean; in_trash: boolean; receipt: string | null }
export type MessageOp = "open" | "read" | "unread" | "archive" | "unarchive" | "trash" | "untrash";
export interface ProviderSearch { q: string; rows: InboxRow[]; covered: string[]; failed: { email: string; code: string }[]; next_page: { email: string; page: string } | null; coverage: "provider" }
export interface Downloaded { filename: string; mime: string; size: number; data: string }
export interface Mirrored { mirrored: string[]; disconnected: string[] }

export type Fetch = typeof fetch;

function offline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** One POST to an email route with the person's session. The server's code is the answer; its safe line rides as detail. */
export async function apiPost<T>(path: string, body: Record<string, unknown>, token: string | null | undefined, doFetch: Fetch = fetch): Promise<CommandResult<T>> {
  if (!token) return failure("AUTH_REQUIRED");
  if (offline()) return failure("OFFLINE");
  let r: Response;
  try {
    r = await doFetch(apiUrl(path), { method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) });
  } catch {
    return failure(offline() ? "OFFLINE" : "UNAVAILABLE");
  }
  const j = (await r.json().catch(() => null)) as (Record<string, unknown> & { code?: unknown; safe_message?: unknown; retry_after?: unknown }) | null;
  if (!r.ok) {
    const code = isCommandErrorCode(j?.code) ? j.code : r.status === 413 ? "UNSUPPORTED" : "UNAVAILABLE";
    return failure(code, { status: r.status, ...(typeof j?.retry_after === "number" ? { retry_after: j.retry_after } : {}) }, typeof j?.safe_message === "string" ? j.safe_message : undefined);
  }
  return { ok: true, value: (j ?? {}) as T };
}

export const syncAccount = (token: string | null | undefined, email: string, page?: string | null, doFetch?: Fetch) =>
  apiPost<SyncResult>("/api/email/sync", { email, ...(page ? { page } : {}) }, token, doFetch);

export const openMessage = (token: string | null | undefined, email: string, id: string, doFetch?: Fetch) =>
  apiPost<OpenResult>("/api/email/message", { email, id, op: "open" }, token, doFetch);

export const labelMessage = (token: string | null | undefined, email: string, id: string, op: Exclude<MessageOp, "open">, doFetch?: Fetch) =>
  apiPost<LabelResult>("/api/email/message", { email, id, op }, token, doFetch);

export const searchGmail = (token: string | null | undefined, q: string, email: string | null, page: { email: string; page: string } | null = null, doFetch?: Fetch) =>
  apiPost<ProviderSearch>("/api/email/search", { q, ...(page ? { email: page.email, page: page.page } : email ? { email } : {}) }, token, doFetch);

export const downloadAttachment = (token: string | null | undefined, email: string, id: string, attachmentId: string, doFetch?: Fetch) =>
  apiPost<Downloaded>("/api/email/attachment", { email, id, attachmentId }, token, doFetch);

export const mirrorAccounts = (token: string | null | undefined, doFetch?: Fetch) =>
  apiPost<Mirrored>("/api/email/accounts", {}, token, doFetch);

// ---- small facts the screens share -----------------------------------------

/** The provider's bytes, as Gmail hands them (base64url), as a file to save. */
export function attachmentBlob(d: Downloaded): Blob {
  const bytes = b64urlDecodeBytes(d.data);
  // A fresh buffer, so the part is a plain ArrayBuffer view and nothing shared.
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return new Blob([copy], { type: d.mime || "application/octet-stream" });
}

/**
 * E20: the exact Gmail thread when the account and thread id are known and
 * look like Gmail's own (hex), the account's inbox when they are not. The
 * second case is labelled "Open Gmail", never "Open This Email".
 */
export function gmailLink(address: string, threadId: string | null | undefined): { href: string; exact: boolean } {
  const base = `https://mail.google.com/mail/?authuser=${encodeURIComponent(address)}`;
  const exact = typeof threadId === "string" && /^[0-9a-f]{8,32}$/i.test(threadId);
  return exact ? { href: `${base}#all/${threadId}`, exact: true } : { href: base, exact: false };
}

/** Newest first by the provider's receipt time, then by id: the one order every list keeps (E01). */
export function newestFirst(a: Pick<InboxRow, "internal_date" | "provider_id">, b: Pick<InboxRow, "internal_date" | "provider_id">): number {
  const t = Date.parse(b.internal_date) - Date.parse(a.internal_date);
  if (t !== 0 && !Number.isNaN(t)) return t;
  return b.provider_id < a.provider_id ? -1 : b.provider_id > a.provider_id ? 1 : 0;
}

/** Rows merged by id, the incoming facts winning, in the one order. A refresh never reorders what was already there except by the clock. */
export function mergeRows(existing: readonly InboxRow[], incoming: readonly InboxRow[]): InboxRow[] {
  const byId = new Map<string, InboxRow>();
  for (const r of existing) byId.set(r.id, r);
  for (const r of incoming) byId.set(r.id, r);
  return [...byId.values()].sort(newestFirst);
}
