// The AI spending limit: the pure half, shared by the server (api/ai.ts, which
// enforces it) and the app (which shows it and explains a refusal).
//
// Money is INTEGER micro-USD everywhere: $1 = 1,000,000. The $5 default is
// 5,000,000. Nothing here uses floating point for money that is compared to a
// cap; the only float is the display string.
//
// Dave, 2026-09-28: a $5 default. He has not said whether that is daily,
// monthly or lifetime, so the balance is a non-resetting "Since [date]" one
// and nothing resets on its own until he picks a period. It also does not
// reconstruct the $5 already spent before this shipped.

export const DEFAULT_LIMIT_MICROUSD = 5_000_000;

/**
 * Bump when PRICES changes. It is stored on every reservation so a later
 * reader can tell which table priced a call.
 */
export const PRICE_VERSION = "2026-09-29";

/** Stable machine codes. The server sends them, the client maps them to words. */
export type BudgetErrorCode =
  | "AI_BUDGET_REACHED"          // nothing left
  | "AI_BUDGET_REQUEST_TOO_LARGE" // some left, but this request could cost more
  | "AI_BUDGET_PAUSED"           // an overrun was recorded; re-save the limit
  | "AI_BUDGET_OFF"              // the limit is zero
  | "AI_BUDGET_UNAVAILABLE"      // cannot count, so cannot spend
  | "AI_BUDGET_REPLAY";          // this request id was already handled

export interface BudgetRefusal {
  code: BudgetErrorCode;
  limitMicrousd?: number;
  remainingMicrousd?: number;
}

/** What the client throws when the server refuses on budget grounds. */
export class AIBudgetError extends Error {
  readonly code: BudgetErrorCode;
  readonly limitMicrousd?: number;
  readonly remainingMicrousd?: number;
  constructor(r: BudgetRefusal) {
    super(budgetMessage(r));
    this.name = "AIBudgetError";
    this.code = r.code;
    this.limitMicrousd = r.limitMicrousd;
    this.remainingMicrousd = r.remainingMicrousd;
  }
}

export function isBudgetError(e: unknown): e is AIBudgetError {
  return e instanceof AIBudgetError;
}

/** The status the settings screen renders. Mirrors ai_budget_status(). */
export interface BudgetStatus {
  limitMicrousd: number;
  spentMicrousd: number;
  heldMicrousd: number;
  remainingMicrousd: number;
  period: string;
  /** ISO timestamp the balance counts from. */
  periodStart: string;
  version: number;
  paused: boolean;
}

/**
 * Dollars for a display string. Remaining is floored and spent is ceiled by
 * the callers' choice of rounding, so the screen never promises a cent it
 * does not have: pass "down" for a balance and "up" for a cost.
 */
export function formatMicro(micro: number, round: "down" | "up" = "down"): string {
  const cents = round === "down" ? Math.floor(micro / 10_000) : Math.ceil(micro / 10_000);
  const dollars = Math.trunc(cents / 100);
  const rest = String(cents % 100).padStart(2, "0");
  return `$${dollars}.${rest}`;
}

/** Whole dollars read as "$5", otherwise "$4.50". For a limit. */
export function formatLimit(micro: number): string {
  return micro % 1_000_000 === 0 ? `$${micro / 1_000_000}` : formatMicro(micro, "up");
}

/**
 * Plain words for a refusal. Dave, 2026-09-28: "AI paused. You reached your
 * $5 limit." at the cap, and a different sentence when only this request is
 * the problem. Never raw server JSON.
 */
export function budgetMessage(r: BudgetRefusal): string {
  const limit = r.limitMicrousd !== undefined ? formatLimit(r.limitMicrousd) : "AI";
  switch (r.code) {
    case "AI_BUDGET_REACHED":
      return r.limitMicrousd !== undefined
        ? `AI paused. You reached your ${limit} limit.`
        : "AI paused. You reached your spending limit.";
    case "AI_BUDGET_REQUEST_TOO_LARGE":
      return r.remainingMicrousd !== undefined && r.limitMicrousd !== undefined
        ? `This could cost more than the ${formatMicro(r.remainingMicrousd)} left of your ${limit} limit.`
        : "This could cost more than what is left of your spending limit.";
    case "AI_BUDGET_PAUSED":
      return "AI paused. A call cost more than expected. Save your limit again in AI Control to resume.";
    case "AI_BUDGET_OFF":
      return "AI is off. Your spending limit is $0.";
    case "AI_BUDGET_UNAVAILABLE":
      return "AI paused. The spending limit could not be checked.";
    case "AI_BUDGET_REPLAY":
      return "That request was already handled.";
  }
}

export function isBudgetCode(v: unknown): v is BudgetErrorCode {
  return v === "AI_BUDGET_REACHED" || v === "AI_BUDGET_REQUEST_TOO_LARGE" || v === "AI_BUDGET_PAUSED"
    || v === "AI_BUDGET_OFF" || v === "AI_BUDGET_UNAVAILABLE" || v === "AI_BUDGET_REPLAY";
}

// ---- PRICES ----
//
// nano-USD per token, i.e. USD per million tokens times 1000. Integers, so no
// rounding happens until the final upward conversion to micro-USD. Source:
// platform.claude.com/docs/en/about-claude/pricing, read 2026-09-29.
//
// EXACT model ids only. The old table matched a model FAMILY by substring so a
// version bump would not drop a model out; that is right for a display
// estimate and wrong for admission, where a guessed price is a guessed cap. A
// model not listed here is not admitted (fail closed).
export interface NanoPrice {
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
}

const M = 1000; // $1/MTok = 1000 nano-USD per token

function price(input: number, w5: number, w1: number, read: number, output: number): NanoPrice {
  return {
    input: Math.round(input * M), cacheWrite5m: Math.round(w5 * M), cacheWrite1h: Math.round(w1 * M),
    cacheRead: Math.round(read * M), output: Math.round(output * M),
  };
}

const PRICES: Readonly<Record<string, NanoPrice>> = {
  "claude-fable-5-1": price(10, 12.5, 20, 0.25, 50),
  "claude-fable-5": price(10, 12.5, 20, 1, 50),
  "claude-opus-5-5": price(4, 5, 8, 0.2, 20),
  "claude-opus-5": price(5, 6.25, 10, 0.5, 25),
  "claude-opus-4-8": price(5, 6.25, 10, 0.5, 25),
  "claude-opus-4-7": price(5, 6.25, 10, 0.5, 25),
  "claude-opus-4-6": price(5, 6.25, 10, 0.5, 25),
  "claude-opus-4-5": price(5, 6.25, 10, 0.5, 25),
  "claude-sonnet-5-5": price(2, 2.5, 4, 0.2, 10),
  "claude-sonnet-5": price(2, 2.5, 4, 0.2, 10),
  "claude-sonnet-4-6": price(3, 3.75, 6, 0.3, 15),
  "claude-sonnet-4-5": price(3, 3.75, 6, 0.3, 15),
  "claude-haiku-4-5": price(1, 1.25, 2, 0.1, 5),
  "claude-haiku-4-5-20251001": price(1, 1.25, 2, 0.1, 5),
};

export function nanoPriceOf(model: string): NanoPrice | null {
  return Object.prototype.hasOwnProperty.call(PRICES, model) ? PRICES[model]! : null;
}

/**
 * Multiplier on every price, in permille (1000 = 1.0x). The Messages API has
 * exactly two modifiers that touch a plain call: fast mode and
 * inference_geo "us" (1.1x). api/ai.ts builds the upstream body itself and
 * sends neither, so 1000 is right for what it sends. AI_PRICE_MULTIPLIER_PERMILLE
 * exists so a workspace-level data-residency default, which was not inspected,
 * can be priced in without a code change.
 */
export function multiplierPermille(env: string | undefined): number {
  const n = env === undefined || env === "" ? 1000 : Number(env);
  return Number.isInteger(n) && n >= 1000 && n <= 10_000 ? n : 1000;
}

// One token is at least one byte of input text, so the token count of text can
// never exceed its UTF-8 byte length. That is a bound, not an estimate: it is
// loose (real text is several bytes per token) and it holds for every
// tokenizer. It is what "defensible maximum" means here.
//
// Two things ride on top of the text: the tool-use system prompt (the largest
// figure on the pricing page is 804 tokens; 1024 covers it), and an image,
// which the vision docs cap at 4784 visual tokens on the high-resolution tier.
export const TOOL_OVERHEAD_TOKENS = 1024;
export const MAX_IMAGE_TOKENS = 4784;

export interface CostBoundInput {
  model: string;
  /** UTF-8 bytes of the whole request EXCLUDING base64 image data. */
  textBytes: number;
  imageCount: number;
  /** cache_control anywhere in the request: input may bill as a cache write. */
  usesCache: boolean;
  usesTools: boolean;
  maxTokens: number;
  permille?: number;
}

/**
 * A maximum cost in micro-USD, rounded UP, or null when none can be
 * established (unknown model, nonsense sizes). null means: do not call.
 */
export function maxCostMicrousd(i: CostBoundInput): number | null {
  const p = nanoPriceOf(i.model);
  if (!p) return null;
  if (![i.textBytes, i.imageCount, i.maxTokens].every((n) => Number.isInteger(n) && n >= 0)) return null;
  const inputTokens = i.textBytes + i.imageCount * MAX_IMAGE_TOKENS + (i.usesTools ? TOOL_OVERHEAD_TOKENS : 0);
  // Every input token is priced at the DEAREST way it could bill.
  const inRate = Math.max(p.input, i.usesCache ? Math.max(p.cacheWrite5m, p.cacheWrite1h) : 0);
  const nano = inputTokens * inRate + i.maxTokens * p.output;
  return ceilMicro(nano, i.permille ?? 1000);
}

export interface UsageCounts {
  input_tokens?: unknown;
  output_tokens?: unknown;
  cache_read_input_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
  cache_creation?: { ephemeral_5m_input_tokens?: unknown; ephemeral_1h_input_tokens?: unknown } | null;
}

/**
 * What a completed call actually cost, in micro-USD rounded UP, from the
 * usage the provider returned. null when the usage is missing or malformed,
 * in which case the caller settles at the reserved maximum instead: an
 * unknown cost is assumed to be the worst one, never zero.
 */
export function actualCostMicrousd(model: string, usage: UsageCounts | undefined | null, permille = 1000): number | null {
  const p = nanoPriceOf(model);
  if (!p || !usage) return null;
  const inTok = count(usage.input_tokens);
  const outTok = count(usage.output_tokens);
  if (inTok === null || outTok === null) return null;
  const read = count(usage.cache_read_input_tokens) ?? 0;
  const created = count(usage.cache_creation_input_tokens) ?? 0;
  const c5 = count(usage.cache_creation?.ephemeral_5m_input_tokens);
  const c1 = count(usage.cache_creation?.ephemeral_1h_input_tokens);
  // With a breakdown that accounts for every created token, price each part;
  // otherwise price all of them at the dearer (1 hour) rate.
  const split = c5 !== null && c1 !== null && c5 + c1 === created;
  const writeNano = split ? c5! * p.cacheWrite5m + c1! * p.cacheWrite1h : created * p.cacheWrite1h;
  const nano = inTok * p.input + read * p.cacheRead + writeNano + outTok * p.output;
  return ceilMicro(nano, permille);
}

function count(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && Number.isInteger(v) ? v : null;
}

/** nano-USD to micro-USD, times a permille multiplier, rounded up. Integer only. */
function ceilMicro(nano: number, permille: number): number {
  const scaled = nano * permille; // nano-permille; safe: nano <= ~1e12
  return Math.ceil(scaled / (1000 * 1000));
}
