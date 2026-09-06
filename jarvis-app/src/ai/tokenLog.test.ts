import { describe, it, expect } from "vitest";
import { tokenRow, withoutCacheCounts, priceOf, estimateCost, totalsByModel, formatUSD, formatTokens, type TokenTotals } from "./tokenLog";

describe("tokenRow", () => {
  it("shapes a full row from a normal usage block", () => {
    expect(tokenRow("u1", "triage", "claude-sonnet-5", { input_tokens: 812, output_tokens: 203 })).toEqual({
      user_id: "u1", kind: "triage", model: "claude-sonnet-5", input_tokens: 812, output_tokens: 203,
      cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
    });
  });

  it("returns null when the reply carried no counts at all", () => {
    expect(tokenRow("u1", "triage", "m", undefined)).toBeNull();
    expect(tokenRow("u1", "triage", "m", {})).toBeNull();
    expect(tokenRow("u1", "triage", "m", { input_tokens: "812", output_tokens: null })).toBeNull();
  });

  it("keeps a partial count, zero-filling the missing side", () => {
    expect(tokenRow("u1", "", "m", { input_tokens: 40 })).toEqual({
      user_id: "u1", kind: "", model: "m", input_tokens: 40, output_tokens: 0,
      cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
    });
  });

  it("rejects negative and non-finite counts, floors fractions", () => {
    expect(tokenRow("u1", "k", "m", { input_tokens: -5, output_tokens: Infinity })).toBeNull();
    expect(tokenRow("u1", "k", "m", { input_tokens: 10.9 })!.input_tokens).toBe(10);
  });
});

// UP-PLAT-02 (2026-09-06): prompt caching is only worth anything if it can be
// measured, and input_tokens alone cannot tell a call that paid full price
// from one that read the whole context back for a tenth.
describe("cache accounting (UP-PLAT-02)", () => {
  it("carries Anthropic's two cache counters through, under their own names", () => {
    const row = tokenRow("u1", "chat", "claude-sonnet-4-6", {
      input_tokens: 40,
      output_tokens: 120,
      cache_read_input_tokens: 3200,
      cache_creation_input_tokens: 0,
    })!;
    expect(row.cache_read_input_tokens).toBe(3200);
    expect(row.cache_creation_input_tokens).toBe(0);
  });

  it("a cache write is recorded the same way", () => {
    const row = tokenRow("u1", "chat", "m", { input_tokens: 40, output_tokens: 5, cache_creation_input_tokens: 3200 })!;
    expect(row.cache_creation_input_tokens).toBe(3200);
    expect(row.cache_read_input_tokens).toBe(0);
  });

  it("a garbage cache count reads as zero rather than poisoning the row", () => {
    const row = tokenRow("u1", "chat", "m", { input_tokens: 40, cache_read_input_tokens: "lots" })!;
    expect(row).not.toBeNull();
    expect(row.cache_read_input_tokens).toBe(0);
  });

  // The retry shape: PostgREST rejects an insert naming a column the table
  // does not have, so the proxy falls back to the pre-0033 row rather than
  // losing the whole ledger between the deploy and the migration.
  it("the fallback row is the 0026 shape exactly", () => {
    const row = tokenRow("u1", "chat", "m", { input_tokens: 40, output_tokens: 2, cache_read_input_tokens: 900 })!;
    expect(Object.keys(withoutCacheCounts(row)).sort()).toEqual(
      ["input_tokens", "kind", "model", "output_tokens", "user_id"],
    );
  });
});

// UP-PLAT-04 (2026-09-06): ai_tokens had zero readers, so the one number that
// tracks Dave's bill was invisible to the person paying it. These pin the
// price table and the two rules that keep it honest: an unknown model prices
// at null, never zero, and a real spend under a cent says so.
describe("what it costs (UP-PLAT-04)", () => {
  const line = (over: Partial<TokenTotals> = {}): TokenTotals => ({
    model: "claude-sonnet-4-6", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, ...over,
  });

  it("prices by model family, so a version bump does not drop a model out of the table", () => {
    expect(priceOf("claude-sonnet-4-6")).toEqual({ input: 3, output: 15 });
    expect(priceOf("claude-opus-4-1-20250805")).toEqual({ input: 15, output: 75 });
    expect(priceOf("claude-haiku-4-5")).toEqual({ input: 1, output: 5 });
  });

  it("a model the table does not know has no price", () => {
    expect(priceOf("some-other-model")).toBeNull();
    expect(priceOf("")).toBeNull();
  });

  it("a million in and a million out is the list price, added up", () => {
    expect(estimateCost([line({ inputTokens: 1_000_000, outputTokens: 1_000_000 })])).toBeCloseTo(18, 6);
  });

  it("a cache read costs a tenth of the input price, a write costs 1.25x", () => {
    expect(estimateCost([line({ cacheReadTokens: 1_000_000 })])).toBeCloseTo(0.3, 6);
    expect(estimateCost([line({ cacheWriteTokens: 1_000_000 })])).toBeCloseTo(3.75, 6);
  });

  it("one unpriced model makes the whole total null: a partial sum is a wrong number", () => {
    expect(estimateCost([line({ inputTokens: 1000 }), line({ model: "mystery", inputTokens: 1000 })])).toBeNull();
    expect(estimateCost([])).toBeNull();
  });

  it("a real spend under a cent says so rather than rounding itself to free", () => {
    expect(formatUSD(0.004)).toBe("<$0.01");
    expect(formatUSD(0)).toBe("$0.00");
    expect(formatUSD(1.238)).toBe("$1.24");
  });

  it("sums an ai_tokens read into one line per model", () => {
    const totals = totalsByModel([
      { model: "m1", input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 100 },
      { model: "m1", input_tokens: 5, output_tokens: 1 },
      { model: "m2", input_tokens: 7, output_tokens: 3, cache_creation_input_tokens: 40 },
    ]);
    expect(totals).toEqual([
      { model: "m1", inputTokens: 15, outputTokens: 3, cacheReadTokens: 100, cacheWriteTokens: 0 },
      { model: "m2", inputTokens: 7, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 40 },
    ]);
  });

  it("garbage in a row counts as nothing rather than poisoning the sum", () => {
    expect(totalsByModel([{ input_tokens: -4 as number, output_tokens: undefined }])).toEqual([
      { model: "", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    ]);
  });

  it("formats token counts short enough for a settings row", () => {
    expect(formatTokens(940)).toBe("940");
    expect(formatTokens(3200)).toBe("3.2k");
    expect(formatTokens(2_000_000)).toBe("2M");
  });
});
