// THE SCHEDULED HALF OF THE SEND HOLD (Email v1 spec 2026-10-08 section 9; migration 0059).
//
// An approved message is held on the server for 30 seconds. This is the clock that sends it: Postgres (pg_cron, every ten
// seconds, and only while there is something due) calls this route; it sweeps stranded commands, then claims and carries
// out whatever is past its hold, one command at a time under the outbox fence (src/substrate/outbox/worker.ts). The page
// does not have to stay open: closing the app mid-hold does not stop a healthy held send.
//
// What it can never do: send before hold_until (the database's claim refuses), send after dispatch_deadline (the claim
// cancels it as HOLD_EXPIRED and frees the draft), or send twice (the claim fence plus the one-way dispatched mark). A
// provider call that may have left is OUTCOME UNKNOWN and is never retried here (the worker's rule).
//
// It lives behind POST /api/email/send with the header `x-jarvis-worker: outbox` (api/email/send.ts hands the request here)
// and NOT as a route of its own: the host plan caps how many API files a deployment may hold, and a 31st one failed the
// build (2026-10-08). An underscore file is a module, not a function.
//
// POST only, and only with the bearer secret held in Postgres' vault: the worker asks the database whether the token is the
// one (outbox_cron_ok), so no secret lives in an env var, in a log or in the repo. With no secret set, or a wrong one, it
// refuses and does nothing. It answers counts, never an address, never a token, never mail.

import { fail, failResponse, json, readEnv, serviceRpc, serviceSelect, type EmailEnv } from "./_email";
import { dispatchFor } from "./_send";
import { runOutboxOnce, type WorkerDeps, type WorkerResult } from "../src/substrate/outbox/worker";

/** The header that routes a request to the worker instead of the person's send. */
export const WORKER_HEADER = "x-jarvis-worker";

interface OutboxRow { id: string; state: string; error_code: string | null; provider_ack: { message_id?: string } | null }

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

/** Commands carried out per call. A call is short; the next tick takes the next ones. */
export const MAX_PER_CALL = 5;
/** The edge function's own budget: stop starting new commands after this. */
export const BUDGET_MS = 20_000;

export async function runOutboxWorker(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405, { allow: "POST" });
  const env = readEnv();
  if (!env) return failResponse(fail("UNAVAILABLE"));

  const given = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  if (!given) return json({ code: "UNAUTHORIZED" }, 401);
  const ok = await serviceRpc(env, "outbox_cron_ok", { p_token: given });
  if (ok.error || ok.data !== true) return json({ code: "UNAUTHORIZED" }, 401);

  const started = Date.now();
  // Dead claims past their lease become unknowns first (0046's sweep).
  await serviceRpc(env, "outbox_sweep", {});

  const region = (req.headers.get("x-vercel-id") || "edge").split("::")[0];
  const deps: WorkerDeps = { rpc: (fn, args) => serviceRpc(env, fn, args ?? {}), dispatch: dispatchFor(env), worker: `cron:${region}` };
  const counts = { handled: 0, confirmed: 0, failed: 0, unknown: 0, skipped: 0, lease_lost: 0 };
  for (let i = 0; i < MAX_PER_CALL; i++) {
    if (Date.now() - started > BUDGET_MS) break;
    let r: WorkerResult;
    try {
      r = await runOutboxOnce(deps);
    } catch {
      break;
    }
    if (!r.handled) break;
    counts.handled++;
    if ("skipped" in r) counts.skipped++;
    else if (r.state === "confirmed") counts.confirmed++;
    else if (r.state === "failed") counts.failed++;
    else if (r.state === "outcome_unknown") counts.unknown++;
    else counts.lease_lost++;
    // The draft follows the command: sent, failed, or unknown. A skipped command (a deadline passed, an account gone) is
    // looked up by its outbox id.
    const actionId = "action_id" in r ? r.action_id : (await serviceSelect<{ action_id: string }>(env, "outbox_command", `id=eq.${r.outbox_id}&select=action_id`))?.[0]?.action_id;
    if (actionId) await settleDraft(env, actionId);
  }
  return json(counts, 200, { "cache-control": "no-store" });
}
