import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import handler from "../../api/ai";
import usageHandler from "../../api/ai-usage";
import { FakeBudget } from "./fakeBudgetRpc";
import { ADMIN_AI_CODE, ADMIN_AI_MESSAGE, adminAiAllowed } from "./aiGate";

// THE ADMIN SWITCH FOR AI (Dave 2026-09-30, demo week). An account's own user
// controls everything in their profile, including the AI level, so the profile
// cannot be where "the admin said no" lives. The flag is `ai_allowed` in the
// account's Supabase app_metadata, which only the service key can write. The
// proxy reads it on the call that already verifies the token, so it costs no
// extra lookup, and it is checked before the profile, the counters, the budget
// or the model: a blocked account reaches none of them.

const upstream = vi.fn();
const touched: string[] = [];
let appMetadata: unknown;
let profileAi: unknown;

function post(body: unknown): Request {
  return new Request("https://app.test/api/ai", {
    method: "POST",
    headers: { authorization: "Bearer user-token", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const CALL = { messages: [{ role: "user", content: "draft a reply" }], kind: "draft" };

beforeEach(() => {
  upstream.mockReset();
  touched.length = 0;
  appMetadata = undefined;
  profileAi = { level: "everything" };
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
  vi.stubEnv("VITE_SUPABASE_URL", "https://supa.test");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  const budget = new FakeBudget();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "user-1", ...(appMetadata === undefined ? {} : { app_metadata: appMetadata }) }), { status: 200 });
    }
    touched.push(url);
    if (url.includes("/rest/v1/item")) return new Response(JSON.stringify([{ data: { ai: profileAi } }]), { status: 200 });
    if (url.includes("/rpc/ai_budget")) return budget.handle(url, JSON.parse(String(init?.body ?? "{}")))!;
    if (url.includes("/rpc/ai_try_consume")) return new Response(JSON.stringify({ allowed: true }), { status: 200 });
    if (url.includes("api.anthropic.com")) {
      upstream();
      return new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }] }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("adminAiAllowed: only an explicit false blocks", () => {
  it("absent, empty, true and junk all leave AI on, so every existing and new account is unchanged", () => {
    for (const v of [undefined, null, {}, { ai_allowed: true }, { ai_allowed: "no" }, { ai_allowed: 0 }, "x", 5]) {
      expect(adminAiAllowed(v), JSON.stringify(v)).toBe(true);
    }
  });
  it("false blocks", () => {
    expect(adminAiAllowed({ ai_allowed: false })).toBe(false);
  });
});

describe("the proxy refuses a blocked account, whatever the client says", () => {
  it("a blocked account is refused with the admin code and nothing reaches the model", async () => {
    appMetadata = { ai_allowed: false };
    const res = await handler(post(CALL));
    expect(res.status).toBe(403);
    const j = (await res.json()) as { error?: string; code?: string };
    expect(j.code).toBe(ADMIN_AI_CODE);
    expect(j.error).toBe(ADMIN_AI_MESSAGE);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("it is refused BEFORE the profile, the counters and the budget are touched", async () => {
    appMetadata = { ai_allowed: false };
    await handler(post(CALL));
    expect(touched).toEqual([]);
  });

  it("the account's own profile cannot override it: a stale or hacked client that saved Everything is still refused", async () => {
    appMetadata = { ai_allowed: false };
    profileAi = { level: "everything", pins: { emailDrafts: "everything", morningPlan: "everything" } };
    for (const extra of [{}, { pin: "emailDrafts" }, { pin: "morningPlan", background: true }, { tier: "write" }]) {
      const res = await handler(post({ ...CALL, ...extra }));
      expect(res.status, JSON.stringify(extra)).toBe(403);
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it("a request that tries to carry its own flag is ignored: the flag is read from the verified account", async () => {
    appMetadata = { ai_allowed: false };
    const res = await handler(post({ ...CALL, app_metadata: { ai_allowed: true }, ai_allowed: true }));
    expect(res.status).toBe(403);
  });
});

describe("the admin toggle flips behaviour both ways", () => {
  it("an account with no flag, or ai_allowed true, is served as before", async () => {
    for (const meta of [undefined, {}, { ai_allowed: true }, { provider: "email" }]) {
      appMetadata = meta;
      upstream.mockClear();
      const res = await handler(post(CALL));
      expect(res.status, JSON.stringify(meta)).toBe(200);
      expect(upstream).toHaveBeenCalledTimes(1);
    }
  });

  it("off then on then off: each flip bites on the very next request", async () => {
    appMetadata = { ai_allowed: true };
    expect((await handler(post(CALL))).status).toBe(200);
    appMetadata = { ai_allowed: false };
    expect((await handler(post(CALL))).status).toBe(403);
    appMetadata = { ai_allowed: true };
    expect((await handler(post(CALL))).status).toBe(200);
    appMetadata = { ai_allowed: false };
    expect((await handler(post(CALL))).status).toBe(403);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("the user's own AI level is untouched by the flag, so their choice is there when AI comes back", async () => {
    profileAi = { level: "request" };
    appMetadata = { ai_allowed: true };
    expect((await handler(post({ ...CALL, background: true }))).status).toBe(403); // On Request still refuses background
    expect((await handler(post(CALL))).status).toBe(200);
  });
});

describe("the status answer the app uses to explain itself", () => {
  const get = () => usageHandler(new Request("https://app.test/api/ai-usage?status=1", { headers: { authorization: "Bearer user-token" } }));

  it("says allowed unless the admin said no, and is cheap: no usage reads", async () => {
    appMetadata = undefined;
    expect(await (await get()).json()).toEqual({ allowed: true });
    appMetadata = { ai_allowed: false };
    expect(await (await get()).json()).toEqual({ allowed: false });
    appMetadata = { ai_allowed: true };
    expect(await (await get()).json()).toEqual({ allowed: true });
    expect(touched).toEqual([]);
  });

  it("needs a real session", async () => {
    const res = await usageHandler(new Request("https://app.test/api/ai-usage?status=1"));
    expect(res.status).toBe(401);
  });
});
