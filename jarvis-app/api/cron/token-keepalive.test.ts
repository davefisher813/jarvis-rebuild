// THE BACKGROUND KEEP-ALIVE (Foundation Fix Spec 2). Held here: it answers only
// to its secret and refuses everything without one; it refreshes the idle
// accounts through the one lifecycle path (so it never touches a DEAD grant or
// races a live request); and what it returns is counts, never an address and
// never a token.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import handler from "./token-keepalive";
import { sealSecret } from "../../src/connections/google/tokenEnvelope";

const KEY = Buffer.alloc(32, 7).toString("base64");
const res = (body: unknown, status = 200): Response => ({ ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body }) as Response;

let posts = 0;
let listQuery = "";
let listAnswer: () => Response = () => res([]);

async function stub(tokenAnswer: () => Response = () => res({ access_token: "ya29.x", expires_in: 3599 })) {
  const enc = await sealSecret("1//stored", { current: KEY }, { userId: "u1", email: "idle@gmail.com", kind: "refresh" });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("oauth2.googleapis.com/token")) { posts++; return tokenAnswer(); }
    if (url.includes("/rest/v1/rpc/")) return res({}, 404);
    if (url.includes("/rest/v1/google_tokens")) {
      if (url.includes("state=eq.VALID")) { listQuery = url; return listAnswer(); }
      return res([{ token_enc: enc }]);
    }
    return res({}, 404);
  }));
}

const call = (init: RequestInit = {}) => handler(new Request("https://x.test/api/cron/token-keepalive", { method: "GET", ...init }));
const authed = { headers: { authorization: "Bearer cron-secret" } };

beforeEach(() => {
  posts = 0; listQuery = ""; listAnswer = () => res([]);
  vi.stubEnv("CRON_SECRET", "cron-secret");
  vi.stubEnv("VITE_SUPABASE_URL", "https://supa.test");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
  vi.stubEnv("GOOGLE_TOKEN_KEY", KEY);
  vi.stubEnv("GOOGLE_CLIENT_ID", "web.apps");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "shh");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("authorisation", () => {
  it("refuses everything when no secret is configured, so a forgotten variable cannot open it", async () => {
    vi.stubEnv("CRON_SECRET", "");
    await stub();
    expect((await call(authed)).status).toBe(501);
    expect(posts).toBe(0);
  });
  it("refuses a missing, wrong or truncated secret, and any method but GET", async () => {
    await stub();
    expect((await call()).status).toBe(401);
    expect((await call({ headers: { authorization: "Bearer nope" } })).status).toBe(401);
    expect((await call({ headers: { authorization: "Bearer cron-secre" } })).status).toBe(401);
    expect((await call({ method: "POST", ...authed })).status).toBe(405);
    expect(posts).toBe(0);
  });
});

describe("the keep-alive", () => {
  it("asks only for VALID rows that are idle, oldest first, and refreshes each through the one path", async () => {
    await stub();
    listAnswer = () => res([{ user_id: "u1", email: "idle@gmail.com", refresh_expires_at: null }]);
    const r = await call(authed);
    expect(r.status).toBe(200);
    expect(decodeURIComponent(listQuery)).toContain("state=eq.VALID");
    expect(decodeURIComponent(listQuery)).toContain("last_refresh_ok_at.is.null");
    expect(decodeURIComponent(listQuery)).toContain("last_refresh_ok_at.lt.");
    expect(decodeURIComponent(listQuery)).toContain("order=last_refresh_ok_at.asc.nullsfirst");
    expect(await r.json()).toMatchObject({ checked: 1, refreshed: 1, revoked: 0, transient: 0 });
    expect(posts).toBe(1);
  });

  it("counts a grant Google has revoked, and a transient failure, and neither stops the rest", async () => {
    let n = 0;
    await stub(() => (n++ === 0 ? res({ error: "invalid_grant" }, 400) : res({}, 503)));
    listAnswer = () => res([{ user_id: "u1", email: "idle@gmail.com", refresh_expires_at: null }, { user_id: "u1", email: "idle@gmail.com", refresh_expires_at: null }]);
    const body = await (await call(authed)).json() as Record<string, number>;
    expect(body.checked).toBe(2);
    expect(body.revoked).toBe(1);
    expect(body.refreshed).toBe(0);
  });

  it("counts a Testing-mode grant that is about to die, so the operator sees it coming", async () => {
    await stub();
    listAnswer = () => res([{ user_id: "u1", email: "idle@gmail.com", refresh_expires_at: new Date(Date.now() + 3600e3).toISOString() }]);
    expect(await (await call(authed)).json()).toMatchObject({ testingModeExpiring: 1 });
  });

  it("says so, and does nothing, when the lifecycle columns are not there yet", async () => {
    await stub();
    listAnswer = () => res({ message: "column does not exist" }, 400);
    expect(await (await call(authed)).json()).toMatchObject({ checked: 0, note: "lifecycle columns not present" });
    expect(posts).toBe(0);
  });

  it("returns counts only: never an address, a user id or a token", async () => {
    await stub();
    listAnswer = () => res([{ user_id: "u1", email: "idle@gmail.com", refresh_expires_at: null }]);
    const text = await (await call(authed)).text();
    expect(text).not.toMatch(/idle@gmail|u1|ya29|1\/\/stored/);
  });
});
