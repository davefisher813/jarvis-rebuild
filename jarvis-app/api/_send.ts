// THE PROVIDER CALL (docs/jarvis-unified, slice 07; IMPLEMENTATION-SPEC.md
// 07.3, 11; API-AND-VALIDATION.md "Race handling"). The one function the
// outbox worker hands a claimed send_email command to. Before anything
// leaves it re-derives: the draft is still the one reviewed, at the revision
// the hash bound, in this action's hands; the account is still connected and
// is the From identity; every attachment's bytes are fetched with the service
// role and hashed against the ref the person reviewed. Then one Gmail call
// with a clock. A refusal before the call, or a definitive 4xx, is a failure
// the person can review again; a timeout, a dropped connection or a 5xx after
// the body went is UNKNOWN, and an unknown is never retried by anyone. The
// token never leaves this process; nothing here retries on its own.

import { mailboxToken, serviceRpc, serviceSelect, type EmailEnv } from "./_email";
import { buildRawMessage, sha256Hex, type ExactAttachment, type ExactSend } from "./_mime";
import { UNKNOWN_LINE, type ClaimedCommand, type DispatchOutcome } from "../src/substrate/outbox/worker";

export const GMAIL_SEND_TIMEOUT_MS = 20_000;
export const BUCKET = "user-files";
const GMAIL_SEND = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

/** The receipt's line for a send, the same words send_review chose. */
export function verbOf(exact: ExactSend): string {
  const n = exact.to.length + exact.cc.length + exact.bcc.length;
  return `${exact.reply_headers.in_reply_to ? "Sent Reply to " : "Sent to "}${exact.to[0] ?? ""}${n > 1 ? ` and ${n - 1} More` : ""}`.slice(0, 200);
}

const NOT_SENT: Record<string, string> = {
  REVIEW_CHANGED: "Not Sent · The Draft Changed After the Review",
  PROVIDER_AUTH: "Not Sent · Reconnect Gmail",
  PROVIDER_SCOPE: "Not Sent · Gmail Needs Permission to Send · Reconnect in Connections",
  RATE_LIMITED: "Not Sent · Gmail Needs a Moment · Review It Again Shortly",
  INVALID_PAYLOAD: "Not Sent · Gmail Refused the Message",
  STORAGE_LIMIT: "Not Sent · Gmail Refused the Size",
  UNAVAILABLE: "Not Sent · Couldn't Reach Gmail · Review It Again",
  ATTACHMENT_MISSING: "Not Sent · An Attachment Is Missing",
  ATTACHMENT_CHANGED: "Not Sent · An Attachment Changed Since the Review",
  UNSUPPORTED: "Not Sent · Not a Message This Door Sends",
};
const refused = (code: string, verb?: string): DispatchOutcome => ({ kind: "refused", code, verb: verb ?? NOT_SENT[code] ?? `Not Sent · ${code}` });

export interface DraftRow { id: string; revision: number; send_state: string; sent_action_id: string | null; account_id: string }

/** Null when the draft is still exactly the reviewed one in this action's hands; else the refusal. */
export async function draftStillExact(env: EmailEnv, cmd: ClaimedCommand, exact: ExactSend): Promise<string | null> {
  const rows = await serviceSelect<DraftRow>(env, "email_draft", `id=eq.${exact.draft_id}&owner_id=eq.${cmd.owner_id}&select=id,revision,send_state,sent_action_id,account_id`);
  if (rows === null) return "UNAVAILABLE";
  const d = rows[0];
  if (!d) return "REVIEW_CHANGED";
  if (d.revision !== exact.draft_revision || d.sent_action_id !== cmd.action_id || d.send_state !== "sending" || d.account_id !== exact.account_id) return "REVIEW_CHANGED";
  return null;
}

/** A storage path that stays inside the owner's own folder: owner first, then real segments only. */
export function insideOwnerFolder(owner: string, storageId: string): boolean {
  const segs = storageId.split("/");
  return segs.length >= 2 && segs[0] === owner && segs.every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

/** The bytes the person reviewed, or why not: fetched with the service role from the owner's own folder, sized and hashed against the ref. */
export async function fetchAttachment(env: EmailEnv, owner: string, ref: ExactAttachment): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; code: string }> {
  // The owner's folder, segment by segment: a prefix test alone lets "<owner>/../<other>/x" through, and the
  // URL the fetch builds would fold the dots away and read with the service role. No empty, "." or ".." segment.
  if (!insideOwnerFolder(owner, ref.storage_id)) return { ok: false, code: "REVIEW_CHANGED" };
  let r: Response;
  try {
    r = await fetch(`${env.supaUrl}/storage/v1/object/${BUCKET}/${ref.storage_id.split("/").map(encodeURIComponent).join("/")}`, { headers: { apikey: env.service, Authorization: `Bearer ${env.service}` } });
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
  if (r.status === 404 || r.status === 400) return { ok: false, code: "ATTACHMENT_MISSING" };
  if (!r.ok) return { ok: false, code: "UNAVAILABLE" };
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.byteLength !== ref.size_bytes) return { ok: false, code: "ATTACHMENT_CHANGED" };
  if ((await sha256Hex(bytes)) !== ref.sha256) return { ok: false, code: "ATTACHMENT_CHANGED" };
  return { ok: true, bytes };
}

export interface GmailSendAnswer { status: number; body: { id?: string; threadId?: string; error?: { message?: string; status?: string } } | null }

/** One POST to Gmail's send with a clock. Throws on a timeout or a dropped connection: the caller reads that as unknown. */
export async function postToGmail(accessToken: string, raw: string, threadId: string | null, timeoutMs = GMAIL_SEND_TIMEOUT_MS, doFetch: typeof fetch = fetch): Promise<GmailSendAnswer> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await doFetch(GMAIL_SEND, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ raw, ...(threadId ? { threadId } : {}) }),
      signal: ctl.signal,
    });
    const body = (await r.json().catch(() => null)) as GmailSendAnswer["body"];
    return { status: r.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/** The worker's dispatch for this deployment. */
export function dispatchFor(env: EmailEnv, deps: { now?: () => Date; doFetch?: typeof fetch; timeoutMs?: number } = {}): (cmd: ClaimedCommand) => Promise<DispatchOutcome> {
  const now = deps.now ?? (() => new Date());
  return async (cmd) => {
    if (cmd.kind !== "send_email") return refused("UNSUPPORTED");
    const exact = cmd.payload as unknown as ExactSend;
    if (!exact || !Array.isArray(exact.to) || typeof exact.draft_id !== "string") return refused("INVALID_PAYLOAD");
    const verb = verbOf(exact);

    const stale = await draftStillExact(env, cmd, exact);
    if (stale) return refused(stale);

    const acct = (await serviceSelect<{ id: string; address: string; state: string }>(env, "email_account", `id=eq.${cmd.provider_account_id}&owner_id=eq.${cmd.owner_id}&select=id,address,state`))?.[0];
    if (!acct || acct.state !== "connected") return refused("PROVIDER_AUTH");
    if (acct.address.toLowerCase() !== String(exact.from_identity).toLowerCase() || acct.id !== exact.account_id) return refused("REVIEW_CHANGED");
    const tok = await mailboxToken(env, cmd.owner_id, acct.address, "send");
    if (!tok.ok) {
      if (tok.reauth) await serviceRpc(env, "email_account_state", { p_owner: cmd.owner_id, p_account: acct.id, p_state: "reauth", p_error: tok.fail.safe_message });
      return refused(tok.reauth ? "PROVIDER_AUTH" : "UNAVAILABLE");
    }

    const parts: Array<{ filename: string; mime: string; bytes: Uint8Array }> = [];
    for (const ref of exact.attachments ?? []) {
      const got = await fetchAttachment(env, cmd.owner_id, ref);
      if (!got.ok) return refused(got.code);
      parts.push({ filename: ref.filename, mime: ref.mime_type, bytes: got.bytes });
    }
    let raw: string;
    try {
      raw = buildRawMessage(exact, parts, now());
    } catch {
      return refused("INVALID_PAYLOAD");
    }

    let answer: GmailSendAnswer;
    try {
      answer = await postToGmail(tok.accessToken, raw, exact.reply_headers?.thread_id ?? null, deps.timeoutMs, deps.doFetch);
    } catch {
      return { kind: "unknown", verb: UNKNOWN_LINE };
    }
    if (answer.status >= 200 && answer.status < 300 && answer.body?.id) {
      return { kind: "ack", verb, ack: { provider: "gmail", account_id: cmd.provider_account_id, message_id: answer.body.id, thread_id: answer.body.threadId ?? null, accepted_at: now().toISOString(), client_message_id: exact.client_message_id } };
    }
    if (answer.status === 401) {
      await serviceRpc(env, "email_account_state", { p_owner: cmd.owner_id, p_account: acct.id, p_state: "reauth", p_error: "Reconnect Gmail to continue." });
      return refused("PROVIDER_AUTH");
    }
    if (answer.status === 403) return refused("PROVIDER_SCOPE");
    if (answer.status === 429) return refused("RATE_LIMITED");
    if (answer.status === 413) return refused("STORAGE_LIMIT");
    if (answer.status >= 400 && answer.status < 500) return refused("INVALID_PAYLOAD");
    // A 5xx or a 2xx without an id after the body went: it may have left.
    return { kind: "unknown", verb: UNKNOWN_LINE };
  };
}
