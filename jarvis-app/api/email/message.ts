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
export const config = { runtime: "edge" };

import { authedUser, bodyOf, ensureAccount, failResponse, fail, gmail, gmailFail, isEmail, isId, json, mailboxToken, readEnv, readBody, serviceRpc, serviceSelect, type EmailEnv } from "../_email";
import type { GmailFull } from "../../src/connections/google/map";

export const OPS = ["open", "read", "unread", "archive", "unarchive", "trash", "untrash"] as const;
export type Op = (typeof OPS)[number];

interface Body extends Record<string, unknown> { email?: unknown; id?: unknown; op?: unknown }

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
    const a = await gmail(tok.accessToken, `/messages/${encodeURIComponent(providerId)}?format=full`, { safeRead: true });
    if (!a.ok) return failResponse(gmailFail(a));
    const full = a.body as GmailFull;
    const b = bodyOf(full);
    const stored = await serviceRpc(env, "email_body_store", { p_owner: who.id, p_message: cached.id, p_text: b.text, p_html: b.html, p_attachments: b.attachments });
    if (stored.error) return failResponse(fail("UNAVAILABLE"));
    // Labels can have moved since the list was read; the open answers with the truth.
    await serviceRpc(env, "email_labels_set", { p_owner: who.id, p_message: cached.id, p_labels: full.labelIds ?? cached.provider_labels });
    return json({ ok: true, message_id: cached.id, labels: full.labelIds ?? cached.provider_labels, attachments: b.attachments.length });
  }

  // A label command: the desired state, and Gmail's answer becomes the cache.
  let answer;
  if (op === "trash") answer = await gmail(tok.accessToken, `/messages/${encodeURIComponent(providerId)}/trash`, { method: "POST" });
  else if (op === "untrash") answer = await gmail(tok.accessToken, `/messages/${encodeURIComponent(providerId)}/untrash`, { method: "POST" });
  else {
    const add = op === "unread" ? ["UNREAD"] : op === "unarchive" ? ["INBOX"] : [];
    const remove = op === "read" ? ["UNREAD"] : op === "archive" ? ["INBOX"] : [];
    answer = await gmail(tok.accessToken, `/messages/${encodeURIComponent(providerId)}/modify`, { method: "POST", body: { addLabelIds: add, removeLabelIds: remove } });
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
