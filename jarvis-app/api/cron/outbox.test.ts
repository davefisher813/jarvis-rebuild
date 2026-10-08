// THE SCHEDULED SEND WORKER OVER A FAKE GMAIL AND A FAKE SUPABASE (Email v1, migration 0059). The real handler runs; the
// network is a recorder. What these hold: a call without the vault's token does nothing at all; a call with it sweeps,
// claims whatever the database hands back (the database, not this route, refuses a held or expired one), settles the
// draft from the settled command, and sends exactly once.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import handler from "./outbox";
import { encrypt } from "../_google";

const KEY = Buffer.alloc(32, 7).toString("base64");
const USER = "11111111-1111-4111-8111-111111111111";
const ACCT = "22222222-2222-4222-8222-222222222222";
const DRAFT = "33333333-3333-4333-8333-333333333333";
const ACT = "44444444-4444-4444-8444-444444444444";
const OB = "55555555-5555-4555-8555-555555555555";
const res = (body: unknown, status = 200): Response => ({ ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body, arrayBuffer: async () => new ArrayBuffer(0) }) as unknown as Response;
let calls: { url: string; body: Record<string, unknown> | null }[] = [];
const rpcs = (fn: string) => calls.filter((c) => c.url.endsWith(`/rest/v1/rpc/${fn}`)).map((c) => c.body!);

async function world(o: { tokenOk?: boolean; claims?: Array<Record<string, unknown> | null>; settled?: string } = {}) {
  const enc = await encrypt("1//refresh", KEY);
  const queue = [...(o.claims ?? [null])];
  calls = [];
  const exact = { account_id: ACCT, from_identity: "dave@gmail.com", to: ["coach@example.test"], cc: [], bcc: [], subject: "Hi", body_text: "On it.", attachments: [], reply_headers: { in_reply_to: "<m2@example.test>", references: ["<m2@example.test>"], thread_id: "thr-1" }, draft_id: DRAFT, draft_revision: 3, client_message_id: `<${DRAFT}.3@jarvis.local>` };
  const claim = { outbox_id: OB, action_id: ACT, owner_id: USER, kind: "send_email", payload: exact, payload_hash: "h", provider_account_id: ACCT, claim_token: "tok", attempt: 1, lease_until: "2026-10-08T12:02:00Z" };
  let settled: string | null = null;
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ url, body });
    if (url.endsWith("/rpc/outbox_cron_ok")) return res(o.tokenOk === false ? false : body?.p_token === "good");
    if (url.endsWith("/rpc/outbox_sweep")) return res({ unknown: 0 });
    if (url.endsWith("/rpc/outbox_claim")) { const next = queue.shift() ?? null; return res(next === "claim" as never ? claim : next); }
    if (url.endsWith("/rpc/outbox_dispatched")) return res(true);
    if (url.endsWith("/rpc/outbox_settle")) { settled = String(body?.p_state); return res({ state: body?.p_state }); }
    if (url.endsWith("/rpc/draft_outcome")) return res({ draft_id: DRAFT, send_state: body?.p_state });
    if (url.includes("/rest/v1/google_tokens")) return res([{ token_enc: enc }]);
    if (url.includes("oauth2.googleapis.com/token")) return res({ access_token: "ya29.secret", expires_in: 3599 });
    if (url.includes("/rest/v1/email_draft?")) return res([{ id: DRAFT, revision: 3, send_state: "sending", sent_action_id: ACT, account_id: ACCT }]);
    if (url.includes("/rest/v1/email_account?")) return res([{ id: ACCT, address: "dave@gmail.com", state: "connected" }]);
    if (url.includes("/rest/v1/outbox_command?")) {
      if (url.includes("select=action_id")) return res([{ action_id: ACT }]);
      return res([{ id: OB, state: settled === "confirmed" ? "confirmed" : settled === "failed" ? "failed" : o.settled ?? "cancelled", error_code: null, provider_ack: { message_id: "gm-9" } }]);
    }
    if (url.includes("gmail.googleapis.com/gmail/v1/users/me/messages/send")) return res({ id: "gm-9", threadId: "t-9" });
    if (url.includes("/rest/v1/rpc/google_")) return res({}, 404);
    throw new Error("unexpected " + url);
  });
  vi.stubGlobal("fetch", f);
  return { claim };
}

const post = (token: string | null, method = "POST") => new Request("https://x.test/api/cron/outbox", { method, headers: token ? { authorization: `Bearer ${token}` } : {} });
beforeEach(() => {
  vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "web.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "shh");
  vi.stubEnv("GOOGLE_TOKEN_KEY", KEY);
  vi.stubEnv("VITE_SUPABASE_URL", "https://supa.test");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("POST /api/cron/outbox", () => {
  it("refuses everything without the vault's token: no sweep, no claim, no send", async () => {
    await world();
    for (const req of [post(null), post("wrong"), post("good", "GET")]) {
      const r = await handler(req);
      expect([401, 405]).toContain(r.status);
    }
    expect(rpcs("outbox_sweep")).toEqual([]);
    expect(rpcs("outbox_claim")).toEqual([]);
    expect(calls.some((c) => c.url.includes("messages/send"))).toBe(false);
  });

  it("a database that cannot vouch for the token (no vault yet) is a refusal too", async () => {
    await world({ tokenOk: false });
    expect((await handler(post("good"))).status).toBe(401);
    expect(rpcs("outbox_claim")).toEqual([]);
  });

  it("with the token and nothing due: sweeps once, asks once, sends nothing", async () => {
    await world({ claims: [null] });
    const r = await handler(post("good"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ handled: 0, confirmed: 0, failed: 0, unknown: 0, skipped: 0, lease_lost: 0 });
    expect(rpcs("outbox_sweep").length).toBe(1);
    expect(rpcs("outbox_claim").length).toBe(1);
    expect(calls.some((c) => c.url.includes("messages/send"))).toBe(false);
  });

  it("a command past its hold is carried out once, settled, and the draft follows", async () => {
    await world({ claims: ["claim" as never, null] });
    const r = await handler(post("good"));
    expect(await r.json()).toMatchObject({ handled: 1, confirmed: 1 });
    expect(calls.filter((c) => c.url.includes("messages/send")).length).toBe(1);
    expect(rpcs("outbox_dispatched").length).toBe(1);
    expect(rpcs("outbox_settle")[0]).toMatchObject({ p_state: "confirmed" });
    expect(rpcs("draft_outcome")[0]).toMatchObject({ p_action: ACT, p_state: "confirmed", p_provider_message_id: "gm-9" });
  });

  it("a command the database skips (a deadline passed) sends nothing and its draft is looked up from the outbox id", async () => {
    await world({ claims: [{ skipped: OB, reason: "HOLD_EXPIRED" }, null], settled: "cancelled" });
    const r = await handler(post("good"));
    expect(await r.json()).toMatchObject({ handled: 1, skipped: 1, confirmed: 0 });
    expect(calls.some((c) => c.url.includes("messages/send"))).toBe(false);
    expect(rpcs("outbox_dispatched")).toEqual([]);
  });

  it("is bounded: at most five commands per call", async () => {
    await world({ claims: ["claim", "claim", "claim", "claim", "claim", "claim", "claim"] as never });
    const r = await handler(post("good"));
    expect((await r.json() as { handled: number }).handled).toBe(5);
    expect(rpcs("outbox_claim").length).toBe(5);
  });
});
