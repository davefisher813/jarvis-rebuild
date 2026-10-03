// SEND THIS MESSAGE (docs/jarvis-unified, slice 07; IMPLEMENTATION-SPEC.md
// 07.3, 09 M6, M7; 13 "Provider send timeout"). The final tap. As the person,
// send_approve consumes the review (the draft row is the lock: one action for
// two taps or two devices, a different hash or a moved revision refused). Then,
// as the server and outside any transaction, this request carries out THAT
// command and no other: the worker claims it under 0046's fence, marks it
// dispatched, makes the one Gmail call through dispatchFor, settles, and the
// draft is marked from the settled state. The answer is the draft as the
// person may read it: sent with the provider's id, failed with Review Again a
// tap away, or unknown with resend shut. Nothing is queued for later; an
// offline tap never reaches here because the browser does not send one.
export const config = { runtime: "edge" };

import { authedUser, bearerOf, failResponse, fail, isId, json, readEnv, readBody, serviceRpc, serviceSelect, userRpc, type EmailEnv } from "../_email";
import { dispatchFor } from "../_send";
import { runOutboxOnce, type WorkerDeps, type WorkerResult } from "../../src/substrate/outbox/worker";
import { COMMAND_LINES, isCommandErrorCode } from "../../src/substrate/commands/errors";

interface Body extends Record<string, unknown> { draft_id?: unknown; review_nonce?: unknown; shown_payload_hash?: unknown; request_id?: unknown }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX = /^[0-9a-f]{16,128}$/;

interface OutboxRow { id: string; state: string; error_code: string | null; provider_ack: { message_id?: string } | null }

/** The database's refusal, passed through with its own code so the screen shows the right line. */
function refusal(d: Record<string, unknown>, status = 409): Response {
  const code = isCommandErrorCode(d.error) ? d.error : "UNAVAILABLE";
  return json({ ...d, code, safe_message: COMMAND_LINES[code] }, status);
}

/** The draft's outcome from the outbox row the worker settled: sent, failed (a cancelled or refused command too), or unknown. */
export async function settleDraft(env: EmailEnv, actionId: string): Promise<{ state: string; provider_message_id: string | null } | null> {
  const ob = (await serviceSelect<OutboxRow>(env, "outbox_command", `action_id=eq.${actionId}&select=id,state,error_code,provider_ack`))?.[0];
  if (!ob) return null;
  const state = ob.state === "confirmed" ? "confirmed" : ob.state === "outcome_unknown" ? "outcome_unknown" : ob.state === "failed" || ob.state === "cancelled" ? "failed" : null;
  if (!state) return { state: ob.state, provider_message_id: null };
  const id = state === "confirmed" ? ob.provider_ack?.message_id ?? null : null;
  await serviceRpc(env, "draft_outcome", { p_action: actionId, p_state: state, p_provider_message_id: id });
  return { state, provider_message_id: id };
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ code: "INVALID_PAYLOAD", safe_message: "POST only" }, 405);
  const env = readEnv();
  if (!env) return failResponse(fail("UNAVAILABLE"));
  const who = await authedUser(req, env);
  if ("code" in who) return failResponse(who);
  const token = bearerOf(req);
  const body = await readBody<Body>(req);
  const draftId = body?.draft_id, nonce = body?.review_nonce, hash = body?.shown_payload_hash, requestId = body?.request_id;
  if (typeof draftId !== "string" || !UUID.test(draftId) || typeof nonce !== "string" || !HEX.test(nonce) || typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash) || !isId(requestId)) {
    return failResponse(fail("INVALID_PAYLOAD"));
  }

  // The tap, as the person.
  const tap = await userRpc(env, token, "send_approve", { p_draft: draftId, p_review_nonce: nonce, p_shown_payload_hash: hash, p_idempotency_key: requestId });
  if (tap.error || !tap.data || typeof tap.data !== "object") return failResponse(fail("UNAVAILABLE"));
  const t = tap.data as Record<string, unknown>;
  if (typeof t.error === "string") return refusal(t);
  const actionId = String(t.action_id ?? "");
  if (!UUID.test(actionId)) return failResponse(fail("UNAVAILABLE"));

  // Dead claims past their lease become unknowns before anything else runs (0046's sweep); best effort.
  await serviceRpc(env, "outbox_sweep", {});

  // This command, now, as the server, outside any transaction.
  const region = (req.headers.get("x-vercel-id") || "edge").split("::")[0];
  const deps: WorkerDeps = { rpc: (fn, args) => serviceRpc(env, fn, args ?? {}), dispatch: dispatchFor(env), worker: `vercel:${region}`, action: actionId };
  let result: WorkerResult = { handled: false };
  for (let i = 0; i < 2; i++) {
    result = await runOutboxOnce(deps);
    if (!(result.handled && "state" in result && result.state === "lease_lost")) break;
  }
  const settled = await settleDraft(env, actionId);

  const read = await userRpc(env, token, "draft_get", { p_draft: draftId });
  const draft = read.error ? null : read.data;
  return json({ ok: true, action_id: actionId, replay: t.replay === true, outcome: settled?.state ?? (result.handled && "state" in result ? result.state : "pending"), provider_message_id: settled?.provider_message_id ?? null, draft });
}
