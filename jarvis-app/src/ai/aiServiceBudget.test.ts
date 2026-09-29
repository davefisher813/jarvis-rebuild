import { describe, it, expect, vi, beforeEach } from "vitest";
import { AIService } from "./AIService";
import { AIBudgetError, isBudgetError } from "./aiBudget";
import { budgetBlocked, clearBudgetBlock } from "./budgetBlock";
import { aiFailureLine } from "./failureLine";
import { setAIControl } from "./levelStore";

// The client half of the limit: a budget refusal becomes a typed error in
// plain words, is remembered so background callers stop asking, and clears
// when the limit changes or a wanted call gets through.

const CAP = { error: "AI paused. You reached your $5 limit.", code: "AI_BUDGET_REACHED", limitMicrousd: 5_000_000, remainingMicrousd: 0 };

function svc(responses: Response[]) {
  const fetchImpl = vi.fn(async () => responses.shift()!);
  return { s: new AIService({ available: true, fetchImpl: fetchImpl as unknown as typeof fetch, getToken: () => "t" }), fetchImpl };
}
const refused = () => new Response(JSON.stringify(CAP), { status: 402 });
const answered = () => new Response(JSON.stringify({ text: "ok" }), { status: 200 });
const MSG = [{ role: "user" as const, content: "hi" }];

beforeEach(() => { clearBudgetBlock(); setAIControl({ level: "everything" }); });

describe("a budget refusal", () => {
  it("becomes an AIBudgetError in plain words, not raw JSON", async () => {
    const { s } = svc([refused()]);
    const e = await s.complete(MSG, undefined, { kind: "chat" }).catch((x) => x);
    expect(isBudgetError(e)).toBe(true);
    expect((e as AIBudgetError).code).toBe("AI_BUDGET_REACHED");
    expect((e as Error).message).toBe("AI paused. You reached your $5 limit.");
    expect(aiFailureLine(e, "Couldn't sort")).toBe("AI paused. You reached your $5 limit.");
  });

  it("stops background callers cold: no request, same error, until something changes", async () => {
    const { s, fetchImpl } = svc([refused()]);
    await s.complete(MSG, undefined, { kind: "triage", background: true }).catch(() => {});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 20; i++) {
      const e = await s.complete(MSG, undefined, { kind: "triage", background: true }).catch((x) => x);
      expect(isBudgetError(e)).toBe(true);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a call the person asked for still goes to the server, and clears the block when it works", async () => {
    const { s, fetchImpl } = svc([refused(), answered()]);
    await s.complete(MSG, undefined, { kind: "triage", background: true }).catch(() => {});
    expect(budgetBlocked()).not.toBeNull();
    expect(await s.complete(MSG, undefined, { kind: "chat" })).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(budgetBlocked()).toBeNull();
  });

  it("saving a limit clears the block", async () => {
    const { s } = svc([refused()]);
    await s.complete(MSG, undefined, { kind: "triage", background: true }).catch(() => {});
    clearBudgetBlock();
    expect(budgetBlocked()).toBeNull();
  });

  it("an unrelated 402 is not mistaken for a budget refusal", async () => {
    const { s } = svc([new Response(JSON.stringify({ error: "payment", code: "SOMETHING_ELSE" }), { status: 402 })]);
    const e = await s.complete(MSG, undefined, { kind: "chat" }).catch((x) => x);
    expect(isBudgetError(e)).toBe(false);
    expect(budgetBlocked()).toBeNull();
  });

  it("a replay says nothing about money and blocks nothing", async () => {
    const { s } = svc([new Response(JSON.stringify({ error: "x", code: "AI_BUDGET_REPLAY" }), { status: 409 })]);
    await s.complete(MSG, undefined, { kind: "chat" }).catch(() => {});
    expect(budgetBlocked()).toBeNull();
  });
});

describe("every call names itself", () => {
  it("sends a fresh request id per call, so a retried POST cannot spend twice", async () => {
    const { s, fetchImpl } = svc([answered(), answered()]);
    await s.complete(MSG, undefined, { kind: "chat" });
    await s.complete(MSG, undefined, { kind: "chat" });
    const ids = fetchImpl.mock.calls.map((c) => JSON.parse(String((c as unknown as [string, RequestInit])[1].body)).requestId);
    expect(ids[0]).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(ids[0]).not.toBe(ids[1]);
  });
});
