// The context sweep's door (slice 09 QA, 2026-10-04): a signed-in tap runs the
// service-role function once and answers with the counts; no session runs
// nothing; a failed function says so without leaking why.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import handler from "./sweep";

type Call = { url: string; method: string; auth: string };
let calls: Call[] = [];
const res = (body: unknown, status = 200): Response => ({ ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body }) as Response;

function world(o: { who?: boolean; sweep?: unknown; sweepStatus?: number } = {}) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", auth: String((init?.headers as Record<string, string> | undefined)?.Authorization ?? "") });
    if (url.includes("/auth/v1/user")) return o.who === false ? res({}, 401) : res({ id: "user-1" });
    if (url.includes("/rest/v1/rpc/context_packages_sweep")) return res(o.sweep ?? { expired: 2, purged: 1 }, o.sweepStatus ?? 200);
    return res({}, 404);
  }));
}
const post = (token?: string) => handler(new Request("https://x.test/api/context/sweep", { method: "POST", headers: token ? { authorization: "Bearer " + token } : {} }));

beforeEach(() => {
  calls = [];
  vi.stubEnv("VITE_SUPABASE_URL", "https://p.supabase.test");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  vi.stubEnv("GOOGLE_TOKEN_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("GOOGLE_CLIENT_ID", "client");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("api/context/sweep", () => {
  it("a signed-in POST runs the sweep once with the service role and returns the counts", async () => {
    world();
    const r = await post("tok");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, expired: 2, purged: 1 });
    const sweeps = calls.filter((c) => c.url.includes("context_packages_sweep"));
    expect(sweeps).toHaveLength(1);
    expect(sweeps[0]!.auth).toBe("Bearer service-key");
  });

  it("no session: 401, and the sweep never runs", async () => {
    world();
    const r = await post();
    expect(r.status).toBe(401);
    expect(calls.some((c) => c.url.includes("context_packages_sweep"))).toBe(false);
  });

  it("a rejected session: 401, and the sweep never runs", async () => {
    world({ who: false });
    expect((await post("bad")).status).toBe(401);
    expect(calls.some((c) => c.url.includes("context_packages_sweep"))).toBe(false);
  });

  it("a failed function is UNAVAILABLE with no detail; a GET is refused", async () => {
    world({ sweepStatus: 500, sweep: { message: "relation x does not exist" } });
    const r = await post("tok");
    expect(r.status).toBe(503);
    const body = JSON.stringify(await r.json());
    expect(body).not.toContain("relation");
    expect((await handler(new Request("https://x.test/api/context/sweep"))).status).toBe(405);
  });
});
