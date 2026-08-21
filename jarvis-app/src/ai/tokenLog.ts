// Token accounting (queue item 12). Shapes the row api/ai.ts writes to the
// ai_tokens table (migration 0026) after every completed upstream call. Pure,
// so the proxy's accounting can be tested where the proxy itself cannot be.
//
// ai_usage is the admission ledger (written BEFORE the call, drives the
// caps). ai_tokens is the cost ledger (written AFTER the reply, drives the
// cost model). This module only shapes the second.

export interface AnthropicUsage { input_tokens?: unknown; output_tokens?: unknown }

export interface TokenRow {
  user_id: string;
  kind: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
}

// Returns the row to insert, or null when the reply carried no usable counts
// (no row beats a row of zeros: absence is honest, zero is a claim).
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
  };
}

function toCount(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
}
