import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// NO SPENDING LIMIT (Dave, 2026-09-29): "I don't want anything gating me. We'll
// design spending limits after the PWA is done." The dollar cap is opt-in
// (AI_SPEND_CAP=1); off, a call goes straight to the provider: nothing is
// reserved, held, refused or settled, even for a model the price table does
// not know. The cap itself stays proven, switched on, in aiProxyBudget.test.ts.

let handler: (req: Request) => Promise<Response>;
const upstream = vi.fn();
const budgetCalls: string[] = [];

function post(body: unknown): Request {
  return new Request("https://app.test/api/ai", {
    method: "POST",
    headers: { authorization: "Bearer user-token", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const CALL = { messages: [{ role: "user", content: "hello" }], kind: "chat" };

beforeEach(async () => {
  upstream.mockReset();
  budgetCalls.length = 0;
  vi.resetModules();
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
  vi.stubEnv("VITE_SUPABASE_URL", "https://supa.test");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  vi.stubEnv("AI_MODEL", "some-model-with-no-price");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) return new Response(JSON.stringify({ id: "user-1" }), { status: 200 });
    if (url.includes("/rest/v1/item")) return new Response(JSON.stringify([{ data: { ai: { level: "everything" } } }]), { status: 200 });
    if (url.includes("/rpc/ai_budget")) { budgetCalls.push(url); return new Response("{}", { status: 500 }); }
    if (url.includes("/rest/v1/ai_usage") || url.includes("/rest/v1/ai_tokens")) return new Response("[]", { status: 200 });
    if (url.includes("/rpc/ai_try_consume")) return new Response(JSON.stringify({ allowed: true }), { status: 200 });
    if (url.includes("api.anthropic.com")) {
      upstream(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ content: [{ type: "text", text: "hi" }], usage: { input_tokens: 5, output_tokens: 5 } }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }));
  handler = (await import("../../api/ai")).default;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the dollar cap is off unless AI_SPEND_CAP=1", () => {
  it("serves the call and never touches the budget, whatever the model", async () => {
    const res = await handler(post(CALL));
    expect(res.status).toBe(200);
    expect((await res.json() as { text: string }).text).toBe("hi");
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(budgetCalls).toEqual([]);
  });

  it("a broken budget function cannot stop a call", async () => {
    const res = await handler(post({ ...CALL, requestId: "same" }));
    const again = await handler(post({ ...CALL, requestId: "same" }));
    expect(res.status).toBe(200);
    expect(again.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("usage shows no budget and the limit cannot be saved", async () => {
    const usage = (await import("../../api/ai-usage")).default;
    const get = await usage(new Request("https://app.test/api/ai-usage", { headers: { authorization: "Bearer user-token" } }));
    expect((await get.json() as { budget: unknown }).budget).toBeNull();
    const patch = await usage(new Request("https://app.test/api/ai-usage", {
      method: "PATCH",
      headers: { authorization: "Bearer user-token", "content-type": "application/json" },
      body: JSON.stringify({ limitMicrousd: 5_000_000, expectedVersion: 1 }),
    }));
    expect(patch.status).toBe(404);
  });
});
