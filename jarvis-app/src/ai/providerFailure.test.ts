import { describe, it, expect } from "vitest";
import {
  AIProviderError, PROVIDER_CODES, classifyUpstream, isProviderCode, isProviderError, outageCode, parseProviderRefusal, providerWords, retryableCode,
} from "./providerFailure";

// WHAT THE PROVIDER SAID, BY ITS BODY (Dave 2026-10-24). The credit outage that started this: Anthropic answered
// "Your credit balance is too low to access the Anthropic API." as a 400 invalid_request_error, so a classifier that read the
// status filed it with client bugs and the thread said "Couldn't reach the AI · Try again" for three different problems.

const body = (type: string, message: string) => JSON.stringify({ type: "error", error: { type, message } });
const CREDIT_MESSAGE = "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.";

describe("classifyUpstream reads the body before the status", () => {
  it("an account out of credit is a 400 invalid_request_error, and is still credit", () => {
    const f = classifyUpstream(400, body("invalid_request_error", CREDIT_MESSAGE));
    expect(f.code).toBe("AI_PROVIDER_CREDIT");
    expect(f.retryable).toBe(false);
    expect(f.status).toBe(502);
    expect(f.said).toBe(CREDIT_MESSAGE);
  });

  it("credit is credit however it arrives: billing_error, a 402, a 403, no body at all", () => {
    expect(classifyUpstream(402, body("billing_error", "Payment required")).code).toBe("AI_PROVIDER_CREDIT");
    expect(classifyUpstream(403, body("permission_error", CREDIT_MESSAGE)).code).toBe("AI_PROVIDER_CREDIT");
    expect(classifyUpstream(402, "").code).toBe("AI_PROVIDER_CREDIT");
  });

  it("a usage limit is its own thing, and keeps the sentence that says when access returns", () => {
    const said = "You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.";
    const f = classifyUpstream(400, body("invalid_request_error", said));
    expect(f.code).toBe("AI_PROVIDER_LIMIT");
    expect(f.retryable).toBe(false);
    expect(providerWords(f.code, f.said)).toBe("The AI provider account reached its usage limit · You will regain access on 2026-11-01 at 00:00 UTC");
  });

  it("a refused key, a key that may not use the model, and a model that is gone", () => {
    expect(classifyUpstream(401, body("authentication_error", "invalid x-api-key")).code).toBe("AI_PROVIDER_AUTH");
    expect(classifyUpstream(403, body("permission_error", "not allowed")).code).toBe("AI_PROVIDER_ACCESS");
    expect(classifyUpstream(404, body("not_found_error", "model: claude-nope")).code).toBe("AI_PROVIDER_ACCESS");
  });

  it("rate limits and an overloaded provider are the two a second try can fix", () => {
    const rate = classifyUpstream(429, body("rate_limit_error", "This request would exceed your organization's rate limit"));
    expect(rate).toMatchObject({ code: "AI_PROVIDER_RATE", retryable: true, status: 429 });
    const busy = classifyUpstream(529, body("overloaded_error", "Overloaded"));
    expect(busy).toMatchObject({ code: "AI_PROVIDER_BUSY", retryable: true, status: 502 });
    expect(classifyUpstream(500, body("api_error", "Internal server error")).code).toBe("AI_PROVIDER_BUSY");
  });

  it("a request that is too big is told apart from one that was turned down", () => {
    expect(classifyUpstream(413, body("request_too_large", "Request exceeds the maximum allowed number of bytes")))
      .toMatchObject({ code: "AI_PROVIDER_TOO_LARGE", status: 413, retryable: false });
    expect(classifyUpstream(400, body("invalid_request_error", "prompt is too long: 250000 tokens > 200000 maximum")).code).toBe("AI_PROVIDER_TOO_LARGE");
    const other = classifyUpstream(400, body("invalid_request_error", "messages.0.content: Input should be a valid list"));
    expect(other).toMatchObject({ code: "AI_PROVIDER_REJECTED", retryable: false });
  });

  it("falls back to the status only for a body that said nothing usable", () => {
    expect(classifyUpstream(529, "overloaded").code).toBe("AI_PROVIDER_BUSY");
    expect(classifyUpstream(502, "<html>Bad gateway</html>").code).toBe("AI_PROVIDER_BUSY");
    expect(classifyUpstream(401, "").code).toBe("AI_PROVIDER_AUTH");
    expect(classifyUpstream(429, "{}").code).toBe("AI_PROVIDER_RATE");
    expect(classifyUpstream(408, "").code).toBe("AI_PROVIDER_BUSY");
    expect(classifyUpstream(418, "").code).toBe("AI_PROVIDER_REJECTED");
  });

  it("the words beat the status when they disagree", () => {
    // A 500 whose message says the balance is gone is a balance problem, not a provider hiccup.
    expect(classifyUpstream(500, body("api_error", CREDIT_MESSAGE)).code).toBe("AI_PROVIDER_CREDIT");
    // The proxy's own envelope shape is read too.
    expect(classifyUpstream(400, JSON.stringify({ error: CREDIT_MESSAGE })).code).toBe("AI_PROVIDER_CREDIT");
  });

  it("never throws on a body it cannot read", () => {
    for (const b of ["", "null", "7", "[]", "{", "\u0000", JSON.stringify({ error: { type: 5, message: {} } })]) {
      expect(() => classifyUpstream(400, b)).not.toThrow();
    }
  });
});

describe("what retrying does", () => {
  it("only busy and rate are retryable", () => {
    expect(PROVIDER_CODES.filter(retryableCode)).toEqual(["AI_PROVIDER_RATE", "AI_PROVIDER_BUSY"]);
  });

  it("only the four an outside person must fix count as an outage", () => {
    expect(PROVIDER_CODES.filter(outageCode)).toEqual(["AI_PROVIDER_CREDIT", "AI_PROVIDER_LIMIT", "AI_PROVIDER_AUTH", "AI_PROVIDER_ACCESS"]);
  });

  it("the words say 'try again' exactly when trying again can work", () => {
    for (const code of PROVIDER_CODES) {
      expect(/try again/i.test(providerWords(code)), code).toBe(retryableCode(code));
    }
  });

  it("every line is plain: no dash, no raw status, no JSON, and short fragments (the short-copy law has no sentence boundary)", () => {
    for (const code of PROVIDER_CODES) {
      const w = providerWords(code);
      expect(w.length, code).toBeGreaterThan(20);
      expect(w, code).not.toMatch(/[–—{}]|\b[1-5]\d\d\b/);
      expect(w, code).not.toMatch(/\. [A-Z]/);
    }
  });

  it("credit says what is wrong, then what fixes it", () => {
    expect(providerWords("AI_PROVIDER_CREDIT")).toBe("The AI provider account is out of credit · Add credit, then ask again");
  });
});

describe("the code on the wire", () => {
  it("round-trips through the proxy's envelope", () => {
    const f = classifyUpstream(400, body("invalid_request_error", CREDIT_MESSAGE));
    const wire = JSON.stringify({ error: providerWords(f.code, f.said), code: f.code, retryable: f.retryable, detail: body("invalid_request_error", CREDIT_MESSAGE) });
    const e = parseProviderRefusal(wire)!;
    expect(isProviderError(e)).toBe(true);
    expect(e.code).toBe("AI_PROVIDER_CREDIT");
    expect(e.retryable).toBe(false);
    expect(e.message).toBe("The AI provider account is out of credit · Add credit, then ask again");
    expect(e.said).toBe(CREDIT_MESSAGE);
  });

  it("rebuilds the words from the code when the body carried none", () => {
    const e = parseProviderRefusal(JSON.stringify({ code: "AI_PROVIDER_BUSY" }))!;
    expect(e.message).toBe(providerWords("AI_PROVIDER_BUSY"));
    expect(e.retryable).toBe(true);
  });

  it("only a KNOWN code counts: a budget refusal or a stranger's JSON is not a provider failure", () => {
    expect(parseProviderRefusal(JSON.stringify({ code: "AI_BUDGET_REACHED", error: "x" }))).toBeNull();
    expect(parseProviderRefusal(JSON.stringify({ code: "nope" }))).toBeNull();
    expect(parseProviderRefusal("not json")).toBeNull();
    expect(isProviderCode("AI_PROVIDER_RATE")).toBe(true);
    expect(isProviderCode(undefined)).toBe(false);
  });

  it("the typed error carries its code and defaults its retry advice from it", () => {
    const e = new AIProviderError("AI_PROVIDER_RATE");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("AIProviderError");
    expect(e.retryable).toBe(true);
    expect(new AIProviderError("AI_PROVIDER_CREDIT").retryable).toBe(false);
  });
});
