// THE DOCUMENT CLOCK's front door (Doc AI, migration 0073): POST only, the vault secret or nothing, and an AI-door answer mapped to the
// extraction code the core understands without guessing. The pure order of work is src/docai/worker.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { docCallIdentity, mapAiAnswer, runDocWorker } from "./_docWorker";

const req = (method: string, headers: Record<string, string> = {}) => new Request("https://jarvis.test/api/ai", { method, headers });
const reply = (body: unknown, status = 200) => ({ ok: status < 300, status, text: async () => JSON.stringify(body), json: async () => body }) as unknown as Response;

beforeEach(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "https://db.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("the clock's front door", () => {
  it("refuses anything but POST", async () => {
    const r = await runDocWorker(req("GET"));
    expect(r.status).toBe(405);
  });

  it("refuses a wrong secret and does no work", async () => {
    const fetchMock = vi.fn(async (url: string) => (url.endsWith("/rpc/doc_cron_ok") ? reply(false) : reply(null)));
    vi.stubGlobal("fetch", fetchMock);
    const r = await runDocWorker(req("POST", { authorization: "Bearer nope" }));
    expect(r.status).toBe(401);
    expect(fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => !u.endsWith("/rpc/doc_cron_ok"))).toEqual([]);
  });

  it("refuses with no secret at all, without asking the database", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await runDocWorker(req("POST"))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("with no service key it says unavailable, not unauthorized", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect((await runDocWorker(req("POST", { authorization: "Bearer x" }))).status).toBe(503);
  });

  it("with nothing due it sweeps once and answers counts only", async () => {
    const fetchMock = vi.fn(async (url: string) => (url.endsWith("/rpc/doc_cron_ok") ? reply(true) : reply(null)));
    vi.stubGlobal("fetch", fetchMock);
    const r = await runDocWorker(req("POST", { authorization: "Bearer good" }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ handled: 0, done: 0, wait: 0, retry: 0, failed: 0, unknown: 0, lease_lost: 0 });
    const names = fetchMock.mock.calls.map((c) => String(c[0]).split("/").pop());
    expect(names).toEqual(["doc_cron_ok", "doc_sweep", "doc_claim"]);
  });
});

describe("an internal docs call is vouched for only by a live claim", () => {
  const JOB = "11111111-1111-4111-8111-111111111111";
  const CLAIM = "22222222-2222-4222-8222-222222222222";
  const OWNER = "33333333-3333-4333-8333-333333333333";

  it("a right secret with no claim headers is nobody", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(true)));
    expect(await docCallIdentity(req("POST", { authorization: "Bearer good" }))).toBeNull();
  });

  it("a right secret with a claim the database does not recognise is nobody", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.endsWith("/rpc/doc_cron_ok") ? reply(true) : reply(null))));
    expect(await docCallIdentity(req("POST", { authorization: "Bearer good", "x-jarvis-job": JOB, "x-jarvis-claim": CLAIM }))).toBeNull();
  });

  it("a wrong secret is nobody even with a real claim", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.endsWith("/rpc/doc_cron_ok") ? reply(false) : reply(OWNER))));
    expect(await docCallIdentity(req("POST", { authorization: "Bearer bad", "x-jarvis-job": JOB, "x-jarvis-claim": CLAIM }))).toBeNull();
  });

  it("the secret and a live claim name the owner, with their metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/rpc/doc_cron_ok")) return reply(true);
      if (url.endsWith("/rpc/doc_job_owner")) return reply(OWNER);
      return reply({ id: OWNER, app_metadata: { ai: "on" } });
    }));
    expect(await docCallIdentity(req("POST", { authorization: "Bearer good", "x-jarvis-job": JOB, "x-jarvis-claim": CLAIM }))).toEqual({ id: OWNER, app_metadata: { ai: "on" } });
  });
});

describe("the AI door's answer, mapped without guessing", () => {
  it("a good reply is parsed, and a cut-off one is marked truncated", () => {
    expect(mapAiAnswer(200, { text: '{"a":1}', stop_reason: "end_turn" })).toEqual({ ok: true, json: { a: 1 }, truncated: false });
    expect(mapAiAnswer(200, { text: '{"a":1}', stop_reason: "max_tokens" })).toEqual({ ok: true, json: { a: 1 }, truncated: true });
  });
  it("text that is not JSON, or no text, is a schema failure", () => {
    expect(mapAiAnswer(200, { text: '{"a":' })).toEqual({ ok: false, code: "SCHEMA" });
    expect(mapAiAnswer(200, null)).toEqual({ ok: false, code: "SCHEMA" });
  });
  it("the gate saying no is OFF, never a failure", () => {
    expect(mapAiAnswer(403, null)).toEqual({ ok: false, code: "OFF" });
    expect(mapAiAnswer(402, { code: "AI_BUDGET_OFF" })).toEqual({ ok: false, code: "OFF" });
  });
  it("a cap or budget refusal waits", () => {
    expect(mapAiAnswer(402, { code: "AI_BUDGET_DAILY" })).toEqual({ ok: false, code: "BUSY" });
    expect(mapAiAnswer(429, null)).toEqual({ ok: false, code: "BUSY" });
    expect(mapAiAnswer(503, null)).toEqual({ ok: false, code: "BUSY" });
  });
  it("a repeated request id is an unknown, never a second spend", () => {
    expect(mapAiAnswer(409, null)).toEqual({ ok: false, code: "UNKNOWN" });
  });
  it("provider answers: credit is named, silence is unknown, overload waits, the rest is upstream", () => {
    expect(mapAiAnswer(502, { detail: "Your credit balance is too low" })).toEqual({ ok: false, code: "CREDIT" });
    expect(mapAiAnswer(502, {})).toEqual({ ok: false, code: "UNKNOWN" });
    expect(mapAiAnswer(502, { detail: "overloaded_error" })).toEqual({ ok: false, code: "BUSY" });
    expect(mapAiAnswer(502, { detail: "invalid_request_error" })).toEqual({ ok: false, code: "UPSTREAM" });
    expect(mapAiAnswer(500, null)).toEqual({ ok: false, code: "UPSTREAM" });
  });
});
