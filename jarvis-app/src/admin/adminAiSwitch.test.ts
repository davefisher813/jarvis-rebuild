import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import handler from "../../api/admin/users";
import { mapUsers } from "./adminCompute";
import { createAdminApi } from "./AdminService";

// THE ADMIN SWITCH FOR AI, admin side (Dave 2026-09-30). Only an account on the
// server-side allowlist can write it, it is written to app_metadata with the
// service key (never to the profile the user can edit), and it touches nothing
// else stored there.

const ADMIN = "11111111-1111-1111-1111-111111111111";
const TESTER = "22222222-2222-2222-2222-222222222222";
let caller = ADMIN;
const puts: { url: string; body: unknown; auth: string | null }[] = [];

function post(body: unknown, who = "admin-token"): Request {
  return new Request("https://app.test/api/admin/users", {
    method: "POST",
    headers: { authorization: `Bearer ${who}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  caller = ADMIN;
  puts.length = 0;
  vi.stubEnv("VITE_SUPABASE_URL", "https://supa.test");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  vi.stubEnv("ADMIN_USER_IDS", ADMIN);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/auth/v1/user") && !url.includes("/admin/")) return new Response(JSON.stringify({ id: caller }), { status: 200 });
    if (url.includes("/auth/v1/admin/users/") && init?.method === "PUT") {
      puts.push({ url, body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).Authorization ?? null });
      return new Response("{}", { status: 200 });
    }
    if (url.includes("/auth/v1/admin/users?")) {
      return new Response(JSON.stringify({ users: [
        { id: ADMIN, email: "dave@x.test", app_metadata: {} },
        { id: TESTER, email: "t@x.test", app_metadata: { ai_allowed: false } },
      ] }), { status: 200 });
    }
    if (url.includes("/rest/v1/item")) return new Response("[]", { status: 200 });
    return new Response("{}", { status: 200 });
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("POST /api/admin/users { id, aiAllowed }", () => {
  it("turns AI off for one account by writing ai_allowed false to app_metadata with the service key", async () => {
    const res = await handler(post({ id: TESTER, aiAllowed: false }));
    expect(res.status).toBe(200);
    expect(puts).toHaveLength(1);
    expect(puts[0]!.url).toBe(`https://supa.test/auth/v1/admin/users/${TESTER}`);
    expect(puts[0]!.body).toEqual({ app_metadata: { ai_allowed: false } });
    expect(puts[0]!.auth).toBe("Bearer service-key");
  });

  it("turns it back on", async () => {
    const res = await handler(post({ id: TESTER, aiAllowed: true }));
    expect(res.status).toBe(200);
    expect(puts[0]!.body).toEqual({ app_metadata: { ai_allowed: true } });
  });

  it("a signed-in user who is not on the allowlist cannot write it, even to their own account", async () => {
    caller = TESTER;
    const res = await handler(post({ id: TESTER, aiAllowed: true }, "tester-token"));
    expect(res.status).toBe(403);
    expect(puts).toHaveLength(0);
  });

  it("no session is refused", async () => {
    const res = await handler(new Request("https://app.test/api/admin/users", { method: "POST", body: JSON.stringify({ id: TESTER, aiAllowed: false }) }));
    expect(res.status).toBe(401);
    expect(puts).toHaveLength(0);
  });

  it("rejects a malformed request: a non-boolean flag, a non-UUID id, or nothing to do", async () => {
    for (const body of [{ id: TESTER, aiAllowed: "false" }, { id: TESTER, aiAllowed: 0 }, { id: "../../x", aiAllowed: false }, { id: "u_1", aiAllowed: false }, { aiAllowed: false }, { id: TESTER }]) {
      const res = await handler(post(body));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(puts).toHaveLength(0);
  });

  it("the enable/disable path for the account itself still works and is not confused with the AI flag", async () => {
    const res = await handler(post({ id: TESTER, status: "disabled" }));
    expect(res.status).toBe(200);
    expect(puts[0]!.body).toEqual({ ban_duration: "87600h" });
  });
});

describe("GET /api/admin/users reports the flag", () => {
  it("lists aiAllowed per account: false only where the admin turned it off", async () => {
    const res = await handler(new Request("https://app.test/api/admin/users", { headers: { authorization: "Bearer admin-token" } }));
    const j = (await res.json()) as { users: { id: string; aiAllowed: boolean }[] };
    expect(j.users.find((u) => u.id === ADMIN)!.aiAllowed).toBe(true);
    expect(j.users.find((u) => u.id === TESTER)!.aiAllowed).toBe(false);
  });
});

describe("mapUsers and the client", () => {
  it("an account with no app_metadata is allowed (the signup default is unchanged)", () => {
    expect(mapUsers([{ id: "a" }, { id: "b", app_metadata: null }, { id: "c", app_metadata: { ai_allowed: true } }], []).map((u) => u.aiAllowed)).toEqual([true, true, true]);
    expect(mapUsers([{ id: "d", app_metadata: { ai_allowed: false } }], [])[0]!.aiAllowed).toBe(false);
  });

  it("the client posts the flag to the same endpoint with the admin's token", async () => {
    const calls: { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }[] = [];
    const api = createAdminApi("tok", true, async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({}) }; });
    await api.setUserAiAllowed(TESTER, false);
    expect(calls[0]!.init!.method).toBe("POST");
    expect(calls[0]!.init!.headers!.Authorization).toBe("Bearer tok");
    expect(JSON.parse(calls[0]!.init!.body!)).toEqual({ id: TESTER, aiAllowed: false });
  });
});
