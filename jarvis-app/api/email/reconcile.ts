// CHECK AGAIN (docs/jarvis-unified, slice 07; IMPLEMENTATION-SPEC.md 07.3
// "reconcile by stable Message-ID"; 13 "Provider send timeout"). A send whose
// outcome is unknown is settled only with evidence: the message found in Gmail
// under the deterministic Message-ID the review bound. Found means confirmed
// (the provider's id on the receipt and the draft). Not found proves nothing:
// the attempt stays unknown, resend stays shut, and the person is told to
// look in Gmail. Nothing here sends.
export const config = { runtime: "edge" };

import { authedUser, bearerOf, failResponse, fail, gmail, gmailFail, json, mailboxToken, readEnv, readBody, recordAccountFailure, serviceRpc, serviceSelect, userRpc } from "../_email";
import { verbOf } from "../_send";
import type { ExactSend } from "../_mime";

interface Body extends Record<string, unknown> { action_id?: unknown }
interface OutboxRow { id: string; state: string; kind: string; payload: ExactSend; provider_account_id: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ code: "INVALID_PAYLOAD", safe_message: "POST only" }, 405);
  const env = readEnv();
  if (!env) return failResponse(fail("UNAVAILABLE"));
  const who = await authedUser(req, env);
  if ("code" in who) return failResponse(who);
  const body = await readBody<Body>(req);
  const actionId = body?.action_id;
  if (typeof actionId !== "string" || !UUID.test(actionId)) return failResponse(fail("INVALID_PAYLOAD"));

  const ob = (await serviceSelect<OutboxRow>(env, "outbox_command", `action_id=eq.${actionId}&owner_id=eq.${who.id}&select=id,state,kind,payload,provider_account_id`))?.[0];
  if (!ob || ob.kind !== "send_email") return failResponse(fail("NOT_FOUND"));
  if (ob.state !== "outcome_unknown") return json({ ok: true, state: ob.state, found: null });

  const acct = (await serviceSelect<{ id: string; address: string; state: string }>(env, "email_account", `id=eq.${ob.provider_account_id}&owner_id=eq.${who.id}&select=id,address,state`))?.[0];
  if (!acct) return failResponse(fail("NOT_FOUND"));
  const tok = await mailboxToken(env, who.id, acct.address);
  if (!tok.ok) {
    await recordAccountFailure(env, who.id, acct.id, tok.fail);
    return failResponse(tok.fail);
  }
  const exact = ob.payload;
  const mid = String(exact?.client_message_id ?? "");
  if (!mid) return json({ ok: true, state: "outcome_unknown", found: false });
  const a = await gmail(tok.accessToken, `/messages?q=${encodeURIComponent("rfc822msgid:" + mid.replace(/^<|>$/g, ""))}&maxResults=1`, { safeRead: true });
  if (!a.ok) return failResponse(gmailFail(a));
  const hit = ((a.body as { messages?: Array<{ id: string; threadId?: string }> } | null)?.messages ?? [])[0];
  if (!hit) return json({ ok: true, state: "outcome_unknown", found: false, checked_at: new Date().toISOString() });

  const rec = await serviceRpc(env, "outbox_reconcile", { p_outbox: ob.id, p_state: "confirmed", p_verb: verbOf(exact), p_evidence: { provider: "gmail", provider_message_id: hit.id, thread_id: hit.threadId ?? null, reconciled_at: new Date().toISOString() } });
  if (rec.error || (rec.data && typeof rec.data === "object" && "error" in (rec.data as object))) return failResponse(fail("UNAVAILABLE"));
  await serviceRpc(env, "draft_outcome", { p_action: actionId, p_state: "confirmed", p_provider_message_id: hit.id });
  const read = await userRpc(env, bearerOf(req), "draft_get", { p_draft: exact.draft_id });
  return json({ ok: true, state: "confirmed", found: true, provider_message_id: hit.id, draft: read.error ? null : read.data });
}
