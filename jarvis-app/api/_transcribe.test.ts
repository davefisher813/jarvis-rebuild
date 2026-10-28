// THE SPEECH BOX, server half. Audio in, words out, and nothing else: no key means a plain "not set up", AI Off means no voice, a
// vendor refusal is said as what it is, and the audio is never kept.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { transcribeRequest, vendorCode } from "./_transcribe";

const who = { supaUrl: "https://db.test", supaAnon: "anon", token: "tok", userId: "u1" };
const clip = (type = "audio/webm;codecs=opus", bytes = 2000) =>
  new Request("https://jarvis.test/api/ai", { method: "POST", headers: { "content-type": type, "x-jarvis-transcribe": "1" }, body: new Uint8Array(bytes) });
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

interface Calls { urls: string[] }
function stub(opts: { level?: string; vendor?: Response | (() => Response); rate?: { allowed: boolean; reason?: string } }) {
  const calls: Calls = { urls: [] };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.urls.push(String(url));
    if (url.includes("/rest/v1/item")) return reply([{ data: { ai: { level: opts.level ?? "draft" } } }]);
    if (url.includes("/rpc/ai_try_consume")) return reply(opts.rate ?? { allowed: true });
    const v = opts.vendor ?? reply({ text: "  call Marco at 5  " });
    return typeof v === "function" ? v() : v;
  }));
  return calls;
}
const vendorCalls = (c: Calls) => c.urls.filter((u) => u.includes("audio/transcriptions"));

beforeEach(() => {
  vi.stubEnv("TRANSCRIBE_API_KEY", "k");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("the speech door", () => {
  it("says it is not set up when there is no provider key, and touches nothing", async () => {
    vi.stubEnv("TRANSCRIBE_API_KEY", "");
    const calls = stub({});
    const r = await transcribeRequest(clip(), who);
    expect(r.status).toBe(503);
    expect(((await r.json()) as { code: string }).code).toBe("TRANSCRIBE_NOT_CONFIGURED");
    expect(calls.urls).toEqual([]);
  });

  it("turns a recording into trimmed words", async () => {
    const calls = stub({});
    const r = await transcribeRequest(clip(), who);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ text: "call Marco at 5" });
    expect(vendorCalls(calls)).toHaveLength(1);
  });

  it("sends the audio to the provider with its own key and the right file name", async () => {
    stub({});
    const spy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    await transcribeRequest(clip("audio/mp4"), who);
    const call = spy.mock.calls.find((c) => String(c[0]).includes("audio/transcriptions"))!;
    const init = call[1] as { headers: Record<string, string>; body: FormData };
    expect(init.headers.Authorization).toBe("Bearer k");
    expect((init.body.get("file") as File).name).toBe("speech.m4a");
    expect(init.body.get("language")).toBe("en");
  });

  it("answers silence with empty words, not a failure", async () => {
    stub({ vendor: reply({ text: "" }) });
    const r = await transcribeRequest(clip(), who);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ text: "" });
  });

  it("refuses a type that is not audio, and an empty or oversized body, before the provider", async () => {
    const calls = stub({});
    expect((await transcribeRequest(clip("text/plain"), who)).status).toBe(400);
    expect((await transcribeRequest(clip("audio/webm", 0), who)).status).toBe(400);
    const big = await transcribeRequest(clip("audio/webm", 3_100_000), who);
    expect(big.status).toBe(413);
    expect(((await big.json()) as { code: string }).code).toBe("TRANSCRIBE_TOO_LARGE");
    expect(vendorCalls(calls)).toHaveLength(0);
  });

  it("is off when AI is off, and never calls the provider", async () => {
    const calls = stub({ level: "off" });
    const r = await transcribeRequest(clip(), who);
    expect(r.status).toBe(403);
    expect(((await r.json()) as { code: string }).code).toBe("AI_OFF");
    expect(vendorCalls(calls)).toHaveLength(0);
  });

  it("holds voice to the same hourly counter, as kind speech", async () => {
    const calls = stub({ rate: { allowed: false, reason: "user" } });
    const r = await transcribeRequest(clip(), who);
    expect(r.status).toBe(429);
    expect(vendorCalls(calls)).toHaveLength(0);
    const spy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const rpc = spy.mock.calls.find((c) => String(c[0]).includes("ai_try_consume"))!;
    expect(JSON.parse((rpc[1] as { body: string }).body).p_kind).toBe("speech");
  });

  it("does not run without a way to count when limits are required", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const calls = stub({});
    const r = await transcribeRequest(clip(), who);
    expect(r.status).toBe(503);
    expect(vendorCalls(calls)).toHaveLength(0);
  });

  it("says what a provider failure is: busy can be asked again, a refusal cannot", async () => {
    expect(vendorCode(429)).toBe("TRANSCRIBE_BUSY");
    expect(vendorCode(503)).toBe("TRANSCRIBE_BUSY");
    expect(vendorCode(400)).toBe("TRANSCRIBE_REJECTED");
    expect(vendorCode(401)).toBe("TRANSCRIBE_REJECTED");
    stub({ vendor: reply({ error: "no" }, 401) });
    const r = await transcribeRequest(clip(), who);
    const j = (await r.json()) as { code: string; retryable: boolean };
    expect(j.code).toBe("TRANSCRIBE_REJECTED");
    expect(j.retryable).toBe(false);
  });

  it("answers a dropped provider connection as busy", async () => {
    stub({ vendor: () => { throw new Error("socket"); } });
    const r = await transcribeRequest(clip(), who);
    expect(((await r.json()) as { code: string }).code).toBe("TRANSCRIBE_BUSY");
  });
});
