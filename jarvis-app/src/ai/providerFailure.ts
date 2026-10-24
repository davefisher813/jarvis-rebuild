// WHAT THE PROVIDER SAID, READ FROM ITS BODY AND NOT ITS STATUS (Dave 2026-10-24, the chat box order: "when something is broken the
// thread says what is actually wrong").
//
// Every AI-lane failure used to collapse to one line, "Couldn't reach the AI · Try again": a provider account out of credit, a
// spending limit reached and a blip on the network read identically, and only one of the three is fixed by trying again. The proxy
// was part of it. Anthropic does not send an exhausted account as a 402; it sends a 400 invalid_request_error whose MESSAGE says the
// credit balance is too low, and a proxy that reads "400" as "the request was bad" files it with client bugs. So this reads the body
// first (its type, then its words) and falls back to the status only for a body that said nothing usable.
//
// Pure and dependency-free, like aiGate and aiBudget, because both ends import it: the proxy classifies and answers with a stable
// code, and the app maps the code to the same words wherever it is shown.
//
// WHAT RETRYING DOES, which is the point of the split:
//   busy, rate   a second try can work once the provider has caught its breath
//   all others   the same request fails the same way until someone changes something (add credit, fix the key, shorten the text),
//                so none of them offers "Try again" as if it were the fix.

export const PROVIDER_CODES = [
  "AI_PROVIDER_CREDIT",    // the provider account is out of credit
  "AI_PROVIDER_LIMIT",     // the provider account's own usage limit is reached
  "AI_PROVIDER_AUTH",      // the server's key was refused
  "AI_PROVIDER_ACCESS",    // the key may not use this model (permission, or the model is gone)
  "AI_PROVIDER_RATE",      // the provider is limiting requests
  "AI_PROVIDER_BUSY",      // overloaded, erroring, or not answering: nothing came back
  "AI_PROVIDER_TOO_LARGE", // this request is more than the model can read at once
  "AI_PROVIDER_REJECTED",  // any other refusal of the request itself
] as const;

export type ProviderErrorCode = (typeof PROVIDER_CODES)[number];

export function isProviderCode(v: unknown): v is ProviderErrorCode {
  return PROVIDER_CODES.includes(v as ProviderErrorCode);
}

export interface ProviderFailure {
  code: ProviderErrorCode;
  /** Would asking again, unchanged and a little later, plausibly work? */
  retryable: boolean;
  /** The status the proxy answers under. */
  status: number;
  /** The provider's own sentence, when its body had one. Diagnostics, never the headline. */
  said: string | null;
}

// 502 is what every upstream failure travelled under before this existed, so a build that has never heard of the codes reads them
// exactly as it did. The two that already have a status of their own keep it: 429 means "later", 413 means "smaller".
const STATUS: Record<ProviderErrorCode, number> = {
  AI_PROVIDER_CREDIT: 502,
  AI_PROVIDER_LIMIT: 502,
  AI_PROVIDER_AUTH: 502,
  AI_PROVIDER_ACCESS: 502,
  AI_PROVIDER_RATE: 429,
  AI_PROVIDER_BUSY: 502,
  AI_PROVIDER_TOO_LARGE: 413,
  AI_PROVIDER_REJECTED: 502,
};

export function retryableCode(code: ProviderErrorCode): boolean {
  return code === "AI_PROVIDER_BUSY" || code === "AI_PROVIDER_RATE";
}

// An account that cannot pay stays that way until a person fixes it, so the app stops sending work nobody asked for (providerBlock).
export function outageCode(code: ProviderErrorCode): boolean {
  return code === "AI_PROVIDER_CREDIT" || code === "AI_PROVIDER_LIMIT" || code === "AI_PROVIDER_AUTH" || code === "AI_PROVIDER_ACCESS";
}

const CREDIT = /credit balance|purchase credits|plans\s*(?:&|and)\s*billing/i;
const LIMIT = /usage limits?|regain access|spend(?:ing)? limit/i;
const TOO_LARGE = /prompt is too long|too many (?:total )?tokens|maximum context|context (?:length|window)/i;

interface Said { type: string; message: string }

// The provider's body is { type: "error", error: { type, message } }; the proxy's own envelope is { error: "..." }. Anything that
// is not JSON is taken as its own words.
function readBody(text: string): Said {
  const plain = text.replace(/\s+/g, " ").trim().slice(0, 300);
  try {
    const j = JSON.parse(text) as unknown;
    if (!j || typeof j !== "object") return { type: "", message: plain };
    const o = j as { error?: unknown; type?: unknown; message?: unknown };
    const inner = o.error && typeof o.error === "object" ? (o.error as { type?: unknown; message?: unknown }) : o;
    const type = typeof inner.type === "string" && inner.type !== "error" ? inner.type : "";
    const message = typeof inner.message === "string" ? inner.message : typeof o.error === "string" ? o.error : "";
    return { type, message };
  } catch {
    return { type: "", message: plain };
  }
}

/** The one place an upstream refusal gets a meaning. Body first (its words, then its type), status only for a body with nothing in it. */
export function classifyUpstream(status: number, body: string): ProviderFailure {
  const { type, message } = readBody(body);
  const done = (code: ProviderErrorCode): ProviderFailure => ({ code, retryable: retryableCode(code), status: STATUS[code], said: message || null });

  // 1. The words. This is the line that matters: a credit outage arrives as an invalid_request_error.
  if (type === "billing_error" || CREDIT.test(message)) return done("AI_PROVIDER_CREDIT");
  if (LIMIT.test(message)) return done("AI_PROVIDER_LIMIT");

  // 2. The provider's own name for what went wrong.
  switch (type) {
    case "authentication_error": return done("AI_PROVIDER_AUTH");
    case "permission_error":
    case "not_found_error": return done("AI_PROVIDER_ACCESS");
    case "rate_limit_error": return done("AI_PROVIDER_RATE");
    case "overloaded_error":
    case "api_error":
    case "timeout_error": return done("AI_PROVIDER_BUSY");
    case "request_too_large": return done("AI_PROVIDER_TOO_LARGE");
  }
  if (TOO_LARGE.test(message)) return done("AI_PROVIDER_TOO_LARGE");

  // 3. The status, for a body that said nothing usable (an HTML error page, an empty reply).
  if (status === 401) return done("AI_PROVIDER_AUTH");
  if (status === 402) return done("AI_PROVIDER_CREDIT");
  if (status === 403 || status === 404) return done("AI_PROVIDER_ACCESS");
  if (status === 413) return done("AI_PROVIDER_TOO_LARGE");
  if (status === 429) return done("AI_PROVIDER_RATE");
  if (status === 408 || status >= 500) return done("AI_PROVIDER_BUSY");
  return done("AI_PROVIDER_REJECTED");
}

/**
 * The words for each, in the app's own voice: what is wrong, then what fixes it, two fragments joined by a middle dot. That is the
 * grammar the chat already speaks ("Nothing matching it · Nothing changed") and the shape the short-copy law (Dave 2026-08-15, "the
 * app never talks in long sentences") allows; the spending limit's two sentences are the one exemption, and they are his words, not
 * a precedent. A usage limit that names the day access comes back keeps the provider's own clause, because it is the one thing the
 * provider knew that the app does not.
 */
export function providerWords(code: ProviderErrorCode, said: string | null = null): string {
  switch (code) {
    case "AI_PROVIDER_CREDIT":
      return "The AI provider account is out of credit · Add credit, then ask again";
    case "AI_PROVIDER_LIMIT": {
      const when = /you will regain access[^.]*/i.exec(said ?? "")?.[0];
      return "The AI provider account reached its usage limit" + (when ? " · " + when : "");
    }
    case "AI_PROVIDER_AUTH":
      return "The AI provider refused JARVIS's key · That needs the admin, asking again won't help";
    case "AI_PROVIDER_ACCESS":
      return "The AI provider says JARVIS's key can't use that model · That needs the admin";
    case "AI_PROVIDER_RATE":
      return "The AI provider is limiting requests right now · Try again in a minute";
    case "AI_PROVIDER_BUSY":
      return "The AI provider isn't answering right now · Try again in a moment";
    case "AI_PROVIDER_TOO_LARGE":
      return "That was too much for the AI to read at once · Try a shorter message";
    case "AI_PROVIDER_REJECTED":
      return "The AI provider turned that request down · Nothing ran, and asking again won't change that";
  }
}

/** What the client throws when the proxy reports a provider failure. */
export class AIProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly said: string | null;
  constructor(code: ProviderErrorCode, opts: { retryable?: boolean; message?: string; said?: string | null } = {}) {
    super(opts.message || providerWords(code, opts.said ?? null));
    this.name = "AIProviderError";
    this.code = code;
    this.retryable = opts.retryable ?? retryableCode(code);
    this.said = opts.said ?? null;
  }
}

export function isProviderError(e: unknown): e is AIProviderError {
  return e instanceof AIProviderError;
}

/**
 * The proxy answers a provider failure as { error, code, retryable, detail }. Only a KNOWN code counts, so an unrelated body is never
 * mistaken for one (same rule as the budget refusal). The words are rebuilt from the code when the body carried none.
 */
export function parseProviderRefusal(detail: string): AIProviderError | null {
  try {
    const j = JSON.parse(detail) as { code?: unknown; retryable?: unknown; error?: unknown; detail?: unknown };
    if (!isProviderCode(j.code)) return null;
    const said = typeof j.detail === "string" ? readBody(j.detail).message || null : null;
    return new AIProviderError(j.code, {
      ...(typeof j.retryable === "boolean" ? { retryable: j.retryable } : {}),
      ...(typeof j.error === "string" && j.error.trim() ? { message: j.error } : {}),
      said,
    });
  } catch {
    return null;
  }
}
