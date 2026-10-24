import { describe, it, expect, vi, beforeEach } from "vitest";
import { AIService } from "./AIService";
import { AIUnavailableError, isUnavailableError } from "./aiGate";
import { isBudgetError } from "./aiBudget";
import { clearBudgetBlock } from "./budgetBlock";
import { AIProviderError, isProviderError } from "./providerFailure";
import { clearProviderBlock, noteProviderFailure, providerBlocked } from "./providerBlock";
import { aiFailureLine } from "./failureLine";
import { setAIControl, setAdminAiBlocked } from "./levelStore";

// THE CLIENT HALF OF "SAY WHAT IS ACTUALLY WRONG" (Dave 2026-10-24). A provider failure becomes a typed error in plain words; the
// level's own refusals keep their sentences and gain a code; an outage nobody in the app can fix (credit, usage limit, key, model
// access) is remembered so background work stops knocking, and lapses on its own because the fix happens outside the app.

const CREDIT = { error: "The AI provider account is out of credit · Add credit, then ask again", code: "AI_PROVIDER_CREDIT", retryable: false };
const BUSY = { error: "The AI provider isn't answering right now · Try again in a moment", code: "AI_PROVIDER_BUSY", retryable: true };
const MSG = [{ role: "user" as const, content: "hi" }];

function svc(responses: Response[]) {
  const fetchImpl = vi.fn(async () => responses.shift()!);
  return { s: new AIService({ available: true, fetchImpl: fetchImpl as unknown as typeof fetch, getToken: () => "t" }), fetchImpl };
}
const refused = (body: object, status = 502) => () => new Response(JSON.stringify(body), { status });
const answered = () => new Response(JSON.stringify({ text: "ok" }), { status: 200 });

beforeEach(() => {
  clearBudgetBlock();
  clearProviderBlock();
  setAdminAiBlocked(false);
  setAIControl({ level: "everything" });
});

describe("a provider failure", () => {
  it("becomes an AIProviderError in the proxy's plain words, never raw JSON", async () => {
    const { s } = svc([refused(CREDIT)()]);
    const e = await s.complete(MSG, undefined, { kind: "chat" }).catch((x) => x);
    expect(isProviderError(e)).toBe(true);
    expect((e as AIProviderError).code).toBe("AI_PROVIDER_CREDIT");
    expect((e as AIProviderError).retryable).toBe(false);
    expect((e as Error).message).toBe(CREDIT.error);
    expect(aiFailureLine(e, "Couldn't sort")).toBe(CREDIT.error);
  });

  it("carries the retry advice the proxy gave", async () => {
    const { s } = svc([refused(BUSY)()]);
    const e = (await s.complete(MSG, undefined, { kind: "chat" }).catch((x) => x)) as AIProviderError;
    expect(e.code).toBe("AI_PROVIDER_BUSY");
    expect(e.retryable).toBe(true);
  });

  it("is not mistaken for a budget refusal, and a budget refusal is not mistaken for it", async () => {
    const { s } = svc([new Response(JSON.stringify({ error: "AI paused. You reached your $5 limit.", code: "AI_BUDGET_REACHED", limitMicrousd: 5_000_000, remainingMicrousd: 0 }), { status: 402 })]);
    const e = await s.complete(MSG, undefined, { kind: "chat" }).catch((x) => x);
    expect(isBudgetError(e)).toBe(true);
    expect(isProviderError(e)).toBe(false);
  });

  it("an older proxy's untyped 502 still reads as before", async () => {
    const { s } = svc([new Response(JSON.stringify({ error: "Upstream error", detail: "overloaded" }), { status: 502 })]);
    const e = (await s.complete(MSG, undefined, { kind: "chat" }).catch((x) => x)) as Error;
    expect(isProviderError(e)).toBe(false);
    expect(e.message).toMatch(/^AI request failed \(502\)/);
  });
});

describe("an outage only a person can fix", () => {
  it("stops background callers cold: no request, the same error", async () => {
    const { s, fetchImpl } = svc([refused(CREDIT)()]);
    await s.complete(MSG, undefined, { kind: "triage", background: true }).catch(() => {});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 20; i++) {
      const e = await s.complete(MSG, undefined, { kind: "triage", background: true }).catch((x) => x);
      expect(isProviderError(e)).toBe(true);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never holds back a call the person asked for: that call is the probe, and its success clears the block", async () => {
    const { s, fetchImpl } = svc([refused(CREDIT)(), answered()]);
    await s.complete(MSG, undefined, { kind: "triage", background: true }).catch(() => {});
    expect(providerBlocked()).not.toBeNull();
    expect(await s.complete(MSG, undefined, { kind: "chat" })).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(providerBlocked()).toBeNull();
  });

  it("lapses on its own, because the fix (adding credit) happens where the app cannot hear it", () => {
    const t0 = 1_000_000;
    noteProviderFailure(new AIProviderError("AI_PROVIDER_CREDIT"), t0);
    expect(providerBlocked(t0 + 14 * 60_000)).not.toBeNull();
    expect(providerBlocked(t0 + 15 * 60_000)).toBeNull();
  });

  it("is held for credit, usage limit, key and model access, and for nothing else", () => {
    for (const code of ["AI_PROVIDER_CREDIT", "AI_PROVIDER_LIMIT", "AI_PROVIDER_AUTH", "AI_PROVIDER_ACCESS"] as const) {
      clearProviderBlock();
      noteProviderFailure(new AIProviderError(code));
      expect(providerBlocked(), code).not.toBeNull();
    }
    for (const code of ["AI_PROVIDER_BUSY", "AI_PROVIDER_RATE", "AI_PROVIDER_TOO_LARGE", "AI_PROVIDER_REJECTED"] as const) {
      clearProviderBlock();
      noteProviderFailure(new AIProviderError(code));
      expect(providerBlocked(), code).toBeNull();
    }
  });

  it("a busy provider holds nothing: the next background call goes out", async () => {
    const { s, fetchImpl } = svc([refused(BUSY)(), answered()]);
    await s.complete(MSG, undefined, { kind: "triage", background: true }).catch(() => {});
    expect(await s.complete(MSG, undefined, { kind: "triage", background: true })).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("AI that is not available at all says why, in the same words as ever", () => {
  it("Off is AI_OFF", async () => {
    setAIControl({ level: "off" });
    const { s, fetchImpl } = svc([]);
    const e = await s.complete(MSG, undefined, { kind: "chat" }).catch((x) => x);
    expect(isUnavailableError(e)).toBe(true);
    expect((e as AIUnavailableError).code).toBe("AI_OFF");
    expect((e as Error).message).toBe("AI is turned off in Settings.");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("background work at On Request is AI_BACKGROUND_OFF", async () => {
    setAIControl({ level: "request" });
    const { s } = svc([]);
    const e = await s.complete(MSG, undefined, { kind: "brief", background: true }).catch((x) => x);
    expect((e as AIUnavailableError).code).toBe("AI_BACKGROUND_OFF");
    expect((e as Error).message).toBe("Background drafting is off at this AI level.");
  });

  it("the admin switch is AI_ADMIN_BLOCKED", async () => {
    setAdminAiBlocked(true);
    const { s } = svc([]);
    const e = await s.complete(MSG, undefined, { kind: "chat" }).catch((x) => x);
    expect((e as AIUnavailableError).code).toBe("AI_ADMIN_BLOCKED");
    expect((e as Error).message).toBe("AI is turned off for this account by the admin.");
  });

  it("a build with no backend is AI_NOT_CONFIGURED", async () => {
    const s = new AIService({ available: false });
    const e = await s.complete(MSG).catch((x) => x);
    expect((e as AIUnavailableError).code).toBe("AI_NOT_CONFIGURED");
    expect((e as Error).message).toBe("AI is not configured in this build.");
  });

  it("the proxy's own refusal (this device's copy of the level was stale) lands as the same typed error", async () => {
    const { s } = svc([new Response(JSON.stringify({ error: "AI is turned off in Settings.", code: "AI_OFF" }), { status: 403 })]);
    const e = await s.complete(MSG, undefined, { kind: "chat" }).catch((x) => x);
    expect(isUnavailableError(e)).toBe(true);
    expect((e as AIUnavailableError).code).toBe("AI_OFF");
    expect(aiFailureLine(e, "Couldn't sort")).toBe("AI is turned off in Settings.");
  });

  it("a 403 with no code (an older proxy) is still the generic failure it was", async () => {
    const { s } = svc([new Response(JSON.stringify({ error: "AI is turned off in Settings." }), { status: 403 })]);
    const e = (await s.complete(MSG, undefined, { kind: "chat" }).catch((x) => x)) as Error;
    expect(isUnavailableError(e)).toBe(false);
    expect(e.message).toMatch(/^AI request failed \(403\)/);
  });
});
