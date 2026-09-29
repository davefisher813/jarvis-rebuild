import { describe, it, expect } from "vitest";
import {
  AIBudgetError, DEFAULT_LIMIT_MICROUSD, MAX_IMAGE_TOKENS, TOOL_OVERHEAD_TOKENS, actualCostMicrousd,
  budgetMessage, formatLimit, formatMicro, maxCostMicrousd, multiplierPermille, nanoPriceOf,
} from "./aiBudget";
import { parseDollarsToMicro } from "./limitInput";

describe("money is integer micro-USD", () => {
  it("$5 is 5,000,000", () => expect(DEFAULT_LIMIT_MICROUSD).toBe(5_000_000));
  it("formats a balance down and a cost up, never promising a cent it lacks", () => {
    expect(formatMicro(4_209_999)).toBe("$4.20");
    expect(formatMicro(4_200_001, "up")).toBe("$4.21");
    expect(formatMicro(0)).toBe("$0.00");
    expect(formatLimit(5_000_000)).toBe("$5");
    expect(formatLimit(4_500_000)).toBe("$4.50");
  });
});

describe("the price table is exact-id, and unknown means no call", () => {
  it("prices the configured models per the published table", () => {
    expect(nanoPriceOf("claude-sonnet-5-5")).toEqual({ input: 2000, cacheWrite5m: 2500, cacheWrite1h: 4000, cacheRead: 200, output: 10000 });
    expect(nanoPriceOf("claude-opus-5-5")?.cacheRead).toBe(200); // 0.05x, not 0.1x
    expect(nanoPriceOf("claude-fable-5-1")?.cacheRead).toBe(250); // 0.025x
  });
  it("does not price by family: a model that is not listed is not admitted", () => {
    expect(nanoPriceOf("claude-sonnet-9-9")).toBeNull();
    expect(nanoPriceOf("sonnet")).toBeNull();
    expect(nanoPriceOf("")).toBeNull();
    expect(nanoPriceOf("__proto__")).toBeNull();
    expect(nanoPriceOf("constructor")).toBeNull();
  });
});

describe("maxCostMicrousd: a bound, not an estimate", () => {
  const base = { model: "claude-sonnet-5-5", textBytes: 1000, imageCount: 0, usesCache: false, usesTools: false, maxTokens: 1024 };
  it("bounds input tokens by input bytes and output by max_tokens, rounded up", () => {
    // 1000 * 2000 nano + 1024 * 10000 nano = 12,240,000 nano = 12,240 micro
    expect(maxCostMicrousd(base)).toBe(12_240);
    // never rounds down: one byte of input on a 2000-nano price is 2 micro-USD-thousandths
    expect(maxCostMicrousd({ ...base, textBytes: 1, maxTokens: 0 })).toBe(2);
  });
  it("prices input at the dearest way it could bill when the cache is in play", () => {
    const withCache = maxCostMicrousd({ ...base, usesCache: true, maxTokens: 0 })!;
    expect(withCache).toBe(Math.ceil((1000 * 4000) / 1000)); // 1h write rate
    expect(withCache).toBeGreaterThan(maxCostMicrousd({ ...base, maxTokens: 0 })!);
  });
  it("adds the tool-use prompt and a fixed ceiling per image, never counting base64 as text", () => {
    const t = maxCostMicrousd({ ...base, textBytes: 0, maxTokens: 0, usesTools: true })!;
    expect(t).toBe(Math.ceil((TOOL_OVERHEAD_TOKENS * 2000) / 1000));
    const img = maxCostMicrousd({ ...base, textBytes: 0, maxTokens: 0, imageCount: 1 })!;
    expect(img).toBe(Math.ceil((MAX_IMAGE_TOKENS * 2000) / 1000));
  });
  it("applies a price multiplier when one is configured", () => {
    // 12,240,000 nano x 1.1 = 13,464,000 nano = 13,464 micro, exactly
    expect(maxCostMicrousd({ ...base, permille: 1100 })).toBe(13_464);
  });
  it("returns null, meaning do not call, for an unpriced model or nonsense sizes", () => {
    expect(maxCostMicrousd({ ...base, model: "claude-unknown-1" })).toBeNull();
    expect(maxCostMicrousd({ ...base, textBytes: -1 })).toBeNull();
    expect(maxCostMicrousd({ ...base, maxTokens: 1.5 })).toBeNull();
    expect(maxCostMicrousd({ ...base, textBytes: NaN })).toBeNull();
  });
  it("a worst-case admitted request fits in the default cap many times over", () => {
    // 32 KiB of text (the proxy's cap) on the default model, with the cache.
    const c = maxCostMicrousd({ ...base, textBytes: 32768, usesCache: true, usesTools: true })!;
    expect(c).toBeLessThan(200_000);
  });
});

describe("actualCostMicrousd", () => {
  const model = "claude-sonnet-5-5";
  it("prices uncached input, cache reads, cache writes and output separately", () => {
    const usage = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000, cache_creation_input_tokens: 400 };
    // 1000*2000 + 2000*200 + 400*4000 (no breakdown: dearer 1h rate) + 500*10000 = 2,000,000+400,000+1,600,000+5,000,000
    expect(actualCostMicrousd(model, usage)).toBe(9_000);
  });
  it("uses the 5 minute rate only when the breakdown accounts for every written token", () => {
    const usage = {
      input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1000,
      cache_creation: { ephemeral_5m_input_tokens: 600, ephemeral_1h_input_tokens: 400 },
    };
    expect(actualCostMicrousd(model, usage)).toBe(Math.ceil((600 * 2500 + 400 * 4000) / 1000));
    const partial = { ...usage, cache_creation: { ephemeral_5m_input_tokens: 600, ephemeral_1h_input_tokens: 100 } };
    expect(actualCostMicrousd(model, partial)).toBe(Math.ceil((1000 * 4000) / 1000));
  });
  it("is null for missing or malformed usage, so the caller settles at the reserved maximum", () => {
    expect(actualCostMicrousd(model, undefined)).toBeNull();
    expect(actualCostMicrousd(model, {})).toBeNull();
    expect(actualCostMicrousd(model, { input_tokens: "10", output_tokens: 5 })).toBeNull();
    expect(actualCostMicrousd(model, { input_tokens: -1, output_tokens: 5 })).toBeNull();
    expect(actualCostMicrousd(model, { input_tokens: 1.5, output_tokens: 5 })).toBeNull();
    expect(actualCostMicrousd("claude-unknown-1", { input_tokens: 1, output_tokens: 1 })).toBeNull();
  });
  it("never rounds a real cost down to zero", () => {
    // one cache-read token is 200 nano-USD, a fifth of a micro-USD: it counts as 1
    expect(actualCostMicrousd(model, { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1 })).toBe(1);
    expect(actualCostMicrousd(model, { input_tokens: 0, output_tokens: 0 })).toBe(0);
  });
});

describe("multiplierPermille", () => {
  it("defaults to 1.0x and only accepts a sane integer at or above it", () => {
    expect(multiplierPermille(undefined)).toBe(1000);
    expect(multiplierPermille("")).toBe(1000);
    expect(multiplierPermille("1100")).toBe(1100);
    expect(multiplierPermille("900")).toBe(1000);
    expect(multiplierPermille("1.1")).toBe(1000);
    expect(multiplierPermille("abc")).toBe(1000);
    expect(multiplierPermille("999999")).toBe(1000);
  });
});

describe("refusal wording (Dave, 2026-09-28)", () => {
  it("at the cap: AI paused. You reached your $5 limit.", () => {
    expect(budgetMessage({ code: "AI_BUDGET_REACHED", limitMicrousd: 5_000_000 })).toBe("AI paused. You reached your $5 limit.");
  });
  it("when only this request is too big, says so and names what is left", () => {
    expect(budgetMessage({ code: "AI_BUDGET_REQUEST_TOO_LARGE", limitMicrousd: 5_000_000, remainingMicrousd: 40_000 }))
      .toBe("This could cost more than the $0.04 left of your $5 limit.");
  });
  it("a zero limit reads as off, and no message is raw JSON", () => {
    expect(budgetMessage({ code: "AI_BUDGET_OFF" })).toBe("AI is off. Your spending limit is $0.");
    for (const code of ["AI_BUDGET_REACHED", "AI_BUDGET_REQUEST_TOO_LARGE", "AI_BUDGET_PAUSED", "AI_BUDGET_OFF", "AI_BUDGET_UNAVAILABLE", "AI_BUDGET_REPLAY"] as const) {
      const m = budgetMessage({ code });
      expect(m).not.toMatch(/[{}"]/);
      expect(m).not.toMatch(/—/);
    }
  });
  it("AIBudgetError carries the code and the words", () => {
    const e = new AIBudgetError({ code: "AI_BUDGET_REACHED", limitMicrousd: 5_000_000 });
    expect(e.code).toBe("AI_BUDGET_REACHED");
    expect(e.message).toBe("AI paused. You reached your $5 limit.");
  });
});

describe("the limit field", () => {
  it("parses dollars to exact integer micro-USD", () => {
    expect(parseDollarsToMicro("5")).toBe(5_000_000);
    expect(parseDollarsToMicro("$5")).toBe(5_000_000);
    expect(parseDollarsToMicro("4.10")).toBe(4_100_000);
    expect(parseDollarsToMicro("4.1")).toBe(4_100_000);
    expect(parseDollarsToMicro("0")).toBe(0);
    expect(parseDollarsToMicro(" 12.34 ")).toBe(12_340_000);
    expect(parseDollarsToMicro("1000")).toBe(1_000_000_000);
  });
  it("refuses what it will not save", () => {
    for (const bad of ["", "-1", "abc", "1.234", "1,000", "1000.01", "10000", "5.", ".5", "1e3", "5 dollars"]) {
      expect(parseDollarsToMicro(bad)).toBeNull();
    }
  });
});
