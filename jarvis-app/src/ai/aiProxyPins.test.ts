import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import handler from "../../api/ai";
import { AIService } from "./AIService";
import { setAIControl } from "./levelStore";

// UP-PLAT-03 (2026-09-06), A21: "proxy refuses calls above level, including
// pre-generation." A pin set to Off in AI Control was a promise only the
// CLIENT kept. The request body carried no `pin` at all and the proxy read
// only `data.ai.level`, so a stale build, a background job or a bug could
// still send that user's email to the model with the switch reading Off.
//
// Both halves are pinned here: the client sends the pin, and the server
// resolves it against the same stored profile with the same pure function.

const upstream = vi.fn();
let profileAi: unknown = { level: "everything" };

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
  profileAi = { level: "everything" };
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
  vi.stubEnv("VITE_SUPABASE_URL", "https://supa.test");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) return new Response(JSON.stringify({ id: "user-1" }), { status: 200 });
    if (url.includes("/rest/v1/item")) return new Response(JSON.stringify([{ data: { ai: profileAi } }]), { status: 200 });
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
  setAIControl(undefined);
});

describe("the proxy enforces a pin, not just the master level (UP-PLAT-03)", () => {
  it("a feature pinned Off is refused at the server, and no email reaches the model", async () => {
    profileAi = { level: "everything", pins: { emailDrafts: "off" } };
    const res = await handler(post({ ...CALL, pin: "emailDrafts" }));
    expect(res.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
    expect(((await res.json()) as { error?: string }).error).toBe("AI is turned off in Settings.");
  });

  it("the same call under a different pin still runs: this refuses one feature, not AI", async () => {
    profileAi = { level: "everything", pins: { emailDrafts: "off" } };
    const res = await handler(post({ ...CALL, pin: "morningPlan" }));
    expect(res.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("a pin set to On Request refuses background pre-generation for that feature alone", async () => {
    profileAi = { level: "everything", pins: { morningPlan: "request" } };
    const res = await handler(post({ ...CALL, pin: "morningPlan", background: true }));
    expect(res.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
    const foreground = await handler(post({ ...CALL, pin: "morningPlan" }));
    expect(foreground.status).toBe(200);
  });

  it("a made-up pin name is no pin at all, never a way around the master level", async () => {
    profileAi = { level: "off", pins: { emailDrafts: "everything" } };
    const res = await handler(post({ ...CALL, pin: "emailDraftsButNotReally" }));
    expect(res.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("no pin behaves exactly as it did before this existed: the master level decides", async () => {
    profileAi = { level: "everything", pins: { emailDrafts: "off" } };
    const res = await handler(post(CALL));
    expect(res.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});

describe("the client actually sends the pin (UP-PLAT-03)", () => {
  it("complete puts the pin in the body, which is what the proxy reads", async () => {
    let sent: Record<string, unknown> = {};
    const svc = new AIService({
      available: true,
      fetchImpl: (async (_u: unknown, init: { body?: string }) => {
        sent = JSON.parse(init.body || "{}") as Record<string, unknown>;
        return new Response(JSON.stringify({ text: "ok" }));
      }) as unknown as typeof fetch,
    });
    setAIControl({ level: "everything" });
    await svc.complete([{ role: "user", content: "hi" }], undefined, { kind: "draft", pin: "emailDrafts" });
    expect(sent.pin).toBe("emailDrafts");
  });

  it("a call with no pin sends no pin key, so the body shape is unchanged", async () => {
    let sent: Record<string, unknown> = {};
    const svc = new AIService({
      available: true,
      fetchImpl: (async (_u: unknown, init: { body?: string }) => {
        sent = JSON.parse(init.body || "{}") as Record<string, unknown>;
        return new Response(JSON.stringify({ text: "ok" }));
      }) as unknown as typeof fetch,
    });
    setAIControl({ level: "everything" });
    await svc.complete([{ role: "user", content: "hi" }], undefined, { kind: "chat" });
    expect("pin" in sent).toBe(false);
  });
});
