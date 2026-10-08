// ONE ATTACHMENT, DOWNLOADED THROUGH THE SERVER (docs/jarvis-unified, slice
// 05; IMPLEMENTATION-SPEC.md 08 E23, 11). The message must be the person's
// and the attachment must be one its metadata names; the bytes come back as
// Gmail hands them (base64url) with the name and type the cache holds, and
// the size cap is enforced here before anything is fetched. Nothing is
// rendered: the app offers the file to save or open, never runs it.
export const config = { runtime: "edge" };

import { authedUser, ensureAccount, failResponse, fail, gmail, gmailFail, isEmail, isId, json, mailboxToken, readEnv, readBody, serviceSelect, type AttachmentMeta } from "../_email";

export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

interface Body extends Record<string, unknown> { email?: unknown; id?: unknown; attachmentId?: unknown }

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const env = readEnv();
  if (!env) return failResponse(fail("UNAVAILABLE"));
  const who = await authedUser(req, env);
  if ("code" in who) return failResponse(who);
  const body = await readBody<Body>(req);
  if (!body || !isEmail(body.email) || !isId(body.id) || typeof body.attachmentId !== "string" || body.attachmentId.length === 0 || body.attachmentId.length > 1024) return failResponse(fail("INVALID_PAYLOAD"));
  const email = body.email.toLowerCase();

  const account = await ensureAccount(env, who.id, email);
  if ("code" in account) return failResponse(account);
  const rows = await serviceSelect<{ id: string; attachment_metadata: AttachmentMeta[] }>(env, "email_message", `owner_id=eq.${who.id}&account_id=eq.${account.id}&provider_id=eq.${encodeURIComponent(body.id)}&select=id,attachment_metadata`);
  const msg = rows?.[0];
  if (!msg) return failResponse(fail("NOT_FOUND"));
  const meta = (msg.attachment_metadata ?? []).find((a) => a.attachmentId === body.attachmentId);
  if (!meta) return failResponse(fail("NOT_FOUND"));
  if (meta.size > ATTACHMENT_MAX_BYTES) return failResponse(fail("STORAGE_LIMIT"));

  const tok = await mailboxToken(env, who.id, email);
  if (!tok.ok) return failResponse(tok.fail);
  const a = await gmail(tok, `/messages/${encodeURIComponent(body.id)}/attachments/${encodeURIComponent(body.attachmentId)}`, { safeRead: true });
  if (!a.ok) return failResponse(gmailFail(a));
  const got = a.body as { data?: string; size?: number };
  if (!got.data) return failResponse(fail("UNAVAILABLE"));
  if ((got.size ?? 0) > ATTACHMENT_MAX_BYTES) return failResponse(fail("STORAGE_LIMIT"));
  return json({ ok: true, filename: meta.filename, mime: meta.mime, size: got.size ?? meta.size, data: got.data });
}
