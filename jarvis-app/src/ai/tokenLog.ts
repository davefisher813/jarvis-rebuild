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

// ---- WHAT IT COSTS (UP-PLAT-04, 2026-09-06) ----
//
// ai_tokens has been written on every completed call since migration 0026 and
// had exactly zero readers: the numbers existed, and nobody, not even Dave who
// pays the bill, could see them. A price table is the missing half, and it
// belongs beside the row it prices.
//
// USD per MILLION tokens, Anthropic's published list prices, read 2026-09-06.
// This is the ONE place in the app that hard-codes a price. Matched on the
// model family in the id ("claude-sonnet-4-6" is a sonnet) so a version bump
// does not silently drop a model out of the table.
//
// A model this table does not know prices at NULL, not zero. An estimate
// nobody can trace is worse than no estimate, and a fake zero next to a real
// bill is the exact shape of lie this codebase does not tell.
export interface ModelPrice { input: number; output: number }

const PRICES: readonly { family: string; price: ModelPrice }[] = [
  { family: "opus", price: { input: 15, output: 75 } },
  { family: "sonnet", price: { input: 3, output: 15 } },
  { family: "haiku", price: { input: 1, output: 5 } },
];

export function priceOf(model: string): ModelPrice | null {
  const m = (model || "").toLowerCase();
  return PRICES.find((p) => m.includes(p.family))?.price ?? null;
}

// UP-PLAT-02's arithmetic: a cache read bills at a tenth of the input price,
// a cache write at 1.25x, once.
export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_MULTIPLIER = 1.25;

// One model's totals over a window. The two cache fields are named for what
// they mean here rather than for Anthropic's wire format, because this shape
// is what the app's own screens read.
export interface TokenTotals {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Sums the rows of an ai_tokens read into one line per model. */
export function totalsByModel(rows: Partial<TokenRow>[]): TokenTotals[] {
  const by = new Map<string, TokenTotals>();
  for (const r of rows) {
    const model = typeof r.model === "string" ? r.model : "";
    const t = by.get(model) ?? { model, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    t.inputTokens += num(r.input_tokens);
    t.outputTokens += num(r.output_tokens);
    t.cacheReadTokens += num(r.cache_read_input_tokens);
    t.cacheWriteTokens += num(r.cache_creation_input_tokens);
    by.set(model, t);
  }
  return [...by.values()];
}

/**
 * Dollars for these totals, or null when any line names a model this table
 * cannot price. All or nothing on purpose: a total that quietly omits one
 * model is a wrong number wearing a right one's clothes.
 */
export function estimateCost(totals: TokenTotals[]): number | null {
  if (totals.length === 0) return null;
  let usd = 0;
  for (const t of totals) {
    const p = priceOf(t.model);
    if (!p) return null;
    usd += (t.inputTokens * p.input) / 1e6;
    usd += (t.outputTokens * p.output) / 1e6;
    usd += (t.cacheReadTokens * p.input * CACHE_READ_MULTIPLIER) / 1e6;
    usd += (t.cacheWriteTokens * p.input * CACHE_WRITE_MULTIPLIER) / 1e6;
  }
  return usd;
}

/**
 * The one renderer, so a cost never appears in two shapes. A real spend under
 * a cent says so rather than rounding itself away to "$0.00", which reads as
 * free.
 */
export function formatUSD(usd: number): string {
  if (usd > 0 && usd < 0.01) return "<$0.01";
  return "$" + usd.toFixed(2);
}

/** "3.2k" for a token count, so a row of digits does not swamp a settings row. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}
