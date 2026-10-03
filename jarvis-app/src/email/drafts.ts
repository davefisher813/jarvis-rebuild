// DRAFTS AND THE EXACT SEND, FROM THE CLIENT'S SIDE (docs/jarvis-unified,
// slice 07; IMPLEMENTATION-SPEC.md 07.3, 08 E16 to E19, 09 M5 to M7, 11). A
// draft is 0044's email_draft row: saved on this device first (after a pause
// in typing and on blur), then on the server with the revision this device
// last saw, so two devices never overwrite each other in silence. The review
// is the server's snapshot of the row (send_review); the tap goes through the
// send route, which carries the command out and answers with the draft as it
// stands. Nothing here calls Gmail; nothing here queues a send for later.

import { callCommand, type CommandResult, type RpcClient } from "../substrate/commands/errors";
import { apiPost, type Fetch, type MessageDetail } from "./emailClient";
import { ACCOUNT_PREFIX } from "../messages/mailCache";
import { mailAccountKey } from "../messages/mailIdentity";
import { replySubject } from "../connections/google/map";

export type SendState = "draft" | "sending" | "sent" | "unknown" | "failed";

export interface AttachmentRef { storage_id: string; filename: string; size_bytes: number; sha256: string; mime_type: string }
export interface ReplyHeaders { in_reply_to: string | null; references: string[]; thread_id: string | null }
export interface DraftFields {
  thread_id: string | null;
  to_addresses: string[];
  cc_addresses: string[];
  bcc_addresses: string[];
  subject: string;
  body_text: string;
  attachment_refs: AttachmentRef[];
  reply_headers: ReplyHeaders;
}
export interface DraftRow extends DraftFields {
  id: string;
  account_id: string;
  account: string;
  send_state: SendState;
  saved_at: string;
  revision: number;
  updated_at: string;
  sent_action_id: string | null;
  provider_message_id: string | null;
  action_state: string | null;
  action_verb: string | null;
  outbox_state: string | null;
  error_code: string | null;
  provider_ack: Record<string, unknown> | null;
}
export interface Saved { draft_id: string; revision: number; saved_at: string; send_state: SendState }

export const emptyFields = (): DraftFields => ({ thread_id: null, to_addresses: [], cc_addresses: [], bcc_addresses: [], subject: "", body_text: "", attachment_refs: [], reply_headers: { in_reply_to: null, references: [], thread_id: null } });

export function saveDraft(client: RpcClient, draftId: string | null, accountId: string, fields: DraftFields, expectedRevision?: number | null): Promise<CommandResult<Saved>> {
  return callCommand<Saved>(client, "draft_save", { p_draft: draftId, p_account: accountId, p_fields: fields, p_expected_revision: expectedRevision ?? null });
}
export function getDraft(client: RpcClient, id: string): Promise<CommandResult<DraftRow>> {
  return callCommand<DraftRow>(client, "draft_get", { p_draft: id });
}
export function listDrafts(client: RpcClient): Promise<CommandResult<{ drafts: DraftRow[]; sent: DraftRow[] }>> {
  return callCommand(client, "draft_list", {});
}
export function discardDraft(client: RpcClient, id: string): Promise<CommandResult<{ draft_id: string; discarded: true; draft: DraftRow }>> {
  return callCommand(client, "draft_discard", { p_draft: id });
}

/** The snapshot the hash binds, as send_review built it from the row. */
export interface ExactSend {
  account_id: string;
  from_identity: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body_text: string;
  attachments: AttachmentRef[];
  reply_headers: ReplyHeaders;
  draft_id: string;
  draft_revision: number;
  client_message_id: string;
}
export interface Review {
  review: { action_id: string; review_nonce: string; payload_hash: string; expires_at: string; outbox_id: string };
  exact: ExactSend;
  warnings: string[];
  verb: string;
  draft_revision: number;
}
export function reviewSend(client: RpcClient, draftId: string, expectedRevision: number | null): Promise<CommandResult<Review>> {
  return callCommand<Review>(client, "send_review", { p_draft: draftId, p_expected_revision: expectedRevision });
}

export type Outcome = "confirmed" | "failed" | "outcome_unknown" | "pending" | string;
export interface SendAnswer { ok: true; action_id: string; replay: boolean; outcome: Outcome; provider_message_id: string | null; draft: DraftRow | null }
export const sendApproved = (token: string | null | undefined, body: { draft_id: string; review_nonce: string; shown_payload_hash: string; request_id: string }, doFetch?: Fetch) =>
  apiPost<SendAnswer>("/api/email/send", body, token, doFetch);
export interface ReconcileAnswer { ok: true; state: string; found: boolean | null; provider_message_id?: string; draft?: DraftRow | null; checked_at?: string }
export const reconcileSend = (token: string | null | undefined, actionId: string, doFetch?: Fetch) =>
  apiPost<ReconcileAnswer>("/api/email/reconcile", { action_id: actionId }, token, doFetch);

// ---- addresses --------------------------------------------------------------

export const ADDRESS = /^[^\s@<>,;"\\]+@[^\s@<>,;"\\]+\.[^\s@<>,;"\\]+$/;
export const isAddress = (a: string): boolean => ADDRESS.test(a.trim()) && a.trim().length <= 320;

/** "Name <a@b.test>, c@d.test; e@f.test" to its bare addresses, in order, each once. */
export function splitAddresses(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // Split only on the commas, semicolons and line breaks BETWEEN entries: a
  // display name may hold a comma ("Doe, Jane" <jane@x.test>).
  const pieces: string[] = [];
  let quoted = false, angled = false, cur = "";
  for (const ch of raw) {
    if (ch === "\"") quoted = !quoted;
    else if (ch === "<" && !quoted) angled = true;
    else if (ch === ">" && !quoted) angled = false;
    if ((ch === "," || ch === ";" || ch === "\n") && !quoted && !angled) { pieces.push(cur); cur = ""; continue; }
    cur += ch;
  }
  pieces.push(cur);
  for (const piece of pieces) {
    const m = /<([^<>]+)>/.exec(piece);
    const a = (m ? m[1]! : piece).trim().replace(/^"|"$/g, "").trim();
    if (!a) continue;
    const low = a.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    out.push(a);
  }
  return out;
}

/** The addresses that are not addresses, so the field can be marked before the review refuses it. */
export const badAddresses = (list: readonly string[]): string[] => list.filter((a) => !isAddress(a));

/** The domain lowercased, the local part as typed: what the server binds. */
export function normalizeAddress(a: string): string {
  const t = a.trim();
  const i = t.indexOf("@");
  return i < 0 ? t : t.slice(0, i) + "@" + t.slice(i + 1).toLowerCase();
}

// ---- replies ----------------------------------------------------------------

/** The fields of a reply, from the message's own headers: the sender (or its Reply-To), the subject with its Re:, the thread, the ids. Reply All keeps everyone else, drops the person's own addresses, and never pulls a Bcc from history (there is none to pull). */
export function replyFields(m: MessageDetail, own: readonly string[], all: boolean): DraftFields {
  const mine = new Set(own.map((a) => a.toLowerCase()));
  const h = m.reply_headers ?? {};
  const to = (h.reply_to && isAddress(h.reply_to) ? h.reply_to : m.from_address).trim();
  const seen = new Set<string>([to.toLowerCase(), ...mine]);
  const cc: string[] = [];
  if (all) {
    for (const a of [m.from_address, ...m.to_addresses.map((x) => x.address), ...m.cc_addresses.map((x) => x.address)]) {
      const low = a.trim().toLowerCase();
      if (!low || seen.has(low) || !isAddress(a)) continue;
      seen.add(low);
      cc.push(a.trim());
    }
  }
  const mid = h.message_id?.trim() || null;
  const refs = [...(h.references ?? []).map((r) => r.trim()).filter(Boolean)];
  if (mid && !refs.includes(mid)) refs.push(mid);
  return {
    thread_id: m.thread_id || null,
    to_addresses: [to],
    cc_addresses: cc,
    bcc_addresses: [],
    subject: replySubject(m.subject),
    body_text: "",
    attachment_refs: [],
    reply_headers: { in_reply_to: mid, references: refs, thread_id: m.thread_id || null },
  };
}

// ---- the local store (11: autosave on this device; recovery after a reload) -

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const localKey = (userId: string): string => ACCOUNT_PREFIX + mailAccountKey({ userId, account: "unified" }) + ":drafts.v1";
const LOCAL_MAX = 50;

export interface LocalDraft {
  /** The server's id once it has one; a device-made key before that. */
  key: string;
  draft_id: string | null;
  account_id: string;
  fields: DraftFields;
  /** The server revision this device last saw, for the next save. */
  revision: number | null;
  saved_at: string;
  server_saved_at: string | null;
}

export function loadLocalDrafts(userId: string, storage: Store = localStorage): Record<string, LocalDraft> {
  try {
    const raw = JSON.parse(storage.getItem(localKey(userId)) || "{}") as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, LocalDraft>) : {};
  } catch { return {}; }
}

export function saveLocalDraft(userId: string, d: LocalDraft, storage: Store = localStorage): void {
  const all = loadLocalDrafts(userId, storage);
  all[d.key] = d;
  const keys = Object.keys(all).sort((x, y) => all[y]!.saved_at.localeCompare(all[x]!.saved_at));
  for (const k of keys.slice(LOCAL_MAX)) delete all[k];
  try { storage.setItem(localKey(userId), JSON.stringify(all)); } catch { /* private mode */ }
}

export function clearLocalDraft(userId: string, key: string, storage: Store = localStorage): void {
  const all = loadLocalDrafts(userId, storage);
  if (!(key in all)) return;
  delete all[key];
  try { storage.setItem(localKey(userId), JSON.stringify(all)); } catch { /* private mode */ }
}

/** A local copy that was never saved to the server, or edited since: what a reload must not lose. */
export function unsavedLocal(userId: string, storage: Store = localStorage): LocalDraft[] {
  return Object.values(loadLocalDrafts(userId, storage)).filter((d) => !d.server_saved_at || d.saved_at > d.server_saved_at).sort((a, b) => b.saved_at.localeCompare(a.saved_at));
}

export const newLocalKey = (now: () => Date = () => new Date()): string => "local:" + now().getTime().toString(36) + ":" + Math.random().toString(36).slice(2, 8);

/** The same words in both copies: nothing to choose between. */
export function sameFields(a: DraftFields, b: DraftFields): boolean {
  return JSON.stringify(canonicalFields(a)) === JSON.stringify(canonicalFields(b));
}
export function canonicalFields(f: DraftFields): DraftFields {
  return {
    thread_id: f.thread_id || null,
    to_addresses: [...f.to_addresses], cc_addresses: [...f.cc_addresses], bcc_addresses: [...f.bcc_addresses],
    subject: f.subject, body_text: f.body_text,
    attachment_refs: f.attachment_refs.map((r) => ({ storage_id: r.storage_id, filename: r.filename, size_bytes: r.size_bytes, sha256: r.sha256, mime_type: r.mime_type })),
    reply_headers: { in_reply_to: f.reply_headers.in_reply_to || null, references: [...f.reply_headers.references], thread_id: f.reply_headers.thread_id || null },
  };
}

/** The fields of a server row, as the composer edits them. */
export const fieldsOf = (d: DraftRow): DraftFields => canonicalFields({ thread_id: d.thread_id, to_addresses: d.to_addresses, cc_addresses: d.cc_addresses, bcc_addresses: d.bcc_addresses, subject: d.subject, body_text: d.body_text, attachment_refs: d.attachment_refs, reply_headers: d.reply_headers ?? { in_reply_to: null, references: [], thread_id: null } });

export const MAX_ATTACHMENTS_BYTES = 20 * 1024 * 1024;
export const attachmentsBytes = (refs: readonly AttachmentRef[]): number => refs.reduce((n, r) => n + r.size_bytes, 0);

/** SHA-256 of bytes as lowercase hex: the hash an attachment ref carries, computed here from the bytes that were uploaded. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = new Uint8Array(bytes.byteLength);
  buf.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A review is good for five minutes (07.1). */
export function reviewExpired(expiresAt: string, now: Date): boolean {
  const e = Date.parse(expiresAt);
  return !Number.isFinite(e) || now.getTime() >= e;
}

/** The outcome word for a sent row. */
export function outcomeOf(d: Pick<DraftRow, "send_state" | "action_state" | "outbox_state">): "sent" | "failed" | "unknown" | "sending" | "draft" {
  if (d.send_state === "sent") return "sent";
  if (d.send_state === "unknown") return "unknown";
  if (d.send_state === "failed") return "failed";
  if (d.send_state === "sending") {
    if (d.outbox_state === "confirmed") return "sent";
    if (d.outbox_state === "outcome_unknown") return "unknown";
    if (d.outbox_state === "failed" || d.outbox_state === "cancelled") return "failed";
    return "sending";
  }
  return "draft";
}
