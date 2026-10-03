// THE OUTBOX WORKER (IMPLEMENTATION-SPEC.md 07.3; API-AND-VALIDATION.md "Race
// handling"). Runs on the server with the service role, never in a browser,
// and never inside a database transaction: claim one command under a fencing
// token, mark it dispatched (the one-way step), make the provider call, settle.
// The rules it cannot break are the database's (outbox_settle turns an unknown
// before dispatch into failed and a failure without a refusal code after
// dispatch into unknown); the rule it must keep is here: a throw or a timeout
// after the dispatched mark is OUTCOME UNKNOWN, and an unknown command is
// never retried by anyone. The Gmail call itself is slice 07's `dispatch`.

import type { RpcClient } from "../agentClient";

export interface ClaimedCommand {
  outbox_id: string;
  action_id: string;
  owner_id: string;
  kind: "send_email" | "modify_labels";
  payload: Record<string, unknown>;
  payload_hash: string;
  provider_account_id: string;
  claim_token: string;
  attempt: number;
  lease_until: string;
}

export type DispatchOutcome =
  /** The provider accepted it: its ids, and the receipt's verb ("Sent reply to coach@example.test"). */
  | { kind: "ack"; ack: Record<string, unknown>; verb: string }
  /** The provider refused it before anything left, with a definitive code (a 4xx that names the request). */
  | { kind: "refused"; code: string; verb: string }
  /** It may have left: a timeout, a dropped connection, a 5xx after the body went. */
  | { kind: "unknown"; verb?: string };

export interface WorkerDeps {
  rpc: RpcClient["rpc"];
  /** The provider call. Must not retry on its own; must throw or answer unknown when it cannot tell. */
  dispatch: (cmd: ClaimedCommand) => Promise<DispatchOutcome>;
  /** A name for the claim row: a deployment id, a region. */
  worker: string;
  /** How long the claim is good for, as a Postgres interval (case does not matter to Postgres). Default two minutes. */
  lease?: string;
  /** One command only: the action the request that approved it now carries out (outbox_claim_action, slice 07). Without it, the oldest queued command. */
  action?: string;
}

export type WorkerResult =
  | { handled: false }
  | { handled: true; outbox_id: string; skipped: string }
  | { handled: true; outbox_id: string; action_id: string; state: "confirmed" | "failed" | "outcome_unknown" | "lease_lost" };

export const UNKNOWN_LINE = "Send Status Unknown · Check Gmail Before Trying Again";

async function call(rpc: RpcClient["rpc"], fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await rpc(fn, args);
  if (error) throw new Error(`${fn} failed`);
  return data;
}

/** One command, start to finish. Call it again for the next; it answers handled:false when the queue is empty. */
export async function runOutboxOnce(deps: WorkerDeps): Promise<WorkerResult> {
  const claimed = (deps.action
    ? await call(deps.rpc, "outbox_claim_action", { p_worker: deps.worker, p_action: deps.action, p_lease: deps.lease ?? "2 Minutes" })
    : await call(deps.rpc, "outbox_claim", { p_worker: deps.worker, p_lease: deps.lease ?? "2 Minutes" })) as (ClaimedCommand & { skipped?: string; reason?: string }) | null;
  if (!claimed) return { handled: false };
  if (claimed.skipped) return { handled: true, outbox_id: claimed.skipped, skipped: claimed.reason ?? "SKIPPED" };

  const settle = (state: "confirmed" | "failed" | "outcome_unknown", verb: string, ack: Record<string, unknown> | null, error: string | null) =>
    call(deps.rpc, "outbox_settle", { p_outbox: claimed.outbox_id, p_claim_token: claimed.claim_token, p_state: state, p_verb: verb, p_provider_ack: ack, p_error: error });

  // The one-way step. If the lease is already gone, nothing leaves: another
  // worker may hold it, and two sends is the one thing worse than none.
  const marked = (await call(deps.rpc, "outbox_dispatched", { p_outbox: claimed.outbox_id, p_claim_token: claimed.claim_token })) as boolean;
  if (!marked) return { handled: true, outbox_id: claimed.outbox_id, action_id: claimed.action_id, state: "lease_lost" };

  let outcome: DispatchOutcome;
  try {
    outcome = await deps.dispatch(claimed);
  } catch {
    outcome = { kind: "unknown" };
  }

  if (outcome.kind === "ack") {
    await settle("confirmed", outcome.verb, outcome.ack, null);
    return { handled: true, outbox_id: claimed.outbox_id, action_id: claimed.action_id, state: "confirmed" };
  }
  if (outcome.kind === "refused") {
    await settle("failed", outcome.verb, null, outcome.code);
    return { handled: true, outbox_id: claimed.outbox_id, action_id: claimed.action_id, state: "failed" };
  }
  await settle("outcome_unknown", outcome.verb ?? UNKNOWN_LINE, null, "OUTCOME_UNKNOWN");
  return { handled: true, outbox_id: claimed.outbox_id, action_id: claimed.action_id, state: "outcome_unknown" };
}

/** Drain up to `max` commands. Stops at the first empty claim. */
export async function runOutbox(deps: WorkerDeps, max = 10): Promise<WorkerResult[]> {
  const out: WorkerResult[] = [];
  for (let i = 0; i < max; i++) {
    const r = await runOutboxOnce(deps);
    out.push(r);
    if (!r.handled) break;
  }
  return out;
}
