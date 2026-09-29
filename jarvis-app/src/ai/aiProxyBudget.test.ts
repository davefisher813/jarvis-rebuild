import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeBudget } from "./fakeBudgetRpc";
import { PRICE_VERSION, actualCostMicrousd, maxCostMicrousd } from "./aiBudget";

// THE DOLLAR CAP AT THE HANDLER (migration 0043). Proves what api/ai.ts does
// with the budget: reserve before dispatch, one dispatch, settle from real
// usage, hold on uncertainty, refuse and never call the provider when the
// count says no. The rules under real concurrency are proven against Postgres
// in jarvis-core/supabase/tests/ai_budget.sh; this file uses an in-memory
// fake of the same contract.

let handler: (req: Request) => Promise<Response>;
let budget: FakeBudget;
const upstream = vi.fn();
let upstreamMode: "ok" | "4xx" | "5xx" | "throw" | "nousage" | "badjson" = "ok";
const USAGE = { input_tokens: 800, output_tokens: 200 };

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://app.test/api/ai", {
    method: "POST",
    headers: { authorization: "Bearer user-token", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
const CALL = { messages: [{ role: "user", content: "hello" }], kind: "chat" };

async function load(model = "claude-sonnet-5-5") {
  vi.resetModules();
  vi.stubEnv("AI_MODEL", model);
  handler = (await import("../../api/ai")).default;
}

beforeEach(async () => {
  upstream.mockReset();
  upstreamMode = "ok";
  budget = new FakeBudget();
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
    if (url.includes("api.anthropic.com")) {
      upstream(JSON.parse(String(init?.body)));
      if (upstreamMode === "throw") throw new Error("socket hang up");
      if (upstreamMode === "4xx") return new Response(JSON.stringify({ error: "bad" }), { status: 400 });
      if (upstreamMode === "5xx") return new Response("overloaded", { status: 529 });
      if (upstreamMode === "badjson") return new Response("not json", { status: 200 });
      return new Response(JSON.stringify({
        content: [{ type: "text", text: "hi" }],
        ...(upstreamMode === "nousage" ? {} : { usage: USAGE }),
      }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }));
  await load();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const bound = (bytesOverride?: number) => maxCostMicrousd({
  model: "claude-sonnet-5-5", textBytes: bytesOverride ?? 0, imageCount: 0, usesCache: false, usesTools: false, maxTokens: 1024,
});

describe("the happy path", () => {
  it("reserves, dispatches once, then settles at the cost the provider reported", async () => {
    const res = await handler(post(CALL));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { text: string }).text).toBe("hi");
    expect(budget.calls.filter((c) => c !== "ai_budget_status")).toEqual([
      "ai_budget_reserve", "ai_budget_mark_dispatched", "ai_budget_settle",
    ]);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(budget.spent).toBe(actualCostMicrousd("claude-sonnet-5-5", USAGE));
    expect(budget.held).toBe(0);
  });

  it("the hold is placed BEFORE the provider is called", async () => {
    let heldAtDispatch = -1;
    upstream.mockImplementation(() => { heldAtDispatch = budget.held; });
    await handler(post(CALL));
    expect(heldAtDispatch).toBeGreaterThan(0);
  });

  it("records the exact model and the price version on the reservation, keyed by the verified user", async () => {
    await handler(post({ ...CALL, user_id: "victim", user: "victim", p_user: "victim" }));
    const [r] = [...budget.reservations.values()];
    expect(r!.user).toBe("user-1");
  });

  it("the price version is a real, dated one", () => expect(PRICE_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/));
});

describe("refusals never reach the provider", () => {
  it("at the cap: 402, the exact words, the code, no upstream call", async () => {
    budget.spent = budget.limit;
    const res = await handler(post(CALL));
    expect(res.status).toBe(402);
    const b = (await res.json()) as { error: string; code: string; limitMicrousd: number; remainingMicrousd: number };
    expect(b.error).toBe("AI paused. You reached your $5 limit.");
    expect(b.code).toBe("AI_BUDGET_REACHED");
    expect(b.remainingMicrousd).toBe(0);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("with some left but not enough for this request: says so", async () => {
    budget.spent = budget.limit - 1_000; // $0.001 left
    const res = await handler(post(CALL));
    expect(res.status).toBe(402);
    const b = (await res.json()) as { error: string; code: string };
    expect(b.code).toBe("AI_BUDGET_REQUEST_TOO_LARGE");
    expect(b.error).toBe("This could cost more than the $0.00 left of your $5 limit.");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("a zero limit is off", async () => {
    budget.limit = 0;
    const res = await handler(post(CALL));
    expect(res.status).toBe(402);
    expect(((await res.json()) as { code: string }).code).toBe("AI_BUDGET_OFF");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("an overrun pause refuses until the limit is saved again", async () => {
    budget.paused = true;
    const res = await handler(post(CALL));
    expect(((await res.json()) as { code: string }).code).toBe("AI_BUDGET_PAUSED");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("if the budget cannot be read, nothing is spent", async () => {
    budget.fail = 500;
    const res = await handler(post(CALL));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe("AI_BUDGET_UNAVAILABLE");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("a model with no exact price is not called", async () => {
    await load("claude-mystery-9");
    const res = await handler(post(CALL));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe("AI_BUDGET_UNAVAILABLE");
    expect(upstream).not.toHaveBeenCalled();
    expect(budget.reservations.size).toBe(0);
  });

  it("no service key: refused, and AI_REQUIRE_LIMITS=0 does not change that", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("AI_REQUIRE_LIMITS", "0");
    const res = await handler(post(CALL));
    expect(res.status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("the words on screen are never raw JSON", async () => {
    budget.spent = budget.limit;
    const b = (await (await handler(post(CALL))).json()) as { error: string };
    expect(b.error).not.toMatch(/[{}]/);
  });
});

describe("one call, one spend", () => {
  it("a repeated request id never dispatches twice", async () => {
    const h = { "x-request-id": "call-abcdef123456" };
    const a = await handler(post(CALL, h));
    const b = await handler(post(CALL, h));
    expect(a.status).toBe(200);
    expect(b.status).toBe(409);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(budget.spent).toBe(actualCostMicrousd("claude-sonnet-5-5", USAGE));
  });

  it("the same id with a different body is refused", async () => {
    const h = { "x-request-id": "call-abcdef123456" };
    await handler(post(CALL, h));
    const b = await handler(post({ ...CALL, messages: [{ role: "user", content: "different" }] }, h));
    expect(b.status).toBe(409);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("a malformed id is just a new call", async () => {
    await handler(post(CALL, { "x-request-id": "no" }));
    await handler(post(CALL, { "x-request-id": "no" }));
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("if dispatch cannot be recorded, nothing is sent and the hold goes back", async () => {
    budget.failOn = "ai_budget_mark_dispatched";
    const res = await handler(post(CALL));
    expect(res.status).toBe(409);
    expect(upstream).not.toHaveBeenCalled();
    expect(budget.held).toBe(0);
  });
});

describe("uncertainty keeps the hold", () => {
  it("a provider 4xx cost nothing, so the hold is released", async () => {
    upstreamMode = "4xx";
    const res = await handler(post(CALL));
    expect(res.status).toBe(502);
    expect(budget.held).toBe(0);
    expect(budget.spent).toBe(0);
  });

  it("a provider 5xx may have been billed, so the hold stays", async () => {
    upstreamMode = "5xx";
    await handler(post(CALL));
    expect(budget.held).toBeGreaterThan(0);
  });

  it("a dropped connection may have been billed, so the hold stays", async () => {
    upstreamMode = "throw";
    const res = await handler(post(CALL));
    expect(res.status).toBe(502);
    expect(budget.held).toBeGreaterThan(0);
    expect(budget.spent).toBe(0);
  });

  it("missing usage settles at the reserved maximum, never zero", async () => {
    upstreamMode = "nousage";
    await handler(post(CALL));
    const [r] = [...budget.reservations.values()];
    expect(r!.state).toBe("settled");
    expect(r!.actual).toBe(r!.reserved);
    expect(budget.spent).toBe(r!.reserved);
  });

  it("an unreadable reply settles at the reserved maximum too", async () => {
    upstreamMode = "badjson";
    const res = await handler(post(CALL));
    expect(res.status).toBe(502);
    const [r] = [...budget.reservations.values()];
    expect(r!.state).toBe("settled");
    expect(budget.held).toBe(0);
  });

  it("a failed settlement still returns the answer, marked pending, hold retained", async () => {
    budget.failOn = "ai_budget_settle";
    const res = await handler(post(CALL));
    expect(res.status).toBe(200);
    const b = (await res.json()) as { text: string; accounting?: string };
    expect(b.text).toBe("hi");
    expect(b.accounting).toBe("pending");
    expect(budget.held).toBeGreaterThan(0);
  });
});

describe("the cap under concurrency (handler level)", () => {
  it("40 simultaneous calls against a tight cap never push spent + held past it", async () => {
    // Room for 5 worst-case holds at once. Real usage is far below the bound,
    // so as calls settle more get in, but at no instant may the sum pass the cap.
    const one = bound(10)!;
    budget.limit = one * 5;
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) =>
      handler(post({ ...CALL, messages: [{ role: "user", content: `m${i}` }] }, { "x-request-id": `concurrent-${String(i).padStart(4, "0")}` }))));
    const ok = results.filter((r) => r.status === 200).length;
    const refused = results.filter((r) => r.status === 402).length;
    expect(ok + refused).toBe(40);
    expect(budget.peak).toBeLessThanOrEqual(budget.limit);
    expect(budget.spent + budget.held).toBeLessThanOrEqual(budget.limit);
    expect(upstream).toHaveBeenCalledTimes(ok);
    expect(refused).toBeGreaterThan(0);
  });

  it("at the cap nothing is dispatched no matter how often it is asked", async () => {
    budget.spent = budget.limit;
    await Promise.all(Array.from({ length: 25 }, () => handler(post(CALL))));
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe("the bound covers what is really sent", () => {
  it("a schema call and a system prompt are priced into the reservation", async () => {
    await handler(post({
      ...CALL,
      system: "be brief",
      schema: { type: "object", properties: { a: { type: "string" } } },
    }));
    const [r] = [...budget.reservations.values()];
    const plain = bound(0)!;
    expect(r!.reserved).toBeGreaterThan(plain);
  });

  it("an image is bounded by a fixed ceiling, not by its base64 length", async () => {
    const png = "A".repeat(200_000);
    await handler(post({
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: png } },
        { type: "text", text: "read this" },
      ] }],
      kind: "vision",
    }));
    const [r] = [...budget.reservations.values()];
    // 200k base64 chars counted as text would reserve ~$0.40+; the image ceiling is 4784 tokens
    expect(r!.reserved).toBeLessThan(60_000);
    expect(r!.reserved).toBeGreaterThan(4784 * 2);
  });
});
