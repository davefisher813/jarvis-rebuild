import { describe, it, expect, vi } from "vitest";
import { handlePush, INBOX_CAP, missingEnv, ownershipToken, takenByDave, type FetchLike, type PushEnv } from "./proxy";

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

function fakeFetch(routes: Record<string, (init?: { method?: string; headers?: Record<string, string>; body?: string }) => { ok: boolean; status?: number; body?: unknown; json?: () => Promise<unknown> }>) {
  const calls: { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const hit = Object.entries(routes).find(([k]) => url.startsWith(k));
    if (!hit) return { ok: false, status: 404, json: async () => ({}) };
    const r = hit[1](init);
    return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 500), json: r.json ?? (async () => r.body ?? {}) };
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

// THE BACKEND INBOX PULL (Phase 0, PHASE0-DESIGN.md D6 item 7). The one rule that matters most: a backend
// item is deleted only once Dave has taken it. A proposed record stays where the agents can still read it.
describe("the backend inbox pull", () => {
  const ON: PushEnv = { ...ENV, FLAGS: "memory_v1,vyzn_sync_v1" };
  const ID1 = "inbox_11111111-1111-4111-8111-111111111111";
  const ID2 = "inbox_22222222-2222-4222-8222-222222222222";
  const TEXT = "Send the grant letter to the foundation";
  const item = (id: string, text = TEXT) => ({ id, kind: "task", name: text, text, prio: "High", due: "2026-10-01", status: "Open", done: false, source: "agent", consumed: false, createdAt: 1791547200000, family: "bridge", agent: "michael-corleone", notes: "" });
  const inbox = (...items: unknown[]) => ({ "https://backend.example/api/memory/tasks": (init?: { method?: string }) => init?.method === "DELETE" ? { ok: true, body: { ok: true } } : { ok: true, body: { tasks: [], inbox: items, count: 0, inboxCount: items.length } } });
  const rpc = (body: unknown, ok = true) => ({ "https://supa.example/rest/v1/rpc/records_import": () => ({ ok, status: ok ? 200 : 500, body }) });
  const result = (id: string, r: Record<string, unknown>) => ({ source_record_id: id, revision: 1, ...r });
  const deletes = (calls: { url: string; init?: { method?: string } }[]) => calls.filter((c) => c.init?.method === "DELETE").map((c) => c.url);

  it("does not exist without the flag: 404 before any identity or backend call", async () => {
    const { f, calls } = fakeFetch({ ...authOk, ...inbox(item(ID1)) });
    const res = await handlePush(req("POST", "/api/push?inbox=pull"), { env: ENV, fetchImpl: f });
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
    const other = await handlePush(req("POST", "/api/push?inbox=pull"), { env: { ...ENV, FLAGS: "memory_v1" }, fetchImpl: f });
    expect(other.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("needs a session, then reads the inbox with the secret and never shows the caller the backend origin", async () => {
    const { f, calls } = fakeFetch({ "https://supa.example/auth/v1/user": () => ({ ok: false, status: 401 }), ...inbox(item(ID1)) });
    expect((await handlePush(req("POST", "/api/push?inbox=pull"), { env: ON, fetchImpl: f })).status).toBe(401);
    expect(calls.some((c) => c.url.includes("backend.example"))).toBe(false);
  });

  it("a backend 503 writes nothing and deletes nothing", async () => {
    const { f, calls } = fakeFetch({ ...authOk, "https://backend.example/api/memory/tasks": () => ({ ok: false, status: 503, body: { error: "Family store unavailable. The write was not retried." } }), ...rpc({}) });
    const res = await handlePush(req("POST", "/api/push?inbox=pull"), { env: ON, fetchImpl: f });
    expect(res.status).toBe(502);
    expect(calls.some((c) => c.url.includes("records_import"))).toBe(false);
    expect(deletes(calls)).toEqual([]);
    const read = calls.find((c) => c.url.endsWith("/api/memory/tasks"))!;
    expect(read.init?.headers?.["x-jarvis-secret"]).toBe(ENV.JARVIS_SECRET);
  });

  it("a proposed record is handed to records_import as the person and is NOT deleted from the backend", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { f, calls } = fakeFetch({ ...authOk, ...inbox(item(ID1), { id: "task_9", text: "Not an inbox item" }), ...rpc({ received: 1, written: 1, results: [result(ID1, { outcome: "proposed", proposal_id: "p1", superseded: 0 })], receipt_id: "r1", replay: false }) });
    const res = await handlePush(req("POST", "/api/push?inbox=pull"), { env: ON, fetchImpl: f });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pulled: 1, proposed: 1, replayed: 0, already: 0, superseded: 0, deleted: 0, refused: 1, remaining: 0 });
    const call = calls.find((c) => c.url.endsWith("/rpc/records_import"))!;
    expect(call.init?.method).toBe("POST");
    expect(call.init?.headers).toEqual({ apikey: "anon-key", Authorization: "Bearer jwt-abc", "content-type": "application/json" });
    const sent = JSON.parse(call.init!.body!) as { p_source_app: string; p_records: { source_record_id: string; data: { text: string; notes: string }; source: { label: string } }[] };
    expect(sent.p_source_app).toBe("backend-inbox");
    expect(sent.p_records.map((r) => r.source_record_id)).toEqual([ID1]);
    expect(sent.p_records[0]!.source.label).toBe("Added by Michael Corleone");
    // The secret never rides to Supabase, and the person's JWT never rides to the backend.
    expect(call.init?.headers?.["x-jarvis-secret"]).toBeUndefined();
    expect(JSON.stringify(calls.filter((c) => c.url.includes("backend.example")))).not.toContain("jwt-abc");
    expect(deletes(calls)).toEqual([]);
    // Nothing a person wrote reaches a log line.
    expect([...log.mock.calls, ...err.mock.calls].flat().join(" ")).not.toContain("grant letter");
    log.mockRestore(); err.mockRestore();
  });

  it("an accepted or dismissed replay, and an already saved record, are deleted from the backend; a proposed replay is not", async () => {
    const ID3 = "inbox_33333333-3333-4333-8333-333333333333";
    const ID4 = "inbox_44444444-4444-4444-8444-444444444444";
    const { f, calls } = fakeFetch({ ...authOk, ...inbox(item(ID1), item(ID2), item(ID3), item(ID4)), ...rpc({ received: 4, written: 0, results: [
      result(ID1, { outcome: "replay", proposal_id: "p1", status: "accepted" }),
      result(ID2, { outcome: "replay", proposal_id: "p2", status: "proposed" }),
      result(ID3, { outcome: "replay", proposal_id: "p3", status: "dismissed" }),
      result(ID4, { outcome: "already_saved", item_id: "i4" }),
    ], receipt_id: "r1", replay: true }) });
    const res = await handlePush(req("POST", "/api/push?inbox=pull"), { env: ON, fetchImpl: f });
    expect(await res.json()).toEqual({ pulled: 4, proposed: 0, replayed: 3, already: 1, superseded: 0, deleted: 3, refused: 0, remaining: 0 });
    expect(deletes(calls)).toEqual([`https://backend.example/api/memory/tasks/${ID1}`, `https://backend.example/api/memory/tasks/${ID3}`, `https://backend.example/api/memory/tasks/${ID4}`]);
    const del = calls.find((c) => c.init?.method === "DELETE")!;
    expect(del.init?.headers?.["x-jarvis-secret"]).toBe(ENV.JARVIS_SECRET);
    expect(takenByDave({ source_record_id: ID1, revision: 1, outcome: "replay", proposal_id: "p", status: "superseded" })).toBe(false);
    expect(takenByDave({ source_record_id: ID1, revision: 1, outcome: "newer_revision_proposed", proposal_id: "p", item_id: "i" })).toBe(false);
  });

  it("a refused batch deletes nothing and says why; a Supabase outage deletes nothing", async () => {
    const refused = fakeFetch({ ...authOk, ...inbox(item(ID1), item(ID2)), ...rpc({ error: "INVALID_PAYLOAD", detail: "data", source_record_id: ID2 }) });
    const res = await handlePush(req("POST", "/api/push?inbox=pull"), { env: ON, fetchImpl: refused.f });
    // Every batch (the one) was refused: 422 with the first refusal's words and the two records counted as refused.
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "INVALID_PAYLOAD", detail: "data", pulled: 2, proposed: 0, deleted: 0, refused: 2 });
    expect(deletes(refused.calls)).toEqual([]);
    const down = fakeFetch({ ...authOk, ...inbox(item(ID1)), ...rpc({}, false) });
    expect((await handlePush(req("POST", "/api/push?inbox=pull"), { env: ON, fetchImpl: down.f })).status).toBe(502);
    expect(deletes(down.calls)).toEqual([]);
  });

  it("an empty inbox answers zeros and calls nothing but the read", async () => {
    const { f, calls } = fakeFetch({ ...authOk, ...inbox() });
    const res = await handlePush(req("POST", "/api/push?inbox=pull"), { env: ON, fetchImpl: f });
    expect(await res.json()).toEqual({ pulled: 0, proposed: 0, replayed: 0, already: 0, superseded: 0, deleted: 0, refused: 0, remaining: 0 });
    expect(calls.map((c) => c.url)).toEqual(["https://supa.example/auth/v1/user", "https://backend.example/api/memory/tasks"]);
  });

  // Review findings 1, 6 and 7 (2026-10-10): an upstream body that is not the shape the proxy expects is a 502
  // sentence, never a stack out of the edge function; a missing count is zero; a huge inbox is bounded.
  const manyIds = (n: number) => Array.from({ length: n }, (_, i) => `inbox_${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`);
  const proposedFor = () => ({ "https://supa.example/rest/v1/rpc/records_import": (init?: { body?: string }) => {
    const sent = JSON.parse(init?.body ?? "{}") as { p_records: { source_record_id: string }[] };
    return { ok: true, body: { received: sent.p_records.length, written: sent.p_records.length, results: sent.p_records.map((r) => result(r.source_record_id, { outcome: "proposed", proposal_id: "p", superseded: 0 })), receipt_id: "r", replay: false } };
  } });

  it("a backend body that is not JSON, or is JSON null, is a 502 that writes and deletes nothing", async () => {
    const html = fakeFetch({ ...authOk, "https://backend.example/api/memory/tasks": () => ({ ok: true, json: async () => { throw new SyntaxError("Unexpected token <"); } }), ...rpc({}) });
    const res = await handlePush(req("POST", "/api/push?inbox=pull"), { env: ON, fetchImpl: html.f });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "The backend inbox did not answer" });
    expect(html.calls.some((c) => c.url.includes("records_import"))).toBe(false);
    expect(deletes(html.calls)).toEqual([]);
    const nul = fakeFetch({ ...authOk, "https://backend.example/api/memory/tasks": () => ({ ok: true, json: async () => null }), ...rpc({}) });
    const res2 = await handlePush(req("POST", "/api/push?inbox=pull"), { env: ON, fetchImpl: nul.f });
    expect(res2.status).toBe(502);
    expect(nul.calls.some((c) => c.url.includes("records_import"))).toBe(false);
    // An object with no inbox list is the same answer.
    const noList = fakeFetch({ ...authOk, "https://backend.example/api/memory/tasks": () => ({ ok: true, body: { inbox: "nope" } }), ...rpc({}) });
    expect((await handlePush(req("POST", "/api/push?inbox=pull"), { env: ON, fetchImpl: noList.f })).status).toBe(502);
  });

  it("a Supabase 2xx whose body is null, {} or not JSON is a 502 with the counts so far, and deletes nothing", async () => {
    for (const bad of [{ json: async () => null }, { body: {} }, { json: async () => { throw new SyntaxError("bad"); } }]) {
      const { f, calls } = fakeFetch({ ...authOk, ...inbox(item(ID1)), "https://supa.example/rest/v1/rpc/records_import": () => ({ ok: true, ...bad }) });
      const res = await handlePush(req("POST", "/api/push?inbox=pull"), { env: ON, fetchImpl: f });
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ pulled: 1, proposed: 0, replayed: 0, already: 0, superseded: 0, deleted: 0, refused: 0, remaining: 0, error: "JARVIS did not answer" });
      expect(deletes(calls)).toEqual([]);
    }
  });

  it("a proposed row with no superseded count adds zero, never NaN", async () => {
    const { f } = fakeFetch({ ...authOk, ...inbox(item(ID1), item(ID2)), ...rpc({ received: 2, written: 2, results: [
      result(ID1, { outcome: "proposed", proposal_id: "p1" }),
      result(ID2, { outcome: "proposed", proposal_id: "p2", superseded: 2 }),
    ], receipt_id: "r1", replay: false }) });
    const res = await handlePush(req("POST", "/api/push?inbox=pull"), { env: ON, fetchImpl: f });
    expect(await res.json()).toEqual({ pulled: 2, proposed: 2, replayed: 0, already: 0, superseded: 2, deleted: 0, refused: 0, remaining: 0 });
  });

  it("an inbox of 600 is handled as 500 and the other 100 are reported as remaining", async () => {
    expect(INBOX_CAP).toBe(500);
    const { f, calls } = fakeFetch({ ...authOk, ...inbox(...manyIds(600).map((id) => item(id))), ...proposedFor() });
    const res = await handlePush(req("POST", "/api/push?inbox=pull"), { env: ON, fetchImpl: f });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pulled: 500, proposed: 500, replayed: 0, already: 0, superseded: 0, deleted: 0, refused: 0, remaining: 100 });
    expect(calls.filter((c) => c.url.includes("records_import"))).toHaveLength(10);
  });

  it("a batch the server refuses is counted under refused and the next batch still runs", async () => {
    const ids = manyIds(60);
    let batchNo = 0;
    const { f, calls } = fakeFetch({ ...authOk, ...inbox(...ids.map((id) => item(id))), "https://supa.example/rest/v1/rpc/records_import": (init?: { body?: string }) => {
      batchNo += 1;
      if (batchNo === 1) return { ok: true, body: { error: "IDEMPOTENCY_CONFLICT", source_record_id: ids[0] } };
      const sent = JSON.parse(init?.body ?? "{}") as { p_records: { source_record_id: string }[] };
      return { ok: true, body: { received: sent.p_records.length, written: 0, results: sent.p_records.map((r) => result(r.source_record_id, { outcome: "already_saved", item_id: "i" })), receipt_id: null, replay: false } };
    } });
    const res = await handlePush(req("POST", "/api/push?inbox=pull"), { env: ON, fetchImpl: f });
    // Not every batch was refused, so the pull is a 200 that counts the refused fifty and the ten that were taken.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pulled: 60, proposed: 0, replayed: 0, already: 10, superseded: 0, deleted: 10, refused: 50, remaining: 0 });
    expect(calls.filter((c) => c.url.includes("records_import"))).toHaveLength(2);
    // Nothing from the refused batch was deleted.
    expect(deletes(calls).every((u) => ids.slice(50).some((id) => u.endsWith(id)))).toBe(true);
  });
});
