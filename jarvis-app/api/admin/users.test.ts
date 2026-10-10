import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import handler from "./users";

// UP-DEMO-01 (2026-10-10): /api/admin/users POST grew a third body shape,
// { id, wipe: true }, for resetting a demo tester's account in place without
// a new file under api/ (apiFunctionBudget.test.ts holds api/ at the 30
// files it is already at). This covers that branch: gated like every other
// one here, takes an explicit target id, and never reaches Google or the
// auth-delete endpoint wipeUserData deliberately skips.

const ADMIN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const TARGET = "33333333-3333-4333-8333-333333333333";

let calls: { url: string; method: string; body?: unknown }[];
function mockFetch(opts: { userId?: string | null; listStatus?: number; deleteStatus?: number } = {}) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });
    if (url.includes("/auth/v1/user")) {
      return opts.userId === null
        ? new Response("{}", { status: 401 })
        : new Response(JSON.stringify({ id: opts.userId ?? ADMIN }), { status: 200 });
    }
    if (url.includes("/storage/v1/object/list/")) {
      return new Response(JSON.stringify([]), { status: opts.listStatus ?? 200 });
    }
    if (url.endsWith("/storage/v1/object/user-files") && method === "DELETE") {
      return new Response("{}", { status: opts.deleteStatus ?? 200 });
    }
    return new Response(JSON.stringify({}), { status: opts.deleteStatus ?? 200 });
  }));
}

const call = (body: unknown, token: string | null = "tok") =>
  handler(new Request("https://app.example/api/admin/users", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
    body: JSON.stringify(body),
  }));

beforeEach(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "https://supa.example");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  vi.stubEnv("ADMIN_USER_IDS", ADMIN);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("POST /api/admin/users { wipe: true }", () => {
  it("wipes the named account's files and rows, and reports how many files", async () => {
    mockFetch({ listStatus: 404 });
    const res = await call({ id: TARGET, wipe: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, files: 0 });
    expect(calls.some((c) => c.url.includes("rpc/delete_owned"))).toBe(true);
  });

  it("never calls Google's revoke endpoint or deletes the auth user", async () => {
    mockFetch({ listStatus: 404 });
    await call({ id: TARGET, wipe: true });
    expect(calls.some((c) => c.url.includes("oauth2.googleapis.com"))).toBe(false);
    expect(calls.some((c) => c.method === "DELETE" && c.url.includes("/auth/v1/admin/users/"))).toBe(false);
  });

  it("rejects a malformed id without touching anything", async () => {
    mockFetch();
    const res = await call({ id: "not-a-uuid", wipe: true });
    expect(res.status).toBe(400);
    expect(calls.some((c) => c.url.includes("rpc/delete_owned") || c.url.includes("storage"))).toBe(false);
  });

  it("is admin-gated: a signed-in non-admin gets 403 and nothing runs", async () => {
    mockFetch({ userId: OTHER });
    const res = await call({ id: TARGET, wipe: true });
    expect(res.status).toBe(403);
    expect(calls.some((c) => c.url.includes("rpc/delete_owned"))).toBe(false);
  });

  it("answers 502 when a table refuses, without claiming success", async () => {
    mockFetch({ listStatus: 404, deleteStatus: 500 });
    const res = await call({ id: TARGET, wipe: true });
    expect(res.status).toBe(502);
  });

  it("leaves the aiAllowed and status branches alone when wipe is not set", async () => {
    mockFetch();
    const res = await call({ id: TARGET, aiAllowed: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, aiAllowed: true });
    expect(calls.some((c) => c.url.includes("rpc/delete_owned"))).toBe(false);
  });
});
