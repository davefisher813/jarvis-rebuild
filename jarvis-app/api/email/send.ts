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

import { authedUser, bearerOf, failResponse, fail, isId, json, readEnv, readBody, serviceRpc, userRpc } from "../_email";
import { dispatchFor } from "../_send";
import { runOutboxOnce, type WorkerDeps, type WorkerResult } from "../../src/substrate/outbox/worker";
import { runOutboxWorker, settleDraft, WORKER_HEADER } from "../_outboxWorker";
import { COMMAND_LINES, isCommandErrorCode } from "../../src/substrate/commands/errors";

interface Body extends Record<string, unknown> { draft_id?: unknown; review_nonce?: unknown; shown_payload_hash?: unknown; request_id?: unknown; hold?: unknown }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX = /^[0-9a-f]{16,128}$/;

/** The database's refusal, passed through with its own code so the screen shows the right line. */
function refusal(d: Record<string, unknown>, status = 409): Response {
  const code = isCommandErrorCode(d.error) ? d.error : "UNAVAILABLE";
  return json({ ...d, code, safe_message: COMMAND_LINES[code] }, status);
}

export { settleDraft };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ code: "INVALID_PAYLOAD", safe_message: "POST only" }, 405);
  // The scheduled clock (pg_cron, migration 0059's worker): proven by the vault's token inside the worker, never by a session.
  if (req.headers.get(WORKER_HEADER) === "outbox") return runOutboxWorker(req);
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

  // The tap, as the person. With hold:true the approval is HELD on the server for 30 seconds (migration 0059, Dave's locked
  // decision 4): this request returns at once with the server's clock and the two timestamps, and the scheduled worker
  // (api/_outboxWorker.ts, reached through this route) is what sends, after the hold, never before. If the held door is not there (the migration has not
  // been applied) this refuses rather than send at once: a held send that goes out immediately would be a broken promise.
  const held = body?.hold === true;
  const tap = await userRpc(env, token, held ? "send_approve_held" : "send_approve", { p_draft: draftId, p_review_nonce: nonce, p_shown_payload_hash: hash, p_idempotency_key: requestId });
  if (tap.error || !tap.data || typeof tap.data !== "object") return failResponse(fail("UNAVAILABLE"));
  const t = tap.data as Record<string, unknown>;
  if (typeof t.error === "string") return refusal(t);
  const actionId = String(t.action_id ?? "");
  if (!UUID.test(actionId)) return failResponse(fail("UNAVAILABLE"));

  if (held) {
    const reread = await userRpc(env, token, "draft_get", { p_draft: draftId });
    return json({
      ok: true, held: true, action_id: actionId, replay: t.replay === true,
      hold_until: t.hold_until ?? null, dispatch_deadline: t.dispatch_deadline ?? null, server_now: t.server_now ?? null, outbox_state: t.outbox_state ?? null,
      draft: reread.error ? null : reread.data,
    });
  }

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
