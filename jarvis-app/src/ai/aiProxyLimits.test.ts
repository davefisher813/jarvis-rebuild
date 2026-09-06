import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import handler from "../../api/ai";

// UP-PLAT-04 (2026-09-06): FAIL CLOSED, PROVEN.
//
// api/ai.ts serves an authenticated user an UNLIMITED number of Anthropic
// calls whenever SUPABASE_SERVICE_ROLE_KEY is missing: without it there is no
// counter to check, and the whole rate-limit block is skipped. The launch
// lever for that had existed since 2026-08-07 and had never been exercised by
// anything, which is the same as not having one. This runs both sides of it.
//
// Merge fix (2026-09-06): UP-LAUNCH-04 went after the same unexercised lever
// from the other end and FLIPPED ITS DEFAULT, so fail-closed is now what a
// deploy does with no env var at all and AI_REQUIRE_LIMITS=0 is the local
// development opt-out. Only one lever survives, main's, and these cases now
// pin the polarity that actually ships rather than the one this test was
// written against. DAVE_STEPS.md carries the env var.

const upstream = vi.fn();

function post(body: unknown): Request {
  return new Request("https://app.test/api/ai", {
    method: "POST",
    headers: { authorization: "Bearer user-token", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const CALL = { messages: [{ role: "user", content: "hello" }], kind: "chat" };

beforeEach(() => {
  upstream.mockReset();
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
  vi.stubEnv("VITE_SUPABASE_URL", "https://supa.test");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
  // The whole point of these cases: no service key, so nothing can count.
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  // The proxy shouts into the log on every uncapped request. Expected here.
  vi.spyOn(console, "error").mockImplementation(() => {});

  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "user-1" }), { status: 200 });
    }
    if (url.includes("/rest/v1/item")) {
      return new Response(JSON.stringify([{ data: { ai: { level: "everything" } } }]), { status: 200 });
    }
    if (url.includes("/rpc/ai_try_consume")) {
      // The atomic check-and-record from migration 0013, letting this one
      // through: the point of the last case is that the CAP is what decides
      // once a key exists, not the lever.
      return new Response(JSON.stringify({ allowed: true }), { status: 200 });
    }
    if (url.includes("api.anthropic.com")) {
      upstream();
      return new Response(JSON.stringify({
        content: [{ type: "text", text: "hi" }],
        usage: { input_tokens: 10, output_tokens: 3 },
      }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("an uncapped proxy (UP-PLAT-04)", () => {
  it("by default, a missing service key refuses instead of serving", async () => {
    vi.stubEnv("AI_REQUIRE_LIMITS", "");
    const res = await handler(post(CALL));
    expect(res.status).toBe(503);
    // The load-bearing half: no money was spent proving the point.
    expect(upstream).not.toHaveBeenCalled();
    const body = (await res.json()) as { error?: string };
    // Sentence case, and it says what the user can do, not what the server
    // is missing: a stranger cannot act on an env var name.
    expect(body.error).toBe("AI is temporarily unavailable. Try again later.");
  });

  it("opted out for local development, the old behaviour stands: it serves, loudly", async () => {
    vi.stubEnv("AI_REQUIRE_LIMITS", "0");
    const res = await handler(post(CALL));
    expect(res.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line no-console
    expect(console.error).toHaveBeenCalled();
  });

  it("the lever only fires on a MISSING key: with one, the caps do the work", async () => {
    vi.stubEnv("AI_REQUIRE_LIMITS", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    const res = await handler(post(CALL));
    expect(res.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});
