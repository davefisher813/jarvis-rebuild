import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  handleClientError, derivePlatform, firstFrame, fingerprintOf, toRow, resetThrottle,
  MAX_BODY, PER_MIN, LIMITS, RETENTION_DAYS, type StoreFetch, type ReceiverEnv,
} from "./receiver";

// The crash receiver (2026-10-05). Everything it did before the table existed
// is pinned here as well as the new storage, because a receiver that stores
// well and no longer throttles is worse than the log line it replaced.
// The rule under every test: a failed insert never changes the answer.

const ENV: ReceiverEnv = { SUPABASE_URL: "https://supa.example/", SUPABASE_SERVICE_ROLE_KEY: "service-key-not-real" };
const NOW = Date.parse("2026-10-05T12:00:00.000Z");

interface Call { url: string; method: string; headers: Record<string, string>; body?: string }

function harness(opts: { ok?: boolean; status?: number; reject?: boolean; random?: number; env?: ReceiverEnv } = {}) {
  const calls: Call[] = [];
  const fetchImpl: StoreFetch = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    if (opts.reject) throw new TypeError("network down");
    return { ok: opts.ok ?? true, status: opts.status ?? (opts.ok === false ? 500 : 201) };
  };
  const deps = { env: opts.env ?? ENV, fetchImpl, now: () => NOW, random: () => opts.random ?? 0.5 };
  const inserts = () => calls.filter((c) => c.method === "POST");
  const deletes = () => calls.filter((c) => c.method === "DELETE");
  const row = (i = 0) => JSON.parse(inserts()[i]!.body!) as Record<string, unknown>;
  return { calls, deps, inserts, deletes, row };
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://app.example/api/client-error", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const REPORT = {
  name: "TypeError", message: "x is undefined", build: "abc1234", path: "/today", platform: "ios",
  stack: "TypeError: x is undefined\n    at render (https://app.example/a.js:1:2)\n    at run (https://app.example/a.js:3:4)",
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  context: { kind: "window.error" }, at: "2026-10-05T11:59:00.000Z",
};

let err: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  resetThrottle();
  err = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe("what it did before, still does", () => {
  it("answers a preflight 204 with the CORS headers the phone needs, and stores nothing", async () => {
    const h = harness();
    const res = await handleClientError(new Request("https://app.example/api/client-error", { method: "OPTIONS" }), h.deps);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(h.calls).toHaveLength(0);
  });

  it("refuses other methods with 405", async () => {
    const h = harness();
    const res = await handleClientError(new Request("https://app.example/api/client-error", { method: "GET" }), h.deps);
    expect(res.status).toBe(405);
    expect(h.calls).toHaveLength(0);
  });

  it("accepts a JSON object with 204 and CORS", async () => {
    const res = await handleClientError(post(REPORT), harness().deps);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("refuses an empty body and one over 16 KB with 413, and stores neither", async () => {
    const h = harness();
    expect((await handleClientError(post(""), h.deps)).status).toBe(413);
    expect((await handleClientError(post("x".repeat(MAX_BODY + 1)), h.deps)).status).toBe(413);
    expect((await handleClientError(post(JSON.stringify({ message: "x".repeat(MAX_BODY - 20) })), h.deps)).status).toBe(204);
    expect(h.inserts()).toHaveLength(1);
  });

  it("refuses anything that is not a JSON object with 400", async () => {
    const h = harness();
    for (const body of ["not json", "[1,2]", "null", "42", '"str"']) {
      expect((await handleClientError(post(body), h.deps)).status).toBe(400);
    }
    expect(h.calls).toHaveLength(0);
  });

  it("throttles one IP at 60 a minute with 429, per IP, and forgets after a minute", async () => {
    const h = harness();
    for (let i = 0; i < PER_MIN; i++) {
      expect((await handleClientError(post(REPORT, { "x-forwarded-for": "9.9.9.9, 1.1.1.1" }), h.deps)).status).toBe(204);
    }
    expect((await handleClientError(post(REPORT, { "x-forwarded-for": "9.9.9.9" }), h.deps)).status).toBe(429);
    expect((await handleClientError(post(REPORT, { "x-forwarded-for": "8.8.8.8" }), h.deps)).status).toBe(204);
    // A throttled report is neither logged nor stored.
    expect(h.inserts()).toHaveLength(PER_MIN + 1);
    const later = { ...h.deps, now: () => NOW + 61_000 };
    expect((await handleClientError(post(REPORT, { "x-forwarded-for": "9.9.9.9" }), later)).status).toBe(204);
  });

  it("still writes the one-line log with the prefix, build, name and the report as sent", async () => {
    await handleClientError(post(REPORT), harness().deps);
    const line = err.mock.calls.find((c: unknown[]) => c[0] === "[jarvis-client-error]")!;
    expect(line[1]).toBe("abc1234");
    expect(line[2]).toBe("TypeError");
    expect(JSON.parse(String(line[3]))).toEqual(REPORT);
  });

  it("never stores or logs the IP", async () => {
    const h = harness();
    await handleClientError(post(REPORT, { "x-forwarded-for": "203.0.113.77" }), h.deps);
    expect(h.inserts()[0]!.body).not.toContain("203.0.113.77");
    expect(JSON.stringify(err.mock.calls)).not.toContain("203.0.113.77");
  });
});

describe("the insert", () => {
  it("POSTs one row to the REST endpoint with the service key and return=minimal", async () => {
    const h = harness();
    await handleClientError(post(REPORT), h.deps);
    expect(h.inserts()).toHaveLength(1);
    const c = h.inserts()[0]!;
    expect(c.url).toBe("https://supa.example/rest/v1/client_error");
    expect(c.headers.apikey).toBe("service-key-not-real");
    expect(c.headers.authorization).toBe("Bearer service-key-not-real");
    expect(c.headers.prefer).toBe("return=minimal");
    expect(c.headers["content-type"]).toBe("application/json");
  });

  it("stores the columns the table has, and no more", async () => {
    const h = harness();
    await handleClientError(post(REPORT), h.deps);
    expect(h.row()).toEqual({
      build: "abc1234", platform: "ios", name: "TypeError", message: "x is undefined",
      stack: REPORT.stack, path: "/today", user_agent: REPORT.userAgent,
      context: { kind: "window.error" },
      fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("does not store the report's own timestamp or any unknown field", async () => {
    const h = harness();
    await handleClientError(post({ ...REPORT, at: "x", userId: "u-1", secret: "s" }), h.deps);
    expect(Object.keys(h.row())).not.toContain("at");
    expect(h.inserts()[0]!.body).not.toContain("u-1");
  });

  it("stores a sparse report with its defaults", async () => {
    const h = harness();
    await handleClientError(post({ message: "boom" }), h.deps);
    expect(h.row()).toMatchObject({ name: "Error", message: "boom", platform: "other" });
  });

  it("does not store a report that says nothing at all, but still answers 204 and logs it", async () => {
    const h = harness();
    const res = await handleClientError(post({ build: "b", foo: 1 }), h.deps);
    expect(res.status).toBe(204);
    expect(h.calls).toHaveLength(0);
    expect(err.mock.calls.some((c: unknown[]) => c[0] === "[jarvis-client-error]")).toBe(true);
  });
});

describe("a failed insert never changes the answer", () => {
  it("answers 204 and logs when the database refuses", async () => {
    const h = harness({ ok: false, status: 503 });
    const res = await handleClientError(post(REPORT), h.deps);
    expect(res.status).toBe(204);
    expect(err.mock.calls.flat().join(" ")).toContain("not stored: the database answered 503");
  });

  it("answers 204 and logs when the database cannot be reached", async () => {
    const h = harness({ reject: true });
    const res = await handleClientError(post(REPORT), h.deps);
    expect(res.status).toBe(204);
    expect(err.mock.calls.flat().join(" ")).toContain("could not be reached");
  });

  it("answers 204 and names the missing variable, never a value, when unconfigured", async () => {
    for (const [env, name] of [
      [{ SUPABASE_URL: "https://supa.example" }, "SUPABASE_SERVICE_ROLE_KEY"],
      [{ SUPABASE_SERVICE_ROLE_KEY: "service-key-not-real" }, "SUPABASE_URL"],
      [{}, "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY"],
      [{ SUPABASE_URL: " ", SUPABASE_SERVICE_ROLE_KEY: " " }, "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY"],
    ] as [ReceiverEnv, string][]) {
      err.mockClear();
      const h = harness({ env });
      const res = await handleClientError(post(REPORT), h.deps);
      expect(res.status).toBe(204);
      expect(h.calls).toHaveLength(0);
      const logged = err.mock.calls.flat().join(" ");
      expect(logged).toContain("not stored: missing " + name);
      expect(logged).not.toContain("service-key-not-real");
    }
  });

  it("answers 204 and logs when building the row itself fails", async () => {
    const h = harness();
    const spy = vi.spyOn(crypto.subtle, "digest").mockRejectedValue(new Error("no crypto"));
    const res = await handleClientError(post(REPORT), h.deps);
    spy.mockRestore();
    expect(res.status).toBe(204);
    expect(h.calls).toHaveLength(0);
    expect(err.mock.calls.flat().join(" ")).toContain("not stored: unexpected failure");
  });

  it("never puts the service key in a log line when the insert fails", async () => {
    const h = harness({ reject: true });
    await handleClientError(post(REPORT), h.deps);
    expect(JSON.stringify(err.mock.calls)).not.toContain("service-key-not-real");
  });
});

describe("retention", () => {
  it("about one request in 200 also deletes rows older than 30 days", async () => {
    const h = harness({ random: 0.001 });
    await handleClientError(post(REPORT), h.deps);
    expect(h.deletes()).toHaveLength(1);
    const cutoff = new Date(NOW - RETENTION_DAYS * 86_400_000).toISOString();
    expect(h.deletes()[0]!.url).toBe("https://supa.example/rest/v1/client_error?created_at=lt." + encodeURIComponent(cutoff));
    expect(h.deletes()[0]!.headers.authorization).toBe("Bearer service-key-not-real");
    expect(cutoff).toBe("2026-09-05T12:00:00.000Z");
  });

  it("does not sweep on an ordinary request, including the edge of the odds", async () => {
    for (const random of [0.5, 0.005]) {
      const h = harness({ random });
      await handleClientError(post(REPORT), h.deps);
      expect(h.deletes()).toHaveLength(0);
    }
  });

  it("a failed sweep is logged and the answer is still 204", async () => {
    const calls: string[] = [];
    const deps = {
      env: ENV, now: () => NOW, random: () => 0,
      fetchImpl: (async (_u: string, init: { method: string }) => {
        calls.push(init.method);
        if (init.method === "DELETE") throw new Error("down");
        return { ok: true, status: 201 };
      }) as StoreFetch,
    };
    const res = await handleClientError(post(REPORT), deps);
    expect(res.status).toBe(204);
    expect(calls).toEqual(["POST", "DELETE"]);
    expect(err.mock.calls.flat().join(" ")).toContain("sweep failed");
  });

  it("does not sweep when the insert itself could not be made", async () => {
    const h = harness({ reject: true, random: 0 });
    await handleClientError(post(REPORT), h.deps);
    expect(h.deletes()).toHaveLength(0);
  });
});

describe("validate and clamp", () => {
  it("clamps every text field to its column ceiling", async () => {
    const h = harness();
    const big = (n: number) => "a".repeat(n + 500);
    await handleClientError(post({
      name: big(LIMITS.name), message: big(LIMITS.message), stack: big(LIMITS.stack),
      path: big(LIMITS.path), userAgent: big(LIMITS.userAgent), build: big(LIMITS.build),
    }), h.deps);
    const r = h.row() as Record<string, string>;
    expect(r.name).toHaveLength(LIMITS.name);
    expect(r.message).toHaveLength(LIMITS.message);
    expect(r.stack).toHaveLength(LIMITS.stack);
    expect(r.path).toHaveLength(LIMITS.path);
    expect(r.user_agent).toHaveLength(LIMITS.userAgent);
    expect(r.build).toHaveLength(LIMITS.build);
  });

  it("ignores a field of the wrong type instead of storing it", async () => {
    const h = harness();
    await handleClientError(post({ name: 5, message: { a: 1 }, stack: ["x"], build: 7, path: null, userAgent: false, context: "str", platform: 3 }), h.deps);
    // Nothing usable: not stored. The same report with one real message is.
    expect(h.inserts()).toHaveLength(0);
    await handleClientError(post({ name: 5, message: "real", stack: ["x"], build: 7, path: null, userAgent: false, context: "str", platform: 3 }), h.deps);
    expect(h.row()).toEqual({ name: "Error", message: "real", platform: "other", fingerprint: expect.any(String) });
  });

  it("strips NUL characters and lone surrogates, which Postgres would refuse", async () => {
    const h = harness();
    await handleClientError(post({ name: "E\u0000rror", message: "bad \u0000 and \ud800 end", context: { k: "v\u0000w", "k\u0000x": 1 } }), h.deps);
    const body = h.inserts()[0]!.body!;
    expect(body).not.toContain("\\u0000");
    expect(body).not.toMatch(/\\ud800/i);
    expect(h.row()).toMatchObject({ name: "Error", context: { k: "vw", kx: 1 } });
  });

  it("keeps the context only when it is an object, and cleans it", async () => {
    const h = harness();
    await handleClientError(post({ message: "m", context: [1, 2] }), h.deps);
    expect(h.row()).not.toHaveProperty("context");
    await handleClientError(post({ message: "m", context: { a: { b: { c: { d: { e: "deep" } } } }, long: "x".repeat(900), n: 1, ok: true, nil: null } }), h.deps);
    const ctx = h.row(1).context as Record<string, unknown>;
    expect(ctx.n).toBe(1);
    expect(ctx.ok).toBe(true);
    expect(ctx.nil).toBeNull();
    expect((ctx.long as string).length).toBe(500);
    expect(JSON.stringify(ctx.a)).not.toContain("deep");
  });

  it("replaces an oversized context with a marker and a prefix", async () => {
    const h = harness();
    const context: Record<string, string> = {};
    for (let i = 0; i < 40; i++) context["key" + i] = "v".repeat(300);
    await handleClientError(post({ message: "m", context }), h.deps);
    const ctx = h.row().context as { truncated: string };
    expect(Object.keys(ctx)).toEqual(["truncated"]);
    expect(ctx.truncated.length).toBeLessThanOrEqual(1000);
  });
});

describe("platform", () => {
  it("takes what the client reported, with android and the unknown as other", () => {
    expect(derivePlatform("ios", undefined)).toBe("ios");
    expect(derivePlatform("web", "iPhone Mobile/15E148")).toBe("web");
    expect(derivePlatform("IOS", undefined)).toBe("ios");
    expect(derivePlatform("android", "x")).toBe("other");
    expect(derivePlatform("plan9", "x")).toBe("other");
  });

  it("calls a Capacitor webview ios, from the user agent when nothing was reported", () => {
    expect(derivePlatform(undefined, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148")).toBe("ios");
    expect(derivePlatform(undefined, "Mozilla/5.0 (iPad) AppleWebKit Capacitor")).toBe("ios");
    expect(derivePlatform(undefined, "JARVIS Capacitor/8")).toBe("ios");
  });

  it("calls Safari on an iPhone, and any other browser, web, and a missing agent other", () => {
    expect(derivePlatform(undefined, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe("web");
    expect(derivePlatform(undefined, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126 Safari/537.36")).toBe("web");
    expect(derivePlatform(undefined, undefined)).toBe("other");
    expect(derivePlatform(undefined, "")).toBe("other");
    expect(derivePlatform("", "")).toBe("other");
  });

  it("is stored from the user agent when the report has no platform", async () => {
    const h = harness();
    const { platform: _p, ...noPlatform } = REPORT;
    await handleClientError(post(noPlatform), h.deps);
    expect(h.row().platform).toBe("ios");
  });
});

describe("fingerprint", () => {
  it("is 64 hex characters, stable, and the sha-256 of name, message and first frame", async () => {
    const fp = await fingerprintOf("TypeError", "x is undefined", REPORT.stack);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(await fingerprintOf("TypeError", "x is undefined", REPORT.stack)).toBe(fp);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("TypeError\nx is undefined\nat render (https://app.example/a.js:1:2)"));
    expect(fp).toBe(Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join(""));
  });

  it("differs when the name, the message or the first frame differs", async () => {
    const base = await fingerprintOf("TypeError", "m", "TypeError: m\n    at a (u:1:1)");
    expect(await fingerprintOf("RangeError", "m", "TypeError: m\n    at a (u:1:1)")).not.toBe(base);
    expect(await fingerprintOf("TypeError", "n", "TypeError: m\n    at a (u:1:1)")).not.toBe(base);
    expect(await fingerprintOf("TypeError", "m", "TypeError: m\n    at b (u:1:1)")).not.toBe(base);
  });

  it("ignores everything after the first frame, so a deeper stack does not split a group", async () => {
    const one = await fingerprintOf("E", "m", "E: m\n    at a (u:1:1)\n    at b (u:2:2)");
    const two = await fingerprintOf("E", "m", "E: m\n    at a (u:1:1)\n    at z (u:9:9)\n    at y (u:8:8)");
    expect(one).toBe(two);
  });

  it("finds the first frame in a V8 stack, a Safari stack, and neither", () => {
    expect(firstFrame("Error: boom\n    at f (u:1:2)\n    at g (u:3:4)")).toBe("at f (u:1:2)");
    expect(firstFrame("f@https://app.example/a.js:10:20\ng@https://app.example/a.js:30:40")).toBe("f@https://app.example/a.js:10:20");
    // A message that contains an @ is not a frame.
    expect(firstFrame("Error: mail me@x.com\n    at f (u:1:2)")).toBe("at f (u:1:2)");
    expect(firstFrame("Error: only a header")).toBe("");
    expect(firstFrame(undefined)).toBe("");
  });

  it("is the same for the same bug from two phones and two timestamps", async () => {
    const h = harness();
    await handleClientError(post({ ...REPORT, at: "2026-10-05T01:00:00Z", path: "/a" }), h.deps);
    await handleClientError(post({ ...REPORT, at: "2026-10-05T02:00:00Z", path: "/b", userAgent: "other phone" }), h.deps);
    expect(h.row(0).fingerprint).toBe(h.row(1).fingerprint);
  });

  it("is computed on the clamped fields, so an over-long message cannot split a group", async () => {
    const long = "m".repeat(LIMITS.message);
    const a = await toRow({ name: "E", message: long + "AAA" });
    const b = await toRow({ name: "E", message: long + "BBB" });
    expect(a!.fingerprint).toBe(b!.fingerprint);
  });
});
