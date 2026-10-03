// THE SEND ROUTE AND THE PROVIDER CALL, END TO END OVER A FAKE GMAIL AND A
// FAKE SUPABASE (docs/jarvis-unified, slice 07; IMPLEMENTATION-SPEC.md 07.3,
// 08 E18, 13 "Provider send timeout"; prompt 07 "Verify before completing").
// The real handlers run; the network is a recorder. What each one SENDS is
// what these hold: the tap goes to the database as the person; the command is
// claimed by its action id and no other; the draft is re-derived before any
// byte leaves; the raw message carries Bcc, the reply headers and the bound
// Message-ID; a refusal before the call fails the command with its code and
// nothing is sent; a timeout or a 5xx after the body went is unknown, once,
// with no second call; Check Again settles only on a found message.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import sendHandler from "./send";
import reconcileHandler from "./reconcile";
import { encrypt } from "../_google";
import { decodeRaw, sha256Hex } from "../_mime";

const KEY = Buffer.alloc(32, 7).toString("base64");
const USER = "11111111-1111-4111-8111-111111111111";
const DAVE = "dave@gmail.com";
const ACCT = "22222222-2222-4222-8222-222222222222";
const DRAFT = "33333333-3333-4333-8333-333333333333";
const ACT = "44444444-4444-4444-8444-444444444444";
const OB = "55555555-5555-4555-8555-555555555555";
const NONCE = "ab".repeat(32);
const HASH = "cd".repeat(32);
const PDF = new TextEncoder().encode("%PDF-1.4 fixture bytes");

type Call = { url: string; method: string; body: Record<string, unknown> | null; headers: Record<string, string> };
let calls: Call[] = [];
const sent = (part: string) => calls.filter((c) => c.url.includes(part));
const rpc = (fn: string) => calls.filter((c) => c.url.endsWith(`/rest/v1/rpc/${fn}`)).map((c) => c.body!);
const gmailSends = () => sent("gmail.googleapis.com/gmail/v1/users/me/messages/send");

const res = (body: unknown, status = 200): Response => ({ ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body, arrayBuffer: async () => new ArrayBuffer(0) }) as unknown as Response;

const exact = (o: Record<string, unknown> = {}) => ({
  account_id: ACCT, from_identity: DAVE, to: ["coach@example.test"], cc: [], bcc: ["me@example.test"], subject: "Re: Transcript", body_text: "On it.\nTonight.",
  attachments: [] as Array<Record<string, unknown>>, reply_headers: { in_reply_to: "<m2@example.test>", references: ["<m2@example.test>"], thread_id: "thr-1" },
  draft_id: DRAFT, draft_revision: 3, client_message_id: `<${DRAFT}.3@jarvis.local>`, ...o,
});

interface World {
  approve: Record<string, unknown>;
  claim: Record<string, unknown> | null;
  draftRow: Record<string, unknown> | null;
  account: Record<string, unknown>;
  gmailSend: () => Response;
  storage: (path: string) => Response;
  settled: Record<string, unknown>;
  search?: Response;
  outboxRow?: Record<string, unknown> | null;
}

async function stubWorld(w: Partial<World>) {
  const enc = await encrypt("1//refresh", KEY);
  const payload = exact();
  const world: World = {
    approve: { action_id: ACT, state: "approved", outbox_id: OB, receipt_id: "r-1", safe_message: "Sent Reply to coach@example.test and 1 More", draft_id: DRAFT, send_state: "sending" },
    claim: { outbox_id: OB, action_id: ACT, owner_id: USER, kind: "send_email", payload, payload_hash: HASH, provider_account_id: ACCT, claim_token: "tok-1", attempt: 1, lease_until: "2026-10-03T12:02:00Z" },
    draftRow: { id: DRAFT, revision: 3, send_state: "sending", sent_action_id: ACT, account_id: ACCT },
    account: { id: ACCT, address: DAVE, state: "connected" },
    gmailSend: () => res({ id: "gm-77", threadId: "thr-1" }),
    storage: () => new Response(PDF, { status: 200 }),
    settled: { id: OB, state: "confirmed", error_code: null, provider_ack: { provider: "gmail", message_id: "gm-77" } },
    ...w,
  };
  let settledState: string | null = null;
  calls = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    const headers = Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {}));
    calls.push({ url, method, body, headers });
    const u = new URL(url, "https://x.test");
    if (url.includes("/auth/v1/user")) return headers.Authorization === "Bearer jwt" ? res({ id: USER }) : res({}, 401);
    if (url.includes("oauth2.googleapis.com/token")) return res({ access_token: "ya29.secret", expires_in: 3599 });
    if (url.includes("/rest/v1/google_tokens")) return res([{ token_enc: enc }]);
    if (url.includes("/rest/v1/rpc/send_approve")) return res(world.approve);
    if (url.includes("/rest/v1/rpc/outbox_sweep")) return res({ swept: 0 });
    if (url.includes("/rest/v1/rpc/outbox_claim_action")) return res(world.claim);
    if (url.includes("/rest/v1/rpc/outbox_dispatched")) return res(true);
    if (url.includes("/rest/v1/rpc/outbox_settle")) { settledState = String(body?.p_state); return res({ outbox_id: OB, action_id: ACT, state: body?.p_state }); }
    if (url.includes("/rest/v1/rpc/outbox_reconcile")) return res({ outbox_id: OB, state: body?.p_state });
    if (url.includes("/rest/v1/rpc/draft_outcome")) return res({ draft_id: DRAFT, send_state: body?.p_state });
    if (url.includes("/rest/v1/rpc/draft_get")) return res({ id: DRAFT, account: DAVE, send_state: settledState === "confirmed" ? "sent" : settledState === "outcome_unknown" ? "unknown" : settledState === "failed" ? "failed" : "sending", to_addresses: payload.to, cc_addresses: [], bcc_addresses: payload.bcc, subject: payload.subject, revision: 3, sent_action_id: ACT });
    if (url.includes("/rest/v1/rpc/email_account_state")) return res({ state: body?.p_state });
    if (url.includes("/rest/v1/email_draft?")) return res(world.draftRow ? [world.draftRow] : []);
    if (url.includes("/rest/v1/email_account?")) return res([world.account]);
    if (url.includes("/rest/v1/outbox_command?")) {
      if (world.outboxRow !== undefined) return res(world.outboxRow ? [world.outboxRow] : []);
      if (settledState === null) return res([world.settled]);
      return res([{ ...world.settled, state: settledState, error_code: settledState === "failed" ? (calls.find((c) => c.url.includes("outbox_settle"))?.body?.p_error ?? null) : settledState === "outcome_unknown" ? "OUTCOME_UNKNOWN" : null, provider_ack: settledState === "confirmed" ? world.settled.provider_ack : null }]);
    }
    if (url.includes("/storage/v1/object/")) return world.storage(u.pathname);
    if (url.includes("gmail.googleapis.com/gmail/v1/users/me/messages/send")) return world.gmailSend();
    if (url.includes("gmail.googleapis.com/gmail/v1/users/me/messages?")) return world.search ?? res({ messages: [] });
    throw new Error("unexpected " + method + " " + url);
  });
  vi.stubGlobal("fetch", f);
  return f;
}

const post = (path: string, body: unknown, auth: string | null = "Bearer jwt") =>
  new Request(`https://x.test${path}`, { method: "POST", headers: { ...(auth ? { authorization: auth } : {}), "content-type": "application/json" }, body: JSON.stringify(body) });
const answer = async (r: Response) => ({ status: r.status, json: (await r.json()) as Record<string, unknown> });
const tap = { draft_id: DRAFT, review_nonce: NONCE, shown_payload_hash: HASH, request_id: "req-1" };

beforeEach(() => {
  calls = [];
  vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "web.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "shh");
  vi.stubEnv("GOOGLE_TOKEN_KEY", KEY);
  vi.stubEnv("VITE_SUPABASE_URL", "https://supa.test");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("POST /api/email/send", () => {
  it("the tap goes to the database as the person; this action alone is claimed; the raw message carries Bcc, the reply headers and the bound Message-ID; Gmail's ack settles it and the draft is sent", async () => {
    await stubWorld({});
    const r = await answer(await sendHandler(post("/api/email/send", tap)));
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, action_id: ACT, outcome: "confirmed", provider_message_id: "gm-77", replay: false });
    const approve = sent("/rest/v1/rpc/send_approve")[0]!;
    expect(approve.headers.Authorization).toBe("Bearer jwt");
    expect(approve.headers.apikey).toBe("anon");
    expect(approve.body).toEqual({ p_draft: DRAFT, p_review_nonce: NONCE, p_shown_payload_hash: HASH, p_idempotency_key: "req-1" });
    expect(rpc("outbox_claim_action")[0]).toMatchObject({ p_action: ACT });
    expect(rpc("outbox_claim").length).toBe(0);
    expect(calls.map((c) => c.url).filter((u) => u.includes("/rest/v1/rpc/")).map((u) => u.split("/rpc/")[1]))
      .toEqual(["send_approve", "outbox_sweep", "outbox_claim_action", "outbox_dispatched", "outbox_settle", "draft_outcome", "draft_get"]);
    const g = gmailSends();
    expect(g.length).toBe(1);
    expect(g[0]!.headers.Authorization).toBe("Bearer ya29.secret");
    expect(g[0]!.body!.threadId).toBe("thr-1");
    const raw = decodeRaw(String(g[0]!.body!.raw));
    expect(raw).toContain("From: dave@gmail.com\r\n");
    expect(raw).toContain("To: coach@example.test\r\n");
    expect(raw).toContain("Bcc: me@example.test\r\n");
    expect(raw).toContain(`Message-ID: <${DRAFT}.3@jarvis.local>\r\n`);
    expect(raw).toContain("In-Reply-To: <m2@example.test>\r\n");
    expect(raw).toContain("References: <m2@example.test>\r\n");
    expect(raw.endsWith("On it.\r\nTonight.")).toBe(true);
    expect(rpc("outbox_settle")[0]).toMatchObject({ p_outbox: OB, p_claim_token: "tok-1", p_state: "confirmed", p_verb: "Sent Reply to coach@example.test and 1 More", p_provider_ack: { provider: "gmail", message_id: "gm-77", thread_id: "thr-1", client_message_id: `<${DRAFT}.3@jarvis.local>` } });
    expect(rpc("draft_outcome")[0]).toEqual({ p_action: ACT, p_state: "confirmed", p_provider_message_id: "gm-77" });
    expect(JSON.stringify(r.json)).not.toContain("ya29");
    expect(JSON.stringify(r.json)).not.toContain("1//refresh");
  });

  it("a refusal from the database passes through with its own code, and nothing is claimed or sent", async () => {
    await stubWorld({ approve: { error: "REVIEW_CHANGED", detail: "revision", revision: 4 } });
    const r = await answer(await sendHandler(post("/api/email/send", tap)));
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ code: "REVIEW_CHANGED", safe_message: "Message Changed · Review It Again", revision: 4 });
    expect(rpc("outbox_claim_action").length).toBe(0);
    expect(gmailSends().length).toBe(0);
  });

  it("an expired approval and a draft already sent are refused the same honest way", async () => {
    await stubWorld({ approve: { error: "APPROVAL_EXPIRED" } });
    expect((await answer(await sendHandler(post("/api/email/send", tap)))).json).toMatchObject({ code: "APPROVAL_EXPIRED" });
    await stubWorld({ approve: { error: "DRAFT_SENT", send_state: "sent", action_id: ACT } });
    expect((await answer(await sendHandler(post("/api/email/send", tap)))).json).toMatchObject({ code: "DRAFT_SENT", send_state: "sent" });
    expect(gmailSends().length).toBe(0);
  });

  it("a second tap replays the same action: nothing to claim, the settled state read back, no second send", async () => {
    await stubWorld({ approve: { action_id: ACT, state: "confirmed", replay: true, safe_message: "Sent Reply to coach@example.test and 1 More", draft_id: DRAFT, send_state: "sent" }, claim: null, settled: { id: OB, state: "confirmed", error_code: null, provider_ack: { provider: "gmail", message_id: "gm-77" } } });
    const r = await answer(await sendHandler(post("/api/email/send", tap)));
    expect(r.json).toMatchObject({ ok: true, replay: true, outcome: "confirmed", provider_message_id: "gm-77" });
    expect(gmailSends().length).toBe(0);
    expect(rpc("outbox_dispatched").length).toBe(0);
  });

  it("re-derived before anything leaves: a draft that moved on after the review fails the command with REVIEW_CHANGED and Gmail is never called", async () => {
    await stubWorld({ draftRow: { id: DRAFT, revision: 4, send_state: "sending", sent_action_id: ACT, account_id: ACCT } });
    const r = await answer(await sendHandler(post("/api/email/send", tap)));
    expect(r.json).toMatchObject({ ok: true, outcome: "failed" });
    expect(gmailSends().length).toBe(0);
    expect(rpc("outbox_settle")[0]).toMatchObject({ p_state: "failed", p_error: "REVIEW_CHANGED", p_verb: "Not Sent · The Draft Changed After the Review" });
    expect(rpc("draft_outcome")[0]).toMatchObject({ p_action: ACT, p_state: "failed" });
  });

  it("an attachment whose bytes no longer match the reviewed hash refuses the send; matching bytes ride along as a base64 part", async () => {
    const good = await sha256Hex(PDF);
    const withAtt = (sha: string) => ({ outbox_id: OB, action_id: ACT, owner_id: USER, kind: "send_email", payload: exact({ attachments: [{ storage_id: `${USER}/draft-x/report.pdf`, filename: "report.pdf", size_bytes: PDF.byteLength, sha256: sha, mime_type: "application/pdf" }] }), payload_hash: HASH, provider_account_id: ACCT, claim_token: "tok-1", attempt: 1, lease_until: "x" });
    await stubWorld({ claim: withAtt("f".repeat(64)) });
    let r = await answer(await sendHandler(post("/api/email/send", tap)));
    expect(r.json).toMatchObject({ outcome: "failed" });
    expect(rpc("outbox_settle")[0]).toMatchObject({ p_state: "failed", p_error: "ATTACHMENT_CHANGED" });
    expect(gmailSends().length).toBe(0);

    await stubWorld({ claim: withAtt(good) });
    r = await answer(await sendHandler(post("/api/email/send", tap)));
    expect(r.json).toMatchObject({ outcome: "confirmed" });
    const raw = decodeRaw(String(gmailSends()[0]!.body!.raw));
    expect(raw).toContain('Content-Disposition: attachment; filename="report.pdf"');
    expect(raw).toContain(Buffer.from(PDF).toString("base64"));
    expect(sent("/storage/v1/object/user-files/")[0]!.headers.Authorization).toBe("Bearer service");
  });

  it("an attachment under another owner's folder never leaves and is never fetched", async () => {
    await stubWorld({ claim: { outbox_id: OB, action_id: ACT, owner_id: USER, kind: "send_email", payload: exact({ attachments: [{ storage_id: "someone-else/draft/x.pdf", filename: "x.pdf", size_bytes: 3, sha256: "a".repeat(64), mime_type: "application/pdf" }] }), payload_hash: HASH, provider_account_id: ACCT, claim_token: "tok-1", attempt: 1, lease_until: "x" } });
    const r = await answer(await sendHandler(post("/api/email/send", tap)));
    expect(r.json).toMatchObject({ outcome: "failed" });
    expect(sent("/storage/v1/object/").length).toBe(0);
    expect(rpc("outbox_settle")[0]).toMatchObject({ p_state: "failed", p_error: "REVIEW_CHANGED" });
  });

  it("Gmail refusing the scope is Not Sent with PROVIDER_SCOPE; a revoked token marks the account reauth", async () => {
    await stubWorld({ gmailSend: () => res({ error: { message: "Insufficient Permission", status: "PERMISSION_DENIED" } }, 403) });
    let r = await answer(await sendHandler(post("/api/email/send", tap)));
    expect(r.json).toMatchObject({ outcome: "failed" });
    expect(rpc("outbox_settle")[0]).toMatchObject({ p_state: "failed", p_error: "PROVIDER_SCOPE", p_verb: "Not Sent · Gmail Needs Permission to Send · Reconnect in Connections" });
    await stubWorld({ gmailSend: () => res({ error: { message: "Invalid Credentials" } }, 401) });
    r = await answer(await sendHandler(post("/api/email/send", tap)));
    expect(rpc("outbox_settle")[0]).toMatchObject({ p_state: "failed", p_error: "PROVIDER_AUTH" });
    expect(rpc("email_account_state")[0]).toMatchObject({ p_account: ACCT, p_state: "reauth" });
  });

  it("a timeout after the body went is UNKNOWN: one Gmail call, settled unknown, the draft blocked, never a second call", async () => {
    await stubWorld({ gmailSend: () => { throw new DOMException("The operation was aborted.", "AbortError"); } });
    const r = await answer(await sendHandler(post("/api/email/send", tap)));
    expect(r.json).toMatchObject({ ok: true, outcome: "outcome_unknown", provider_message_id: null });
    expect(gmailSends().length).toBe(1);
    expect(rpc("outbox_settle")[0]).toMatchObject({ p_state: "outcome_unknown", p_verb: "Send Status Unknown · Check Gmail Before Trying Again", p_error: "OUTCOME_UNKNOWN" });
    expect(rpc("draft_outcome")[0]).toMatchObject({ p_action: ACT, p_state: "outcome_unknown" });
  });

  it("a 5xx after the body went is unknown too; a 4xx that names the request is Not Sent", async () => {
    await stubWorld({ gmailSend: () => res({ error: { message: "Backend Error" } }, 503) });
    expect((await answer(await sendHandler(post("/api/email/send", tap)))).json).toMatchObject({ outcome: "outcome_unknown" });
    expect(gmailSends().length).toBe(1);
    await stubWorld({ gmailSend: () => res({ error: { message: "Invalid to header" } }, 400) });
    expect((await answer(await sendHandler(post("/api/email/send", tap)))).json).toMatchObject({ outcome: "failed" });
    expect(rpc("outbox_settle")[0]).toMatchObject({ p_state: "failed", p_error: "INVALID_PAYLOAD" });
  });

  it("no session is 401, a malformed tap is 422, the wrong method is 405, and none of them reach the database", async () => {
    await stubWorld({});
    expect((await sendHandler(post("/api/email/send", tap, null))).status).toBe(401);
    expect((await sendHandler(post("/api/email/send", { ...tap, shown_payload_hash: "short" }))).status).toBe(422);
    expect((await sendHandler(post("/api/email/send", { ...tap, draft_id: "not-a-uuid" }))).status).toBe(422);
    expect((await sendHandler(new Request("https://x.test/api/email/send", { method: "GET", headers: { authorization: "Bearer jwt" } }))).status).toBe(405);
    expect(rpc("send_approve").length).toBe(0);
  });
});

describe("POST /api/email/reconcile", () => {
  const unknownRow = { id: OB, state: "outcome_unknown", kind: "send_email", payload: exact(), provider_account_id: ACCT };
  it("the message found in Gmail under the bound Message-ID settles the unknown send as confirmed, with the provider's id on the receipt and the draft", async () => {
    await stubWorld({ outboxRow: unknownRow, search: res({ messages: [{ id: "gm-91", threadId: "thr-1" }] }) });
    const r = await answer(await reconcileHandler(post("/api/email/reconcile", { action_id: ACT })));
    expect(r.json).toMatchObject({ ok: true, state: "confirmed", found: true, provider_message_id: "gm-91" });
    const q = sent("gmail.googleapis.com/gmail/v1/users/me/messages?")[0]!;
    expect(decodeURIComponent(q.url)).toContain(`q=rfc822msgid:${DRAFT}.3@jarvis.local`);
    expect(rpc("outbox_reconcile")[0]).toMatchObject({ p_outbox: OB, p_state: "confirmed", p_verb: "Sent Reply to coach@example.test and 1 More", p_evidence: { provider: "gmail", provider_message_id: "gm-91", thread_id: "thr-1" } });
    expect(rpc("draft_outcome")[0]).toMatchObject({ p_action: ACT, p_state: "confirmed", p_provider_message_id: "gm-91" });
    expect(gmailSends().length).toBe(0);
  });

  it("not found is not proof: the send stays unknown, nothing is reconciled, nothing is resent", async () => {
    await stubWorld({ outboxRow: unknownRow, search: res({ messages: [] }) });
    const r = await answer(await reconcileHandler(post("/api/email/reconcile", { action_id: ACT })));
    expect(r.json).toMatchObject({ ok: true, state: "outcome_unknown", found: false });
    expect(rpc("outbox_reconcile").length).toBe(0);
    expect(rpc("draft_outcome").length).toBe(0);
    expect(gmailSends().length).toBe(0);
  });

  it("a send that is not unknown answers its state without asking Gmail; a command that is not the person's is not found", async () => {
    await stubWorld({ outboxRow: { ...unknownRow, state: "confirmed" } });
    expect((await answer(await reconcileHandler(post("/api/email/reconcile", { action_id: ACT })))).json).toMatchObject({ ok: true, state: "confirmed", found: null });
    expect(sent("gmail.googleapis.com").length).toBe(0);
    await stubWorld({ outboxRow: null });
    expect((await reconcileHandler(post("/api/email/reconcile", { action_id: ACT }))).status).toBe(404);
  });
});
