import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeBudget } from "./fakeBudgetRpc";

// THE PROXY SAYS WHAT THE PROVIDER SAID (Dave 2026-10-24). api/ai.ts answered every upstream failure as
// { error: "Upstream error" } under 502, so an account out of credit (which Anthropic sends as a 400
// invalid_request_error) and a provider having a bad minute were the same response. The handler now reads the BODY, answers with a
// stable code, the plain words and whether asking again can help, and keeps the money rules exactly where they were: a provider
// 4xx cost nothing so the hold goes back, a 5xx or a dropped connection may have been billed so it stays.

let handler: (req: Request) => Promise<Response>;
let budget: FakeBudget;
let upstreamReply: () => Response = () => new Response("{}", { status: 200 });

function post(body: unknown): Request {
  return new Request("https://app.test/api/ai", {
    method: "POST",
    headers: { authorization: "Bearer user-token", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const CALL = { messages: [{ role: "user", content: "hello" }], kind: "chat" };
const errBody = (type: string, message: string) => JSON.stringify({ type: "error", error: { type, message } });
const CREDIT = "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.";

beforeEach(async () => {
  budget = new FakeBudget();
  upstreamReply = () => new Response(JSON.stringify({ content: [{ type: "text", text: "hi" }], usage: { input_tokens: 10, output_tokens: 3 } }), { status: 200 });
  vi.stubEnv("AI_SPEND_CAP", "1");
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
  vi.stubEnv("VITE_SUPABASE_URL", "https://supa.test");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) return new Response(JSON.stringify({ id: "user-1" }), { status: 200 });
    if (url.includes("/rest/v1/item")) return new Response(JSON.stringify([{ data: { ai: { level: "everything" } } }]), { status: 200 });
    if (url.includes("/rpc/ai_budget")) return budget.handle(url, JSON.parse(String(init?.body ?? "{}")))!;
    if (url.includes("/rpc/ai_try_consume")) return new Response(JSON.stringify({ allowed: true }), { status: 200 });
    if (url.includes("api.anthropic.com")) return upstreamReply();
    return new Response("{}", { status: 200 });
  }));
  vi.resetModules();
  vi.stubEnv("AI_MODEL", "claude-sonnet-5-5");
  handler = (await import("../../api/ai")).default;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Wire = { error: string; code: string; retryable: boolean; detail?: string };

describe("an account out of credit", () => {
  it("is named as one, whatever status it travelled under", async () => {
    upstreamReply = () => new Response(errBody("invalid_request_error", CREDIT), { status: 400 });
    const res = await handler(post(CALL));
    expect(res.status).toBe(502);
    const w = (await res.json()) as Wire;
    expect(w.code).toBe("AI_PROVIDER_CREDIT");
    expect(w.retryable).toBe(false);
    expect(w.error).toBe("The AI provider account is out of credit · Add credit, then ask again");
    // The provider's own body still rides along for anything that wants it (failureLine reads it).
    expect(w.detail).toBe(errBody("invalid_request_error", CREDIT));
  });

  it("cost nothing, so the hold goes back (the money rule is unchanged)", async () => {
    upstreamReply = () => new Response(errBody("invalid_request_error", CREDIT), { status: 400 });
    await handler(post(CALL));
    expect(budget.held).toBe(0);
    expect(budget.spent).toBe(0);
  });

  it("is logged for the operator as a code and a status, never the request", async () => {
    upstreamReply = () => new Response(errBody("invalid_request_error", CREDIT), { status: 400 });
    await handler(post({ ...CALL, messages: [{ role: "user", content: "my secret plan" }] }));
    const lines = (console.error as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("AI_PROVIDER_CREDIT") && l.includes("400"))).toBe(true);
    expect(lines.join("\n")).not.toContain("my secret plan");
  });
});

describe("the other ways the provider fails", () => {
  it("an overloaded provider is busy: retryable, and the hold stays because it may have been billed", async () => {
    upstreamReply = () => new Response(errBody("overloaded_error", "Overloaded"), { status: 529 });
    const res = await handler(post(CALL));
    expect(res.status).toBe(502);
    const w = (await res.json()) as Wire;
    expect(w).toMatchObject({ code: "AI_PROVIDER_BUSY", retryable: true });
    expect(budget.held).toBeGreaterThan(0);
  });

  it("a dropped connection says the provider is not answering, retryable, hold kept", async () => {
    upstreamReply = () => { throw new Error("socket hang up"); };
    const res = await handler(post(CALL));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: "AI_PROVIDER_BUSY", retryable: true });
    expect(budget.held).toBeGreaterThan(0);
  });

  it("a rate limit travels as 429 so anything reading the status still reads 'later'", async () => {
    upstreamReply = () => new Response(errBody("rate_limit_error", "slow down"), { status: 429 });
    const res = await handler(post(CALL));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "AI_PROVIDER_RATE", retryable: true });
  });

  it("a refused key is not retryable and is not a sign-in problem (never a 401)", async () => {
    upstreamReply = () => new Response(errBody("authentication_error", "invalid x-api-key"), { status: 401 });
    const res = await handler(post(CALL));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: "AI_PROVIDER_AUTH", retryable: false });
  });

  it("an unreadable reply that WAS billed settles at the maximum and says the provider is not answering", async () => {
    upstreamReply = () => new Response("not json", { status: 200 });
    const res = await handler(post(CALL));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: "AI_PROVIDER_BUSY" });
    const [r] = [...budget.reservations.values()];
    expect(r!.state).toBe("settled");
  });

  it("a plain {error:'bad'} 400 is simply turned down, still 502, still released", async () => {
    upstreamReply = () => new Response(JSON.stringify({ error: "bad" }), { status: 400 });
    const res = await handler(post(CALL));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: "AI_PROVIDER_REJECTED", retryable: false });
    expect(budget.held).toBe(0);
  });
});

describe("the level's own refusal carries a code too", () => {
  it("Off travels as AI_OFF beside the same sentence it always had", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/auth/v1/user")) return new Response(JSON.stringify({ id: "user-1" }), { status: 200 });
      if (url.includes("/rest/v1/item")) return new Response(JSON.stringify([{ data: { ai: { level: "off" } } }]), { status: 200 });
      return new Response("{}", { status: 200 });
    }));
    const res = await handler(post(CALL));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "AI is turned off in Settings.", code: "AI_OFF" });
  });
});
