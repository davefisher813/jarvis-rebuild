import { describe, it, expect } from "vitest";
import { chatFailure } from "./failureWords";
import { AIBudgetError } from "../ai/aiBudget";
import { AIUnavailableError, ADMIN_AI_CODE, ADMIN_AI_MESSAGE } from "../ai/aiGate";
import { AIProviderError, PROVIDER_CODES } from "../ai/providerFailure";

// WHAT THE THREAD SAYS WHEN A TURN FAILS (Dave 2026-10-24: "when something is broken the thread says what is actually wrong").
// One sentence used to stand in for all of these; each is now told apart, and Try Again is offered only where it can work. The words
// are short fragments joined by a middle dot (the short-copy law, Dave 2026-08-15): what is wrong, then what fixes it.

describe("chatFailure: typed causes", () => {
  it("an account out of credit says so, says what fixes it, and offers no retry", () => {
    const f = chatFailure(new AIProviderError("AI_PROVIDER_CREDIT"));
    expect(f).toEqual({ text: "The AI provider account is out of credit · Add credit, then ask again", retryable: false });
  });

  it("a busy provider says so and can be retried", () => {
    const f = chatFailure(new AIProviderError("AI_PROVIDER_BUSY"));
    expect(f.text).toBe("The AI provider isn't answering right now · Try again in a moment");
    expect(f.retryable).toBe(true);
  });

  it("every provider code keeps its own words and its own retry advice", () => {
    for (const code of PROVIDER_CODES) {
      const e = new AIProviderError(code);
      expect(chatFailure(e), code).toEqual({ text: e.message, retryable: e.retryable });
    }
  });

  it("the spending limit Dave set speaks in his own words, untouched, and is not retryable", () => {
    const e = new AIBudgetError({ code: "AI_BUDGET_REACHED", limitMicrousd: 5_000_000, remainingMicrousd: 0 });
    expect(chatFailure(e)).toEqual({ text: "AI paused. You reached your $5 limit.", retryable: false });
  });

  it("AI turned off says so and that records and commands still work", () => {
    const f = chatFailure(new AIUnavailableError("AI_OFF", "AI is turned off in Settings."));
    expect(f.text).toBe("AI is turned off in Settings · I can still answer from your records and run commands");
    expect(f.retryable).toBe(false);
  });

  it("the admin switch keeps its own words, with no promise about commands", () => {
    expect(chatFailure(new AIUnavailableError(ADMIN_AI_CODE, ADMIN_AI_MESSAGE))).toEqual({ text: "AI is turned off for this account by the admin", retryable: false });
  });

  it("a build with no backend says that", () => {
    const f = chatFailure(new AIUnavailableError("AI_NOT_CONFIGURED", "AI is not configured in this build."));
    expect(f).toEqual({ text: "AI is not configured in this build", retryable: false });
  });
});

describe("chatFailure: untyped failures", () => {
  it("a dropped connection is a connection problem, in Chrome's words and Safari's", () => {
    for (const m of ["Failed to fetch", "Load failed", "NetworkError when attempting to fetch resource.", "The network connection was lost."]) {
      expect(chatFailure(new TypeError(m)), m).toEqual({ text: "Couldn't reach JARVIS · Check your connection, then try again", retryable: true });
    }
  });

  it("an expired session says to sign in, not to try again", () => {
    expect(chatFailure(new Error('AI request failed (401). {"error":"Unauthorized"}'))).toEqual({ text: "Your session expired · Sign in again", retryable: false });
  });

  it("the per-user rate cap uses the proxy's sentence set in fragments, and can be retried", () => {
    const f = chatFailure(new Error('AI request failed (429). {"error":"Rate limit reached. Try again shortly."}'));
    expect(f).toEqual({ text: "Rate limit reached · Try again shortly", retryable: true });
  });

  it("a request that was too large says to shorten it", () => {
    const f = chatFailure(new Error('AI request failed (413). {"error":"Request too large"}'));
    expect(f).toEqual({ text: "That was too much to send at once · Try a shorter message", retryable: false });
  });

  it("an unavailable server uses its sentence and can be retried; a misconfigured one cannot", () => {
    expect(chatFailure(new Error('AI request failed (503). {"error":"AI is temporarily unavailable. Try again later."}')))
      .toEqual({ text: "AI is temporarily unavailable · Try again later", retryable: true });
    expect(chatFailure(new Error('AI request failed (500). {"error":"AI not configured on the server"}')))
      .toEqual({ text: "AI not configured on the server", retryable: false });
  });

  it("a bare 502 from an older server is a provider that is not answering", () => {
    expect(chatFailure(new Error("AI request failed (502). garbage"))).toEqual({ text: "The AI isn't answering right now · Try again in a moment", retryable: true });
  });

  it("only when nothing says what happened does the old line survive, and it claims no cause", () => {
    expect(chatFailure(new Error("kaboom"))).toEqual({ text: "Couldn't reach the AI · Try again", retryable: true });
    expect(chatFailure(undefined)).toEqual({ text: "Couldn't reach the AI · Try again", retryable: true });
  });

  it("nothing it says has a dash or a sentence boundary, except the spending limit's own words", () => {
    const all = [
      chatFailure(new AIProviderError("AI_PROVIDER_CREDIT")),
      chatFailure(new AIProviderError("AI_PROVIDER_LIMIT")),
      chatFailure(new AIUnavailableError("AI_OFF", "AI is turned off in Settings.")),
      chatFailure(new TypeError("Failed to fetch")),
      chatFailure(new Error('AI request failed (429). {"error":"Rate limit reached. Try again shortly."}')),
      chatFailure(new Error("x")),
    ];
    for (const f of all) expect(f.text).not.toMatch(/[–—]|\. [A-Z]/);
  });
});
