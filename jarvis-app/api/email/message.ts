// ONE MESSAGE, ON THE PERSON'S TAP (docs/jarvis-unified, slice 05;
// IMPLEMENTATION-SPEC.md 08 E05, E06, E29; 11). Five operations, each a
// user-origin provider command with the desired state carried in it:
//
//   open      read the full message in and store its body in the cache
//   read      remove UNREAD; unread adds it back; the cache follows Gmail
//   archive   remove INBOX (a receipt); trash moves to Gmail's Trash, which
//             is recoverable for 30 days (a receipt); untrash brings it back
//             (a receipt). There is no permanent delete here, by design.
//
// The cache is written only with what Gmail answered, never with what was
// asked for, so a conflict with another device resolves to the provider.
//
// THE SAME DOOR, IN BULK (Email v1 spec section 11, V04). A body with `items`
// instead of `id` is a batch: { op, items: [{ email, id }] }, at most 100
// explicit message ids, each acted on by its own id (never its thread).
// Grouped per account, one users.messages.batchModify each, then every id is
// read back (format=minimal) so each item answers for itself: accepted (Gmail
// holds the desired labels), conflict (it holds something else), unknown (the
// read back failed after Gmail took the command) or failed (nothing was
// changed: not in the cache, the account needs reconnecting, Gmail refused).
// Trash here is the TRASH label added and INBOX removed: recoverable in Gmail's
// Trash, never a permanent delete. It rides this file because the plan caps
// the API's function files.
export const config = { runtime: "edge" };

import { authedUser, bodyOf, ensureAccount, failResponse, fail, firstAddress, gmail, gmailFail, headerOf, isEmail, isId, json, mailboxToken, readEnv, readBody, serviceRpc, serviceSelect, type EmailCode, type EmailEnv, type Fail, type MailboxAuth } from "../_email";
import type { GmailFull } from "../../src/connections/google/map";

export const OPS = ["open", "read", "unread", "archive", "unarchive", "trash", "untrash"] as const;
export type Op = (typeof OPS)[number];

interface Body extends Record<string, unknown> { email?: unknown; id?: unknown; op?: unknown; items?: unknown }

interface CachedMessage { id: string; subject: string; provider_labels: string[] }

async function cachedMessage(env: EmailEnv, userId: string, accountId: string, providerId: string): Promise<CachedMessage | null> {
  const rows = await serviceSelect<CachedMessage>(env, "email_message", `owner_id=eq.${userId}&account_id=eq.${accountId}&provider_id=eq.${encodeURIComponent(providerId)}&select=id,subject,provider_labels`);
  return rows?.[0] ?? null;
}

type Receipted = "archive" | "unarchive" | "trash" | "untrash";
const KIND: Record<Receipted, string> = { archive: "archive_mail", unarchive: "unarchive_mail", trash: "trash_mail", untrash: "untrash_mail" };
const VERB: Record<Receipted, (subject: string) => string> = {
  archive: (s) => `Archived · ${s || "A Message"}`,
  unarchive: (s) => `Put Back in Inbox · ${s || "A Message"}`,
  trash: (s) => `Moved to Trash · ${s || "A Message"}`,
  untrash: (s) => `Restored From Trash · ${s || "A Message"}`,
};
const isReceipted = (op: Op): op is Receipted => op === "archive" || op === "unarchive" || op === "trash" || op === "untrash";

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const env = readEnv();
  if (!env) return failResponse(fail("UNAVAILABLE"));
  const who = await authedUser(req, env);
  if ("code" in who) return failResponse(who);
  const body = await readBody<Body>(req);
  if (body && Array.isArray(body.items)) return batch(env, who.id, body);
  if (!body || !isEmail(body.email) || !isId(body.id) || !(OPS as readonly unknown[]).includes(body.op)) return failResponse(fail("INVALID_PAYLOAD"));
  const email = body.email.toLowerCase();
  const op = body.op as Op;
  const providerId = body.id;

  const account = await ensureAccount(env, who.id, email);
  if ("code" in account) return failResponse(account);
  // The message must already be the person's, in their cache: this door
  // never fetches an id it was merely handed.
  const cached = await cachedMessage(env, who.id, account.id, providerId);
  if (!cached) return failResponse(fail("NOT_FOUND"));
  const tok = await mailboxToken(env, who.id, email);
  if (!tok.ok) {
    if (tok.reauth) await serviceRpc(env, "email_account_state", { p_owner: who.id, p_account: account.id, p_state: "reauth", p_error: tok.fail.safe_message });
    return failResponse(tok.fail);
  }

  if (op === "open") {
    const a = await gmail(tok, `/messages/${encodeURIComponent(providerId)}?format=full`, { safeRead: true });
    if (!a.ok) return failResponse(gmailFail(a));
    const full = a.body as GmailFull;
    const b = bodyOf(full);
    // The headers a reply needs (slice 07): kept with the body, never guessed later.
    const hs = full.payload?.headers;
    const headers = {
      message_id: headerOf(hs, "Message-ID") || headerOf(hs, "Message-Id"),
      in_reply_to: headerOf(hs, "In-Reply-To"),
      references: headerOf(hs, "References").split(/\s+/).filter(Boolean),
      reply_to: firstAddress(headerOf(hs, "Reply-To")).address,
    };
    const stored = await serviceRpc(env, "email_body_store", { p_owner: who.id, p_message: cached.id, p_text: b.text, p_html: b.html, p_attachments: b.attachments, p_headers: headers });
    if (stored.error) return failResponse(fail("UNAVAILABLE"));
    // Labels can have moved since the list was read; the open answers with the truth.
    await serviceRpc(env, "email_labels_set", { p_owner: who.id, p_message: cached.id, p_labels: full.labelIds ?? cached.provider_labels });
    return json({ ok: true, message_id: cached.id, labels: full.labelIds ?? cached.provider_labels, attachments: b.attachments.length });
  }

  // A label command: the desired state, and Gmail's answer becomes the cache.
  let answer;
  if (op === "trash") answer = await gmail(tok, `/messages/${encodeURIComponent(providerId)}/trash`, { method: "POST" });
  else if (op === "untrash") answer = await gmail(tok, `/messages/${encodeURIComponent(providerId)}/untrash`, { method: "POST" });
  else {
    const add = op === "unread" ? ["UNREAD"] : op === "unarchive" ? ["INBOX"] : [];
    const remove = op === "read" ? ["UNREAD"] : op === "archive" ? ["INBOX"] : [];
    answer = await gmail(tok, `/messages/${encodeURIComponent(providerId)}/modify`, { method: "POST", body: { addLabelIds: add, removeLabelIds: remove } });
  }
  if (!answer.ok) return failResponse(gmailFail(answer));
  const labels = ((answer.body as { labelIds?: string[] }).labelIds ?? []);
  await serviceRpc(env, "email_labels_set", { p_owner: who.id, p_message: cached.id, p_labels: labels });

  // Archive, trash and untrash are actions with receipts (E29); read and
  // unread mirror a state and are not. The key is the command itself, so a
  // repeated tap or a retried request is the same receipt, and the provider's
  // answer rides on it.
  let receipt: string | null = null;
  if (isReceipted(op)) {
    const kind = KIND[op];
    const r = await serviceRpc(env, "email_action_record", {
      p_owner: who.id, p_message: cached.id, p_kind: kind, p_verb: VERB[op](cached.subject).slice(0, 200),
      p_idempotency: `${kind}:${cached.id}:${labels.slice().sort().join(",")}`, p_provider_ack: { labelIds: labels },
    });
    const got = r.data as { action_id?: string } | null;
    receipt = got?.action_id ?? null;
  }
  return json({ ok: true, message_id: cached.id, labels, read: !labels.includes("UNREAD"), in_inbox: labels.includes("INBOX"), in_trash: labels.includes("TRASH"), receipt });
}

// ---- the batch ----------------------------------------------------------------

export const BATCH_OPS = ["read", "unread", "archive", "unarchive", "trash", "untrash"] as const;
export type BatchOp = (typeof BATCH_OPS)[number];
/** Explicit message ids one request may name (spec 11). */
export const BATCH_MAX = 100;

/** The labels each op adds and removes. Trash is a label move, so Undo is the label move back. */
export const DELTA: Record<BatchOp, { add: string[]; remove: string[] }> = {
  read: { add: [], remove: ["UNREAD"] },
  unread: { add: ["UNREAD"], remove: [] },
  archive: { add: [], remove: ["INBOX"] },
  unarchive: { add: ["INBOX"], remove: [] },
  trash: { add: ["TRASH"], remove: ["INBOX"] },
  untrash: { add: ["INBOX"], remove: ["TRASH"] },
};

export type ItemStatus = "accepted" | "conflict" | "unknown" | "failed";
export interface ItemResult { email: string; id: string; status: ItemStatus; message_id?: string; labels?: string[]; read?: boolean; in_inbox?: boolean; receipt?: string | null; code?: EmailCode; retryable?: boolean }

interface Cached extends CachedMessage { provider_id: string }

const holds = (labels: string[], op: BatchOp): boolean => DELTA[op].add.every((l) => labels.includes(l)) && DELTA[op].remove.every((l) => !labels.includes(l));
const failedItem = (email: string, id: string, f: Fail): ItemResult => ({ email, id, status: "failed", code: f.code, retryable: f.retryable });

async function batch(env: EmailEnv, userId: string, body: Body): Promise<Response> {
  const items = body.items as unknown[];
  if (!(BATCH_OPS as readonly unknown[]).includes(body.op) || items.length === 0 || items.length > BATCH_MAX) return failResponse(fail("INVALID_PAYLOAD"));
  const op = body.op as BatchOp;
  // Each item is an exact (account, provider id); a repeated one is acted on once.
  const byAccount = new Map<string, string[]>();
  for (const it of items) {
    const x = it as { email?: unknown; id?: unknown } | null;
    if (!x || !isEmail(x.email) || !isId(x.id)) return failResponse(fail("INVALID_PAYLOAD"));
    const email = x.email.toLowerCase();
    const list = byAccount.get(email) ?? [];
    if (!list.includes(x.id)) list.push(x.id);
    byAccount.set(email, list);
  }
  const results: ItemResult[] = [];
  for (const [email, ids] of byAccount) results.push(...await batchOne(env, userId, email, ids, op));
  const tally = (s: ItemStatus) => results.filter((r) => r.status === s).length;
  return json({ ok: true, op, results, accepted: tally("accepted"), conflict: tally("conflict"), unknown: tally("unknown"), failed: tally("failed") });
}

/** One account's share of a batch: its own sign-in, one batchModify, every id read back. One account failing never touches another's. */
async function batchOne(env: EmailEnv, userId: string, email: string, ids: string[], op: BatchOp): Promise<ItemResult[]> {
  const account = await ensureAccount(env, userId, email);
  if ("code" in account) return ids.map((id) => failedItem(email, id, account));
  // Only ids already in the person's cache for this account: this door never acts on an id it was merely handed.
  const rows = await serviceSelect<Cached>(env, "email_message", `owner_id=eq.${userId}&account_id=eq.${account.id}&provider_id=in.(${ids.map(encodeURIComponent).join(",")})&select=id,subject,provider_labels,provider_id`);
  if (rows === null) return ids.map((id) => failedItem(email, id, fail("UNAVAILABLE")));
  const known = new Map(rows.map((r) => [r.provider_id, r]));
  const out: ItemResult[] = ids.filter((id) => !known.has(id)).map((id) => failedItem(email, id, fail("NOT_FOUND")));
  const acting = ids.filter((id) => known.has(id));
  if (acting.length === 0) return out;
  const tok = await mailboxToken(env, userId, email);
  if (!tok.ok) {
    if (tok.reauth) await serviceRpc(env, "email_account_state", { p_owner: userId, p_account: account.id, p_state: "reauth", p_error: tok.fail.safe_message });
    return [...out, ...acting.map((id) => failedItem(email, id, tok.fail))];
  }
  const sentCmd = await gmail(tok, "/messages/batchModify", { method: "POST", body: { ids: acting, addLabelIds: DELTA[op].add, removeLabelIds: DELTA[op].remove } });
  if (!sentCmd.ok) {
    const f = gmailFail(sentCmd);
    // A transport failure after the request left may or may not have landed: unknown, never failed (spec 11).
    const status: ItemStatus = sentCmd.status === 0 ? "unknown" : "failed";
    return [...out, ...acting.map((id) => ({ ...failedItem(email, id, f), status }))];
  }
  // batchModify answers with nothing; Gmail's current labels per id are the proof, and the cache follows them.
  const labelsOf = await readBack(tok, acting);
  for (const id of acting) {
    const cached = known.get(id)!;
    const labels = labelsOf.get(id);
    if (!labels) { out.push({ email, id, status: "unknown", message_id: cached.id }); continue; }
    await serviceRpc(env, "email_labels_set", { p_owner: userId, p_message: cached.id, p_labels: labels });
    const ok = holds(labels, op);
    let receipt: string | null = null;
    if (ok && isReceipted(op)) {
      const kind = KIND[op];
      const r = await serviceRpc(env, "email_action_record", {
        p_owner: userId, p_message: cached.id, p_kind: kind, p_verb: VERB[op](cached.subject).slice(0, 200),
        p_idempotency: `${kind}:${cached.id}:${labels.slice().sort().join(",")}`, p_provider_ack: { labelIds: labels, batch: true },
      });
      receipt = (r.data as { action_id?: string } | null)?.action_id ?? null;
    }
    out.push({ email, id, status: ok ? "accepted" : "conflict", message_id: cached.id, labels, read: !labels.includes("UNREAD"), in_inbox: labels.includes("INBOX"), receipt });
  }
  return out;
}

/** Each id's labels as Gmail holds them now, a few at a time; an id whose read fails is absent (its outcome is unknown). */
async function readBack(tok: MailboxAuth, ids: string[], concurrency = 6): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  let i = 0;
  const worker = async () => {
    while (i < ids.length) {
      const id = ids[i++]!;
      const a = await gmail(tok, `/messages/${encodeURIComponent(id)}?format=minimal`, { safeRead: true });
      if (a.ok) out.set(id, (a.body as { labelIds?: string[] } | null)?.labelIds ?? []);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  return out;
}
