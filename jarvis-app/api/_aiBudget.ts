// Server side of the AI spending limit (migration 0043). Thin: every rule
// lives in the database functions, which serialise per user. This file only
// calls them with the SERVICE key and reads their verdicts. The caller has
// already authenticated the user; the id passed here is the verified one,
// never anything the browser sent.
//
// Every failure mode collapses to "unavailable", and unavailable means the
// caller does not spend. There is no path here that turns a failed count into
// a served call.

import type { BudgetStatus } from "../src/ai/aiBudget";

export interface BudgetEnv {
  supaUrl: string;
  serviceKey: string;
}

type Json = Record<string, unknown>;

async function rpc(env: BudgetEnv, fn: string, args: Json): Promise<Json | boolean | null> {
  try {
    const res = await fetch(`${env.supaUrl}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: env.serviceKey,
        Authorization: `Bearer ${env.serviceKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(args),
    });
    if (!res.ok) return null;
    return (await res.json()) as Json | boolean;
  } catch {
    return null;
  }
}

export type ReserveVerdict =
  | { status: "reserved" }
  | { status: "replay"; state: string }
  | { status: "hash_mismatch" }
  | { status: "over_limit"; remaining: number; limit: number }
  | { status: "paused"; remaining: number; limit: number }
  | { status: "unavailable" };

/** SHA-256 of the exact request body, hex. Same id + different hash is refused. */
export async function requestHash(raw: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function reserveBudget(
  env: BudgetEnv,
  a: { user: string; requestId: string; hash: string; model: string; priceVersion: string; maxCost: number },
): Promise<ReserveVerdict> {
  const v = (await rpc(env, "ai_budget_reserve", {
    p_user: a.user, p_request_id: a.requestId, p_hash: a.hash, p_model: a.model,
    p_price_version: a.priceVersion, p_max_cost: a.maxCost,
  })) as Json | null;
  if (!v || typeof v !== "object" || typeof v.status !== "string") return { status: "unavailable" };
  switch (v.status) {
    case "reserved": return { status: "reserved" };
    case "replay": return { status: "replay", state: String(v.state ?? "") };
    case "hash_mismatch": return { status: "hash_mismatch" };
    case "over_limit":
    case "paused": {
      // The verdict carries only what is left; the limit is one more read.
      const s = await budgetStatus(env, a.user);
      if (!s) return { status: "unavailable" };
      return { status: v.status, remaining: num(v.remaining, s.remainingMicrousd), limit: s.limitMicrousd };
    }
    default: return { status: "unavailable" };
  }
}

/** True only for the single caller that wins the one-way step. */
export async function markDispatched(env: BudgetEnv, user: string, requestId: string): Promise<boolean> {
  return (await rpc(env, "ai_budget_mark_dispatched", { p_user: user, p_request_id: requestId })) === true;
}

/** Records the actual cost. False means the ledger did not confirm it. */
export async function settleBudget(env: BudgetEnv, user: string, requestId: string, actual: number): Promise<boolean> {
  const v = (await rpc(env, "ai_budget_settle", { p_user: user, p_request_id: requestId, p_actual: actual })) as Json | null;
  return !!v && typeof v === "object" && (v.status === "settled" || v.status === "already_settled");
}

/**
 * Gives a hold back. zeroCharge is only true for a definitive provider
 * refusal that cannot have been billed. Anything else that dispatched must be
 * settled, so a "dispatched" answer here is expected and harmless: the hold
 * simply stays until reconciled.
 */
export async function releaseBudget(env: BudgetEnv, user: string, requestId: string, zeroCharge = false): Promise<boolean> {
  const v = (await rpc(env, "ai_budget_release", { p_user: user, p_request_id: requestId, p_zero_charge: zeroCharge })) as Json | null;
  return !!v && typeof v === "object" && (v.status === "released" || v.status === "already_released");
}

export async function budgetStatus(env: BudgetEnv, user: string): Promise<BudgetStatus | null> {
  const v = (await rpc(env, "ai_budget_status", { p_user: user })) as Json | null;
  if (!v || typeof v !== "object") return null;
  const limit = v.limit, spent = v.spent, held = v.held, remaining = v.remaining, version = v.version;
  if (![limit, spent, held, remaining, version].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return {
    limitMicrousd: limit as number,
    spentMicrousd: spent as number,
    heldMicrousd: held as number,
    remainingMicrousd: remaining as number,
    period: typeof v.period === "string" ? v.period : "since_activation",
    periodStart: typeof v.periodStart === "string" ? v.periodStart : "",
    version: version as number,
    paused: v.paused === true,
  };
}

export type SetLimitVerdict =
  | { status: "ok"; budget: BudgetStatus }
  | { status: "version_conflict"; budget: BudgetStatus | null }
  | { status: "invalid" }
  | { status: "unavailable" };

export async function setLimit(env: BudgetEnv, user: string, limit: number, expectedVersion: number): Promise<SetLimitVerdict> {
  const v = (await rpc(env, "ai_budget_set_limit", {
    p_user: user, p_limit: limit, p_expected_version: expectedVersion,
  })) as Json | null;
  if (!v || typeof v !== "object") return { status: "unavailable" };
  if (v.status === "invalid") return { status: "invalid" };
  const budget = await budgetStatus(env, user);
  if (v.status === "version_conflict") return { status: "version_conflict", budget };
  if (v.status === "ok" && budget) return { status: "ok", budget };
  return { status: "unavailable" };
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
