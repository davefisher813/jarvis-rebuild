import { describe, it, expect, vi } from "vitest";
import { handlePush, missingEnv, ownershipToken, type FetchLike, type PushEnv } from "./proxy";

// The proxy that keeps the backend's shared secret off the phone. Every rule
// here is one Clemenza set on 2026-09-20: a missing variable is a sentence
// naming the variable and never its value; a caller must prove who they are;
// the secret rides only on the server to server hop; and a DELETE removes only
// an endpoint the same user registered.

const ENV: PushEnv = {
  JARVIS_SECRET: "test-secret-value-not-real-0123456789",
  JARVIS_BACKEND_URL: "https://backend.example/",
  SUPABASE_URL: "https://supa.example",
  SUPABASE_ANON_KEY: "anon-key",
};

function fakeFetch(routes: Record<string, (init?: { method?: string; headers?: Record<string, string>; body?: string }) => { ok: boolean; status?: number; body?: unknown }>) {
  const calls: { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const hit = Object.entries(routes).find(([k]) => url.startsWith(k));
    if (!hit) return { ok: false, status: 404, json: async () => ({}) };
    const r = hit[1](init);
    return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 500), json: async () => r.body ?? {} };
  };
  return { f, calls };
}

const req = (method: string, path = "/api/push", body?: unknown, auth = true) =>
  new Request("https://app.example" + path, {
    method,
    headers: { ...(auth ? { authorization: "Bearer jwt-abc" } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const authOk = { "https://supa.example/auth/v1/user": () => ({ ok: true, body: { id: "user-1" } }) };

describe("missing configuration is a sentence", () => {
  it("names the missing variables", () => {
    expect(missingEnv({})).toEqual(["JARVIS_SECRET", "JARVIS_BACKEND_URL"]);
    expect(missingEnv({ JARVIS_SECRET: "x", JARVIS_BACKEND_URL: " " })).toEqual(["JARVIS_BACKEND_URL"]);
    expect(missingEnv(ENV)).toEqual([]);
  });

  it("answers 503 naming the variable and never its value", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { f, calls } = fakeFetch({});
    const res = await handlePush(req("GET"), { env: { ...ENV, JARVIS_SECRET: undefined }, fetchImpl: f });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { missing: string[] };
    expect(body.missing).toEqual(["JARVIS_SECRET"]);
    expect(JSON.stringify(body)).not.toContain(ENV.JARVIS_SECRET);
    expect(calls).toHaveLength(0);
    expect(err.mock.calls.flat().join(" ")).toContain("JARVIS_SECRET");
    expect(err.mock.calls.flat().join(" ")).not.toContain(ENV.JARVIS_SECRET!);
    err.mockRestore();
  });
});

describe("the key", () => {
  it("is fetched from the backend at runtime and needs no caller identity", async () => {
    const { f, calls } = fakeFetch({ "https://backend.example/api/push/vapid-key": () => ({ ok: true, body: { publicKey: "BPUBLIC" } }) });
    const res = await handlePush(req("GET", "/api/push", undefined, false), { env: ENV, fetchImpl: f });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ publicKey: "BPUBLIC" });
    // The backend origin and the secret never appear in the answer.
    expect(calls[0]!.url).toBe("https://backend.example/api/push/vapid-key");
  });
});

describe("subscribe", () => {
  it("refuses a caller with no valid session", async () => {
    const { f, calls } = fakeFetch({ "https://supa.example/auth/v1/user": () => ({ ok: false, status: 401 }) });
    const res = await handlePush(req("POST", "/api/push", { subscription: { endpoint: "https://push.example/e1" } }), { env: ENV, fetchImpl: f });
    expect(res.status).toBe(401);
    expect(calls.some((c) => c.url.includes("backend.example"))).toBe(false);
  });

  it("forwards with the secret header and answers an ownership token", async () => {
    const { f, calls } = fakeFetch({ ...authOk, "https://backend.example/api/push/subscribe": () => ({ ok: true, body: { ok: true } }) });
    const res = await handlePush(req("POST", "/api/push", { subscription: { endpoint: "https://push.example/e1", keys: {} } }), { env: ENV, fetchImpl: f });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; token: string };
    expect(body.ok).toBe(true);
    expect(body.token).toBe(await ownershipToken(ENV.JARVIS_SECRET!, "user-1", "https://push.example/e1"));
    const fwd = calls.find((c) => c.url.endsWith("/api/push/subscribe"))!;
    expect(fwd.init?.headers?.["x-jarvis-secret"]).toBe(ENV.JARVIS_SECRET);
    // The token is not the secret and does not contain it.
    expect(body.token).not.toContain(ENV.JARVIS_SECRET);
    expect(body.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a subscription without an endpoint before touching the backend", async () => {
    const { f, calls } = fakeFetch({ ...authOk });
    const res = await handlePush(req("POST", "/api/push", { subscription: {} }), { env: ENV, fetchImpl: f });
    expect(res.status).toBe(400);
    expect(calls.some((c) => c.url.includes("backend.example"))).toBe(false);
  });
});

describe("unsubscribe removes only what the caller owns", () => {
  it("refuses a token minted for another user or endpoint, and forwards nothing", async () => {
    const { f, calls } = fakeFetch({ ...authOk, "https://backend.example/api/push/subscribe": () => ({ ok: true }) });
    const other = await ownershipToken(ENV.JARVIS_SECRET!, "user-2", "https://push.example/e1");
    const res = await handlePush(req("DELETE", "/api/push", { endpoint: "https://push.example/e1", token: other }), { env: ENV, fetchImpl: f });
    expect(res.status).toBe(403);
    expect(calls.some((c) => c.url.includes("backend.example"))).toBe(false);
    const wrongEndpoint = await ownershipToken(ENV.JARVIS_SECRET!, "user-1", "https://push.example/e2");
    const res2 = await handlePush(req("DELETE", "/api/push", { endpoint: "https://push.example/e1", token: wrongEndpoint }), { env: ENV, fetchImpl: f });
    expect(res2.status).toBe(403);
  });

  it("forwards a DELETE that carries the right token", async () => {
    const { f, calls } = fakeFetch({ ...authOk, "https://backend.example/api/push/subscribe": () => ({ ok: true }) });
    const mine = await ownershipToken(ENV.JARVIS_SECRET!, "user-1", "https://push.example/e1");
    const res = await handlePush(req("DELETE", "/api/push", { endpoint: "https://push.example/e1", token: mine }), { env: ENV, fetchImpl: f });
    expect(res.status).toBe(200);
    const fwd = calls.find((c) => c.url.endsWith("/api/push/subscribe") && c.init?.method === "DELETE")!;
    expect(fwd).toBeTruthy();
    expect(fwd.init?.headers?.["x-jarvis-secret"]).toBe(ENV.JARVIS_SECRET);
  });
});

describe("the test alert", () => {
  it("needs a session and forwards to the backend's test route", async () => {
    const { f, calls } = fakeFetch({ ...authOk, "https://backend.example/api/push/test": () => ({ ok: true }) });
    const res = await handlePush(req("POST", "/api/push?test=1"), { env: ENV, fetchImpl: f });
    expect(res.status).toBe(200);
    expect(calls.some((c) => c.url.endsWith("/api/push/test"))).toBe(true);
    const res2 = await handlePush(req("POST", "/api/push?test=1", undefined, false), { env: ENV, fetchImpl: f });
    expect(res2.status).toBe(401);
  });
});
