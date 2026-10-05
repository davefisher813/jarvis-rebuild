import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import handler from "./errors";

// 2026-10-05: /api/admin/errors is gated exactly like /api/admin/users: a
// caller must be signed in AND be on the server-side allowlist, and a missing
// variable fails closed. The reads go through one fetch, mocked here by URL.

const ADMIN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

let reads: string[];
function mockFetch(opts: { userId?: string | null; rows?: unknown[]; restOk?: boolean } = {}) {
  reads = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
    reads.push(url);
    if (url.includes("/auth/v1/user")) {
      return opts.userId === null
        ? new Response("{}", { status: 401 })
        : new Response(JSON.stringify({ id: opts.userId ?? ADMIN }), { status: 200 });
    }
    expect(init?.headers?.apikey).toBe("service-key");
    return opts.restOk === false ? new Response("no", { status: 404 }) : new Response(JSON.stringify(opts.rows ?? []), { status: 200 });
  }));
}

const call = (method = "GET", token: string | null = "tok") =>
  handler(new Request("https://app.example/api/admin/errors", { method, headers: token ? { authorization: "Bearer " + token } : {} }));

beforeEach(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "https://supa.example");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  vi.stubEnv("ADMIN_USER_IDS", ADMIN);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("the gate", () => {
  it("answers 401 with no token and reads nothing", async () => {
    mockFetch();
    expect((await call("GET", null)).status).toBe(401);
    expect(reads).toEqual([]);
  });

  it("answers 401 when the token is not a real session", async () => {
    mockFetch({ userId: null });
    expect((await call()).status).toBe(401);
    expect(reads.some((u) => u.includes("client_error"))).toBe(false);
  });

  it("answers 403 to a signed-in user who is not on the allowlist, and reads nothing", async () => {
    mockFetch({ userId: OTHER });
    expect((await call()).status).toBe(403);
    expect(reads.some((u) => u.includes("client_error"))).toBe(false);
  });

  it("fails closed with 403 when the allowlist is unset", async () => {
    vi.stubEnv("ADMIN_USER_IDS", "");
    mockFetch();
    expect((await call()).status).toBe(403);
    expect(reads).toEqual([]);
  });

  it("answers 500 when the service key is missing", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    mockFetch();
    expect((await call()).status).toBe(500);
  });
});

describe("the read", () => {
  const rows = [
    { created_at: "2026-10-05T10:00:00Z", fingerprint: "a", name: "TypeError", message: "m", build: "b1", platform: "ios" },
    { created_at: "2026-10-05T09:00:00Z", fingerprint: "a", name: "TypeError", message: "m", build: "b1", platform: "ios" },
    { created_at: "2026-10-04T09:00:00Z", fingerprint: "b", name: "RangeError", message: "r", build: "b0", platform: "web" },
  ];

  it("asks for the newest 200 rows, without the stack or context", async () => {
    mockFetch({ rows });
    await call();
    const url = reads.find((u) => u.includes("client_error"))!;
    expect(url).toContain("/rest/v1/client_error?");
    expect(url).toContain("order=created_at.desc");
    expect(url).toContain("limit=200");
    expect(url).not.toContain("stack");
    expect(url).not.toContain("context");
  });

  it("returns the rows grouped by fingerprint, most often first", async () => {
    mockFetch({ rows });
    const res = await call();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { errors: { fingerprint: string; count: number; firstSeen: string; lastSeen: string; platform: string }[]; window: number; rows: number };
    expect(body.errors.map((g) => [g.fingerprint, g.count])).toEqual([["a", 2], ["b", 1]]);
    expect(body.errors[0]).toMatchObject({ firstSeen: "2026-10-05T09:00:00Z", lastSeen: "2026-10-05T10:00:00Z", platform: "ios" });
    expect(body).toMatchObject({ window: 200, rows: 3 });
  });

  it("answers 502 when the table cannot be read (migration not applied)", async () => {
    mockFetch({ restOk: false });
    expect((await call()).status).toBe(502);
  });

  it("is read only: other methods get 405", async () => {
    mockFetch();
    for (const m of ["POST", "PUT", "DELETE"]) expect((await call(m)).status).toBe(405);
    expect(reads.some((u) => u.includes("client_error"))).toBe(false);
  });
});
