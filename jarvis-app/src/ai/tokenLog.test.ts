import { describe, it, expect } from "vitest";
import { tokenRow, withoutCacheCounts } from "./tokenLog";

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
