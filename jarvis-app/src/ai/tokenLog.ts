// Token accounting (queue item 12). Shapes the row api/ai.ts writes to the
// ai_tokens table (migration 0026) after every completed upstream call. Pure,
// so the proxy's accounting can be tested where the proxy itself cannot be.
//
// ai_usage is the admission ledger (written BEFORE the call, drives the
// caps). ai_tokens is the cost ledger (written AFTER the reply, drives the
// cost model). This module only shapes the second.

// UP-PLAT-02 (2026-09-06): Anthropic reports cache hits and cache writes as
// two more counters on the same usage object. They are the only way to know
// whether prompt caching is actually paying for itself, so they ride into the
// same ledger under Anthropic's own names.
export interface AnthropicUsage {
  input_tokens?: unknown;
  output_tokens?: unknown;
  cache_read_input_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
}

export interface TokenRow {
  user_id: string;
  kind: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  // Billed at 0.1x the input price. High is good: the context was already
  // paid for.
  cache_read_input_tokens: number;
  // Billed at 1.25x the input price, once, to put the block in the cache.
  cache_creation_input_tokens: number;
}

// Returns the row to insert, or null when the reply carried no usable counts
// (no row beats a row of zeros: absence is honest, zero is a claim). The two
// cache counters do not decide that: a call that read nothing from the cache
// and wrote nothing to it really did use zero of each.
export function tokenRow(userId: string, kind: string, model: string, usage: AnthropicUsage | undefined): TokenRow | null {
  const inTok = toCount(usage?.input_tokens);
  const outTok = toCount(usage?.output_tokens);
  if (inTok === null && outTok === null) return null;
  return {
    user_id: userId,
    kind: kind || "",
    model: model || "",
    input_tokens: inTok ?? 0,
    output_tokens: outTok ?? 0,
    cache_read_input_tokens: toCount(usage?.cache_read_input_tokens) ?? 0,
    cache_creation_input_tokens: toCount(usage?.cache_creation_input_tokens) ?? 0,
  };
}

// The pre-0033 row. Migration 0033 adds the two cache columns, and until Dave
// runs it PostgREST rejects the whole insert for naming columns that do not
// exist -- which would lose ALL token accounting, not just the new half. The
// proxy retries with this shape once, so the ledger keeps working either side
// of the migration, the same posture 0026 itself shipped with.
export function withoutCacheCounts(row: TokenRow): Omit<TokenRow, "cache_read_input_tokens" | "cache_creation_input_tokens"> {
  const { cache_read_input_tokens: _r, cache_creation_input_tokens: _w, ...rest } = row;
  return rest;
}

function toCount(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
}
