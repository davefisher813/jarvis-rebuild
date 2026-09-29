import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import handler from "../../api/ai-usage";
import { FakeBudget } from "./fakeBudgetRpc";

// The budget half of /api/ai-usage: GET carries the balance, PATCH sets the
// limit and NOTHING else. Spent and held belong to the database.

let budget: FakeBudget;

function req(method: string, body?: unknown): Request {
  return new Request("https://app.test/api/ai-usage", {
    method,
    headers: { authorization: "Bearer user-token", "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  budget = new FakeBudget();
  vi.stubEnv("VITE_SUPABASE_URL", "https://supa.test");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) return new Response(JSON.stringify({ id: "user-1" }), { status: 200 });
    if (url.includes("/rpc/ai_budget")) return budget.handle(url, JSON.parse(String(init?.body ?? "{}")))!;
    if (url.includes("/rest/v1/ai_usage")) return new Response("[]", { status: 200 });
    if (url.includes("/rest/v1/ai_tokens")) return new Response("[]", { status: 200 });
    return new Response("{}", { status: 200 });
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("GET carries the balance", () => {
  it("returns the budget beside the existing usage fields", async () => {
    budget.spent = 1_250_000;
    const d = (await (await handler(req("GET"))).json()) as { count: number; budget: { limitMicrousd: number; spentMicrousd: number; remainingMicrousd: number; version: number } };
    expect(d.count).toBe(0);
    expect(d.budget.limitMicrousd).toBe(5_000_000);
    expect(d.budget.spentMicrousd).toBe(1_250_000);
    expect(d.budget.remainingMicrousd).toBe(3_750_000);
    expect(d.budget.version).toBe(1);
  });
  it("is null when it cannot be read, never an invented number", async () => {
    budget.fail = 500;
    const d = (await (await handler(req("GET"))).json()) as { budget: unknown };
    expect(d.budget).toBeNull();
  });
});

describe("PATCH sets the limit and nothing else", () => {
  it("saves a limit with the version the client saw", async () => {
    const res = await handler(req("PATCH", { limitMicrousd: 8_000_000, expectedVersion: 1 }));
    expect(res.status).toBe(200);
    const d = (await res.json()) as { budget: { limitMicrousd: number; version: number } };
    expect(d.budget.limitMicrousd).toBe(8_000_000);
    expect(d.budget.version).toBe(2);
  });
  it("changing the cap never resets spent", async () => {
    budget.spent = 2_000_000;
    await handler(req("PATCH", { limitMicrousd: 9_000_000, expectedVersion: 1 }));
    expect(budget.spent).toBe(2_000_000);
  });
  it("a stale version conflicts and hands back the current budget", async () => {
    budget.version = 4;
    const res = await handler(req("PATCH", { limitMicrousd: 8_000_000, expectedVersion: 1 }));
    expect(res.status).toBe(409);
    const d = (await res.json()) as { code: string; budget: { version: number; limitMicrousd: number } };
    expect(d.code).toBe("VERSION_CONFLICT");
    expect(d.budget.limitMicrousd).toBe(5_000_000);
    expect(budget.limit).toBe(5_000_000);
  });
  it("zero is allowed and means paid AI off", async () => {
    const res = await handler(req("PATCH", { limitMicrousd: 0, expectedVersion: 1 }));
    expect(res.status).toBe(200);
    expect(budget.limit).toBe(0);
  });
  it("lowering below spent + held is accepted and simply leaves no room", async () => {
    budget.spent = 3_000_000;
    const res = await handler(req("PATCH", { limitMicrousd: 1_000_000, expectedVersion: 1 }));
    expect(res.status).toBe(200);
    expect(budget.spent).toBe(3_000_000);
  });
  it("never accepts spent or held from the browser", async () => {
    await handler(req("PATCH", { limitMicrousd: 6_000_000, expectedVersion: 1, spentMicrousd: 0, heldMicrousd: 0, spent: 0, held: 0 }));
    expect(budget.spent).toBe(0);
    const rpcBodies = (fetch as unknown as { mock: { calls: [RequestInfo, RequestInit?][] } }).mock.calls
      .filter(([u]) => String(u).includes("ai_budget_set_limit")).map(([, i]) => String(i?.body));
    for (const b of rpcBodies) expect(b).not.toMatch(/spent|held/);
  });
  it("refuses malformed input", async () => {
    for (const body of [
      {}, { limitMicrousd: -1, expectedVersion: 1 }, { limitMicrousd: 1.5, expectedVersion: 1 },
      { limitMicrousd: "5000000", expectedVersion: 1 }, { limitMicrousd: 5_000_000 },
      { limitMicrousd: 5_000_000, expectedVersion: 0 }, { limitMicrousd: 2_000_000_000, expectedVersion: 1 },
    ]) {
      expect((await handler(req("PATCH", body))).status).toBe(400);
    }
    expect(budget.limit).toBe(5_000_000);
  });
  it("without the service key nothing is saved", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect((await handler(req("PATCH", { limitMicrousd: 6_000_000, expectedVersion: 1 }))).status).toBe(503);
  });
  it("an unauthenticated caller cannot set anything", async () => {
    const r = new Request("https://app.test/api/ai-usage", { method: "PATCH", body: JSON.stringify({ limitMicrousd: 1, expectedVersion: 1 }) });
    expect((await handler(r)).status).toBe(401);
    expect(budget.calls).toEqual([]);
  });
  it("other methods stay refused", async () => {
    expect((await handler(req("DELETE"))).status).toBe(405);
  });
});
