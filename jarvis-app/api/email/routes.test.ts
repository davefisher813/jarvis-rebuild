// THE EMAIL ROUTES, END TO END OVER A FAKE GMAIL AND A FAKE SUPABASE
// (docs/jarvis-unified, slice 05; IMPLEMENTATION-SPEC.md 08, 11; prompt 05
// "Verify before completing"). The real handlers run; the network is a
// recorder. What each route SENDS is what these hold: which Gmail call, which
// cache function with which arguments, which code when something refuses.
// The token never appears in a response; the cache is written with Gmail's
// answer and never with the request; nothing extracts or infers.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import syncHandler, { INBOX_PAGE } from "./sync";
import messageHandler from "./message";
import searchHandler, { literalQuery } from "./search";
import attachmentHandler from "./attachment";
import accountsHandler from "./accounts";
import { encrypt } from "../_google";

const KEY = Buffer.alloc(32, 7).toString("base64");
const USER = "user-1";
const DAVE = "dave@gmail.com";
const WORK = "work@gmail.com";
const ACCT: Record<string, string> = { [DAVE]: "acct-dave", [WORK]: "acct-work" };
const MSG = "11111111-1111-1111-1111-111111111111";

type Call = { url: string; method: string; body: Record<string, unknown> | null };
let calls: Call[] = [];
const sent = (part: string) => calls.filter((c) => c.url.includes(part));
const rpc = (fn: string) => sent(`/rest/v1/rpc/${fn}`).map((c) => c.body!);
const gmailCalls = () => calls.filter((c) => c.url.includes("gmail.googleapis.com")).map((c) => c.method + " " + c.url.replace("https://gmail.googleapis.com/gmail/v1/users/me", ""));

const res = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  ({ ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => body }) as Response;

const meta = (id: string, o: { from?: string; subject?: string; snippet?: string; ms?: number; labels?: string[]; thread?: string } = {}) => ({
  id, threadId: o.thread ?? `thr-${id}`, historyId: "h5", internalDate: String(o.ms ?? 1790000000000), snippet: o.snippet ?? "Amount &amp; due", labelIds: o.labels ?? ["INBOX", "UNREAD"],
  payload: { headers: [{ name: "From", value: o.from ?? "Con Edison <Billing@ConEdison.test>" }, { name: "To", value: DAVE }, { name: "Subject", value: o.subject ?? "Your bill" }] },
});

interface World {
  tokens: Record<string, string>;
  cursor: Record<string, string | null>;
  cached: Record<string, { id: string; subject: string; provider_labels: string[]; attachment_metadata?: unknown[] }>;
  gmail: (method: string, path: string, body: Record<string, unknown> | null) => Response | undefined;
  /** What Google's token endpoint answers; absent means a good token. */
  token?: () => Response;
  accountRows?: Array<{ id: string; address: string; state: string }>;
}

async function stubWorld(w: Partial<World>) {
  const enc = await encrypt("1//refresh", KEY);
  const world: World = { tokens: { [DAVE]: enc, [WORK]: enc }, cursor: { [DAVE]: null, [WORK]: null }, cached: {}, gmail: () => undefined, ...w };
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ url, method, body });
    const u = new URL(url, "https://x.test");
    if (url.includes("/auth/v1/user")) return res({ id: USER });
    if (url.includes("oauth2.googleapis.com/token")) return world.token ? world.token() : res({ access_token: "ya29.secret", expires_in: 3599 });
    if (url.includes("/rest/v1/google_tokens")) {
      const email = u.searchParams.get("email")?.replace("eq.", "");
      if (email) return res(world.tokens[email] ? [{ token_enc: world.tokens[email] }] : []);
      return res(Object.keys(world.tokens).map((e) => ({ email: e })));
    }
    if (url.includes("/rest/v1/rpc/email_account_upsert")) return res({ account_id: ACCT[String(body?.p_address)] ?? "acct-new" });
    if (url.includes("/rest/v1/email_account?")) {
      if (u.searchParams.get("select") === "id,address,state") return res(world.accountRows ?? Object.entries(ACCT).map(([address, id]) => ({ id, address, state: "connected" })));
      const address = u.searchParams.get("address")?.replace("eq.", "");
      if (address) return res(ACCT[address] ? [{ id: ACCT[address], cursor: world.cursor[address] ?? null, state: "connected" }] : []);
      const id = u.searchParams.get("id")?.replace("eq.", "") ?? "";
      const email = Object.keys(ACCT).find((e) => ACCT[e] === id) ?? DAVE;
      return res([{ id, cursor: world.cursor[email] ?? null, state: "connected" }]);
    }
    if (url.includes("/rest/v1/rpc/email_sync_apply")) return res({ account_id: body?.p_account, upserted: (body?.p_messages as unknown[]).length, removed: 0, last_sync_at: "2026-10-03T12:00:00Z" });
    if (url.includes("/rest/v1/rpc/email_sync_failed")) return res({ recorded: true });
    if (url.includes("/rest/v1/rpc/email_body_store")) return res({ stored: true });
    if (url.includes("/rest/v1/rpc/email_labels_set")) return res({ labels: body?.p_labels });
    if (url.includes("/rest/v1/rpc/email_action_record")) return res({ action_id: "act-1", replay: false });
    if (url.includes("/rest/v1/rpc/email_account_state")) return res({ state: body?.p_state });
    if (url.includes("/rest/v1/email_message?")) {
      const pid = u.searchParams.get("provider_id") ?? "";
      if (pid.startsWith("in.(")) {
        const ids = pid.slice(4, -1).split(",").map(decodeURIComponent);
        return res(ids.filter((i) => world.cached[i]).map((i) => ({ id: world.cached[i]!.id, account_id: u.searchParams.get("account_id")?.replace("eq.", ""), provider_id: i, thread_id: `thr-${i}`, internal_date: i === "m1" ? "2026-10-03T10:00:00Z" : "2026-10-03T10:00:00Z", from_address: "billing@conedison.test", from_name: "Con Edison", subject: world.cached[i]!.subject, snippet: "", has_body: false, attachment_metadata: [], provider_labels: world.cached[i]!.provider_labels, source_hash: "sh" })));
      }
      const one = world.cached[pid.replace("eq.", "")];
      return res(one ? [one] : []);
    }
    if (url.includes("gmail.googleapis.com")) {
      const path = url.replace("https://gmail.googleapis.com/gmail/v1/users/me", "");
      const got = world.gmail(method, path, body);
      if (got) return got;
      throw new Error("unexpected gmail " + method + " " + path);
    }
    // The token lifecycle functions (migration 0057) are not applied in this world: the lifecycle degrades to no cache, no lock, no DEAD mark.
    if (url.includes("/rest/v1/rpc/google_")) return res({}, 404);
    throw new Error("unexpected " + url);
  });
  vi.stubGlobal("fetch", f);
  return f;
}

const post = (path: string, body: unknown, auth: string | null = "Bearer jwt") =>
  new Request(`https://x.test${path}`, { method: "POST", headers: { ...(auth ? { authorization: auth } : {}), "content-type": "application/json" }, body: JSON.stringify(body) });
const answer = async (r: Response) => ({ status: r.status, json: (await r.json()) as Record<string, unknown> });

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

// A Gmail that lists two inbox messages, pages once, and answers metadata.
const listingGmail = (o: { history?: Response; profile?: Response } = {}) => (method: string, path: string): Response | undefined => {
  if (path.startsWith("/profile")) return o.profile ?? res({ emailAddress: DAVE, historyId: "h200" });
  if (path.startsWith("/history")) return o.history ?? res({ history: [{ messagesAdded: [{ message: { id: "m7" } }] }, { messagesDeleted: [{ message: { id: "m1" } }] }, { labelsRemoved: [{ message: { id: "m2" } }] }], historyId: "h300" });
  if (path.startsWith("/messages?")) {
    const u = new URL("https://g.test" + path);
    if (u.searchParams.get("pageToken") === "p2") return res({ messages: [{ id: "m3" }] });
    return res({ messages: [{ id: "m1" }, { id: "m2" }], nextPageToken: "p2" });
  }
  const m = /^\/messages\/([^/?]+)\?format=metadata/.exec(path);
  if (m) return m[1] === "gone" ? res({ error: "nope" }, 404) : res(meta(m[1]!, { ms: m[1] === "m2" ? 1790000000000 : 1790000005000 }));
  return undefined;
};

describe("POST /api/email/sync", () => {
  it("first sync: the mailbox's clock, the first inbox page, metadata per id, the cache told to advance", async () => {
    await stubWorld({ gmail: listingGmail() });
    const r = await answer(await syncHandler(post("/api/email/sync", { email: DAVE })));
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, synced: 2, removed: 0, next_page: "p2", complete: false, resynced: false, last_sync_at: "2026-10-03T12:00:00Z" });
    expect(gmailCalls()[0]).toBe("GET /profile");
    expect(gmailCalls()[1]).toBe(`GET /messages?labelIds=INBOX&maxResults=${INBOX_PAGE}`);
    expect(gmailCalls().filter((c) => c.includes("format=metadata")).length).toBe(2);
    const apply = rpc("email_sync_apply")[0]!;
    expect(apply).toMatchObject({ p_owner: USER, p_account: "acct-dave", p_cursor: "h200", p_advance: true, p_removed: [] });
    const rows = apply.p_messages as Array<Record<string, unknown>>;
    expect(rows.map((x) => x.provider_id).sort()).toEqual(["m1", "m2"]);
    expect(rows[0]).toMatchObject({ from_address: "billing@conedison.test", from_name: "Con Edison", subject: "Your bill", snippet: "Amount & due", labels: ["INBOX", "UNREAD"] });
    expect(typeof rows[0]!.internal_date).toBe("string");
    expect(JSON.stringify(r.json)).not.toMatch(/ya29|1\/\/refresh/);
  });

  it("the next page: appended, cursor and freshness untouched", async () => {
    await stubWorld({ gmail: listingGmail() });
    const r = await answer(await syncHandler(post("/api/email/sync", { email: DAVE, page: "p2" })));
    expect(r.json).toMatchObject({ ok: true, synced: 1, next_page: null, complete: true });
    expect(gmailCalls().some((c) => c.startsWith("GET /profile"))).toBe(false);
    expect(rpc("email_sync_apply")[0]).toMatchObject({ p_cursor: null, p_advance: false });
  });

  it("a refresh from the cursor reads history: added and relabelled ids are fetched, deleted ids removed, the new cursor kept", async () => {
    await stubWorld({ cursor: { [DAVE]: "h100", [WORK]: null }, gmail: listingGmail() });
    const r = await answer(await syncHandler(post("/api/email/sync", { email: DAVE })));
    expect(r.json).toMatchObject({ ok: true, synced: 2, removed: 1, resynced: false });
    expect(gmailCalls()[0]).toMatch(/^GET \/history\?startHistoryId=h100/);
    const fetched = gmailCalls().filter((c) => c.includes("format=metadata")).map((c) => /messages\/([^?]+)/.exec(c)![1]).sort();
    expect(fetched).toEqual(["m2", "m7"]);
    expect(rpc("email_sync_apply")[0]).toMatchObject({ p_cursor: "h300", p_advance: true, p_removed: ["m1"] });
  });

  it("an expired cursor (Gmail 404) is a full resync of the first page, said so", async () => {
    await stubWorld({ cursor: { [DAVE]: "h-old", [WORK]: null }, gmail: listingGmail({ history: res({ error: "expired" }, 404) }) });
    const r = await answer(await syncHandler(post("/api/email/sync", { email: DAVE })));
    expect(r.json).toMatchObject({ ok: true, resynced: true, synced: 2 });
    expect(gmailCalls()[1]).toBe("GET /profile");
    expect(rpc("email_sync_apply")[0]).toMatchObject({ p_cursor: "h200", p_advance: true });
  });

  it("a Gmail outage is retried three times for a safe read, then recorded, leaving the cache as it was", async () => {
    let n = 0;
    await stubWorld({ gmail: (_m, path) => { if (path.startsWith("/profile")) { n++; return res({ error: "down" }, 503); } return undefined; } });
    const r = await answer(await syncHandler(post("/api/email/sync", { email: DAVE })));
    expect(r.status).toBe(503);
    expect(r.json).toMatchObject({ code: "UNAVAILABLE", retryable: true });
    expect(n).toBe(3);
    expect(rpc("email_sync_apply")).toEqual([]);
    expect(rpc("email_sync_failed")[0]).toMatchObject({ p_account: "acct-dave", p_reauth: false });
  });

  it("a mailbox with no stored sign-in needs reconnecting: 410, recorded as reauth, no Gmail call", async () => {
    await stubWorld({ tokens: {} });
    const r = await answer(await syncHandler(post("/api/email/sync", { email: DAVE })));
    expect(r.status).toBe(410);
    expect(r.json).toMatchObject({ code: "PROVIDER_AUTH" });
    expect(gmailCalls()).toEqual([]);
    expect(rpc("email_sync_failed")[0]).toMatchObject({ p_reauth: true });
  });

  it("an address with no stored sign-in and no mailbox row creates nothing: 410, no account row made, no reauth recorded", async () => {
    await stubWorld({ tokens: {} });
    const r = await answer(await syncHandler(post("/api/email/sync", { email: "nobody@example.test" })));
    expect(r.status).toBe(410);
    expect(r.json).toMatchObject({ code: "PROVIDER_AUTH" });
    expect(rpc("email_account_upsert")).toEqual([]);
    expect(rpc("email_sync_failed")).toEqual([]);
    expect(gmailCalls()).toEqual([]);
  });

  it("a revoked grant at Google's door is the same answer", async () => {
    await stubWorld({ gmail: listingGmail(), token: () => res({ error: "invalid_grant" }, 400) });
    const r = await answer(await syncHandler(post("/api/email/sync", { email: DAVE })));
    expect(r.status).toBe(410);
    expect(r.json).toMatchObject({ code: "PROVIDER_AUTH" });
    // Terminal: Google was asked once, and the revocation path moved the mailbox to reauth.
    expect(calls.filter((c) => c.url.includes("oauth2.googleapis.com/token"))).toHaveLength(1);
    expect(rpc("email_account_state").some((b) => b.p_state === "reauth")).toBe(true);
  });

  it("a DEAD sign-in is answered as no sign-in: PROVIDER_AUTH, Google never asked, the mailbox never upserted back to connected", async () => {
    const f = await stubWorld({ gmail: listingGmail() });
    const inner = f.getMockImplementation()!;
    f.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/rest/v1/google_tokens") && url.includes("email=")) {
        calls.push({ url, method: "GET", body: null });
        return res([{ email: DAVE, state: "DEAD", token_enc: await encrypt("1//dead", KEY), access_enc: null, access_expires_at: null }]);
      }
      return inner(url, init);
    });
    const r = await answer(await syncHandler(post("/api/email/sync", { email: DAVE })));
    expect(r.status).toBe(410);
    expect(r.json).toMatchObject({ code: "PROVIDER_AUTH" });
    expect(calls.some((c) => c.url.includes("oauth2.googleapis.com"))).toBe(false);
    expect(rpc("email_account_upsert")).toEqual([]);
  });

  it("refuses without a session, with a bad payload, and with the wrong method", async () => {
    await stubWorld({});
    expect((await syncHandler(post("/api/email/sync", { email: DAVE }, null))).status).toBe(401);
    expect((await syncHandler(post("/api/email/sync", { email: "not-an-address" }))).status).toBe(422);
    expect((await syncHandler(new Request("https://x.test/api/email/sync"))).status).toBe(405);
  });
});

describe("POST /api/email/message", () => {
  const cached = { m1: { id: MSG, subject: "Your bill", provider_labels: ["INBOX", "UNREAD"], attachment_metadata: [{ filename: "bill.pdf", mime: "application/pdf", attachmentId: "att1", size: 1200 }] } };
  const full = { id: "m1", threadId: "thr-m1", labelIds: ["INBOX", "UNREAD"], payload: { mimeType: "multipart/mixed", headers: meta("m1").payload.headers, parts: [
    { mimeType: "text/plain", body: { data: Buffer.from("Amount due $142.30").toString("base64url") } },
    { mimeType: "text/html", body: { data: Buffer.from("<p>Amount due <b>$142.30</b></p><script>alert(1)</script>").toString("base64url") } },
    { mimeType: "application/pdf", filename: "bill.pdf", body: { attachmentId: "att1", size: 1200 } },
  ] } };

  it("open reads the full message in and stores text, html as sent, attachment metadata and the current labels", async () => {
    await stubWorld({ cached, gmail: (_m, path) => path.startsWith("/messages/m1?format=full") ? res(full) : undefined });
    const r = await answer(await messageHandler(post("/api/email/message", { email: DAVE, id: "m1", op: "open" })));
    expect(r.json).toMatchObject({ ok: true, message_id: MSG, attachments: 1, labels: ["INBOX", "UNREAD"] });
    const store = rpc("email_body_store")[0]!;
    expect(store).toMatchObject({ p_owner: USER, p_message: MSG, p_text: "Amount due $142.30" });
    expect(store.p_html).toContain("<script>");
    expect(store.p_attachments).toEqual([{ filename: "bill.pdf", mime: "application/pdf", attachmentId: "att1", size: 1200 }]);
    expect(rpc("email_labels_set")[0]).toMatchObject({ p_labels: ["INBOX", "UNREAD"] });
    expect(rpc("email_action_record")).toEqual([]);
  });

  it("read removes UNREAD through a modify, mirrors Gmail's answer, writes no receipt", async () => {
    await stubWorld({ cached, gmail: (m, path) => m === "POST" && path === "/messages/m1/modify" ? res({ id: "m1", labelIds: ["INBOX"] }) : undefined });
    const r = await answer(await messageHandler(post("/api/email/message", { email: DAVE, id: "m1", op: "read" })));
    expect(r.json).toMatchObject({ ok: true, read: true, in_inbox: true, labels: ["INBOX"], receipt: null });
    const modify = calls.find((c) => c.url.endsWith("/messages/m1/modify"))!;
    expect(modify.body).toEqual({ addLabelIds: [], removeLabelIds: ["UNREAD"] });
    expect(rpc("email_labels_set")[0]).toMatchObject({ p_message: MSG, p_labels: ["INBOX"] });
    expect(rpc("email_action_record")).toEqual([]);
  });

  it("the cache follows Gmail, not the request: an unread that Gmail answers as read stays read", async () => {
    await stubWorld({ cached, gmail: (m, path) => m === "POST" && path === "/messages/m1/modify" ? res({ id: "m1", labelIds: ["INBOX"] }) : undefined });
    const r = await answer(await messageHandler(post("/api/email/message", { email: DAVE, id: "m1", op: "unread" })));
    expect(r.json).toMatchObject({ read: true, labels: ["INBOX"] });
    expect(rpc("email_labels_set")[0]).toMatchObject({ p_labels: ["INBOX"] });
  });

  it("archive removes INBOX and writes one receipt with the provider's answer and the command as its key", async () => {
    await stubWorld({ cached, gmail: (m, path) => m === "POST" && path === "/messages/m1/modify" ? res({ id: "m1", labelIds: ["UNREAD"] }) : undefined });
    const r = await answer(await messageHandler(post("/api/email/message", { email: DAVE, id: "m1", op: "archive" })));
    expect(r.json).toMatchObject({ ok: true, in_inbox: false, receipt: "act-1" });
    expect(calls.find((c) => c.url.endsWith("/modify"))!.body).toEqual({ addLabelIds: [], removeLabelIds: ["INBOX"] });
    expect(rpc("email_action_record")[0]).toMatchObject({ p_owner: USER, p_message: MSG, p_kind: "archive_mail", p_verb: "Archived · Your bill", p_idempotency: `archive_mail:${MSG}:UNREAD`, p_provider_ack: { labelIds: ["UNREAD"] } });
  });

  it("trash and untrash use Gmail's reversible verbs; unarchive puts INBOX back; each is its own receipt kind", async () => {
    await stubWorld({ cached, gmail: (m, path) => {
      if (m === "POST" && path === "/messages/m1/trash") return res({ id: "m1", labelIds: ["TRASH"] });
      if (m === "POST" && path === "/messages/m1/untrash") return res({ id: "m1", labelIds: ["INBOX", "UNREAD"] });
      if (m === "POST" && path === "/messages/m1/modify") return res({ id: "m1", labelIds: ["INBOX", "UNREAD"] });
      return undefined;
    } });
    expect((await answer(await messageHandler(post("/api/email/message", { email: DAVE, id: "m1", op: "trash" })))).json).toMatchObject({ in_trash: true, in_inbox: false });
    expect((await answer(await messageHandler(post("/api/email/message", { email: DAVE, id: "m1", op: "untrash" })))).json).toMatchObject({ in_trash: false, in_inbox: true });
    expect((await answer(await messageHandler(post("/api/email/message", { email: DAVE, id: "m1", op: "unarchive" })))).json).toMatchObject({ in_inbox: true });
    expect(calls.find((c) => c.url.endsWith("/modify"))!.body).toEqual({ addLabelIds: ["INBOX"], removeLabelIds: [] });
    expect(rpc("email_action_record").map((x) => x.p_kind)).toEqual(["trash_mail", "untrash_mail", "unarchive_mail"]);
    expect(gmailCalls().some((c) => /delete/i.test(c))).toBe(false);
  });

  it("a message that is not in the person's cache is not fetched from an id it was handed", async () => {
    await stubWorld({ cached: {}, gmail: () => res({}) });
    const r = await answer(await messageHandler(post("/api/email/message", { email: DAVE, id: "stranger", op: "open" })));
    expect(r.status).toBe(404);
    expect(gmailCalls()).toEqual([]);
  });

  it("refuses an operation it does not have (there is no permanent delete)", async () => {
    await stubWorld({ cached });
    expect((await messageHandler(post("/api/email/message", { email: DAVE, id: "m1", op: "delete" }))).status).toBe(422);
  });
});

describe("POST /api/email/search", () => {
  it("quotes the person's words as one literal phrase and drops the quote character itself", () => {
    expect(literalQuery('  con  "edison" bill ')).toBe('"con edison bill"');
    expect(literalQuery('"""')).toBe("");
  });

  it("asks every connected account with the quoted phrase, caches the hits without moving freshness, merges newest first with a stable tiebreak", async () => {
    await stubWorld({
      cached: { m1: { id: "u-m1", subject: "Your bill", provider_labels: ["INBOX"] }, m2: { id: "u-m2", subject: "Bill again", provider_labels: ["INBOX", "UNREAD"] } },
      gmail: (_m, path) => {
        if (path.startsWith("/messages?q=")) { const u = new URL("https://g.test" + path); expect(u.searchParams.get("q")).toBe('"bill"'); return res({ messages: [{ id: "m1" }, { id: "m2" }] }); }
        const m = /^\/messages\/([^/?]+)\?format=metadata/.exec(path);
        return m ? res(meta(m[1]!)) : undefined;
      },
    });
    const r = await answer(await searchHandler(post("/api/email/search", { q: "bill" })));
    expect(r.json).toMatchObject({ ok: true, q: '"bill"', coverage: "provider", covered: [DAVE, WORK], failed: [], next_page: null });
    const rows = r.json.rows as Array<{ provider_id: string; account: string; read: boolean }>;
    // Same second in both mailboxes: id descending first, and a stable sort keeps the first account's row ahead.
    expect(rows.map((x) => x.provider_id)).toEqual(["m2", "m2", "m1", "m1"]);
    expect(rows[0]).toMatchObject({ account: DAVE, read: false });
    expect(rows[1]).toMatchObject({ account: WORK });
    for (const a of rpc("email_sync_apply")) expect(a).toMatchObject({ p_advance: false, p_cursor: null });
  });

  it("one account that cannot answer is named as failed while the other is covered", async () => {
    const f = await stubWorld({ cached: {}, gmail: (_m, path) => path.startsWith("/messages?q=") ? res({ messages: [] }) : undefined });
    // The second mailbox's stored sign-in cannot be read any more: Google refuses the refresh.
    f.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      calls.push({ url, method, body });
      if (url.includes("/auth/v1/user")) return res({ id: USER });
      if (url.includes("/rest/v1/google_tokens") && !url.includes("email=")) return res([{ email: DAVE }, { email: WORK }]);
      if (url.includes("/rest/v1/google_tokens")) return res([{ token_enc: await encrypt(url.includes(encodeURIComponent(WORK)) ? "1//dead" : "1//refresh", KEY) }]);
      if (url.includes("oauth2.googleapis.com/token")) return String(init?.body).includes("1%2F%2Fdead") ? res({ error: "invalid_grant" }, 400) : res({ access_token: "ya29.secret", expires_in: 3599 });
      if (url.includes("/rest/v1/rpc/email_account_upsert")) return res({ account_id: ACCT[String(body?.p_address)] });
      if (url.includes("/rest/v1/email_account?")) return res([{ id: "acct", cursor: null, state: "connected" }]);
      if (url.includes("/rest/v1/rpc/email_sync_apply")) return res({ upserted: 0 });
      if (url.includes("gmail.googleapis.com")) return res({ messages: [] });
      if (url.includes("/rest/v1/rpc/google_") || url.includes("/rest/v1/rpc/email_account_state")) return res({}, 404);
      throw new Error("unexpected " + url);
    });
    const r = await answer(await searchHandler(post("/api/email/search", { q: "bill" })));
    expect(r.json).toMatchObject({ covered: [DAVE], failed: [{ email: WORK, code: "PROVIDER_AUTH" }] });
  });

  it("a named account is the only one asked; an empty query is refused", async () => {
    await stubWorld({ cached: {}, gmail: (_m, path) => path.startsWith("/messages?q=") ? res({ messages: [] }) : undefined });
    const r = await answer(await searchHandler(post("/api/email/search", { q: "bill", email: WORK })));
    expect(r.json).toMatchObject({ covered: [WORK] });
    expect(gmailCalls().length).toBe(1);
    expect((await searchHandler(post("/api/email/search", { q: "   " }))).status).toBe(422);
  });
});

describe("POST /api/email/attachment", () => {
  const cached = { m1: { id: MSG, subject: "Your bill", provider_labels: ["INBOX"], attachment_metadata: [{ filename: "bill.pdf", mime: "application/pdf", attachmentId: "att1", size: 1200 }, { filename: "huge.zip", mime: "application/zip", attachmentId: "att9", size: 50 * 1024 * 1024 }] } };

  it("hands back the bytes Gmail holds, with the name and type the cache knows", async () => {
    await stubWorld({ cached, gmail: (_m, path) => path === "/messages/m1/attachments/att1" ? res({ data: "aGVsbG8", size: 5 }) : undefined });
    const r = await answer(await attachmentHandler(post("/api/email/attachment", { email: DAVE, id: "m1", attachmentId: "att1" })));
    expect(r.json).toEqual({ ok: true, filename: "bill.pdf", mime: "application/pdf", size: 5, data: "aGVsbG8" });
  });

  it("an attachment the message's metadata does not name is not fetched; one over the cap is refused before any fetch", async () => {
    await stubWorld({ cached, gmail: () => res({ data: "x" }) });
    expect((await attachmentHandler(post("/api/email/attachment", { email: DAVE, id: "m1", attachmentId: "someone-elses" }))).status).toBe(404);
    const big = await answer(await attachmentHandler(post("/api/email/attachment", { email: DAVE, id: "m1", attachmentId: "att9" })));
    expect(big.status).toBe(413);
    expect(big.json).toMatchObject({ code: "STORAGE_LIMIT" });
    expect(gmailCalls()).toEqual([]);
  });
});

describe("POST /api/email/accounts", () => {
  it("a DEAD sign-in (Google revoked it, the row is kept) is mirrored as reauth and is NEVER upserted back to connected", async () => {
    const enc = await encrypt("1//refresh", KEY);
    const f = await stubWorld({ tokens: { [DAVE]: enc }, accountRows: [{ id: "acct-dave", address: DAVE, state: "connected" }] });
    const inner = f.getMockImplementation()!;
    f.mockImplementation(async (url: string, init?: RequestInit) => {
      // The sign-in list now carries each row's lifecycle state.
      if (url.includes("/rest/v1/google_tokens") && !url.includes("email=")) { calls.push({ url, method: "GET", body: null }); return res([{ email: DAVE, state: "DEAD" }]); }
      return inner(url, init);
    });
    const r = await answer(await accountsHandler(post("/api/email/accounts", {})));
    expect(r.json).toEqual({ ok: true, mirrored: [], reauth: [DAVE], disconnected: [] });
    expect(rpc("email_account_upsert")).toEqual([]);
    expect(rpc("email_account_state")).toEqual([{ p_owner: USER, p_account: "acct-dave", p_state: "reauth", p_error: "Reconnect Gmail to continue." }]);
  });

  it("a DEAD sign-in whose mailbox row is already reauth changes nothing", async () => {
    const enc = await encrypt("1//refresh", KEY);
    const f = await stubWorld({ tokens: { [DAVE]: enc }, accountRows: [{ id: "acct-dave", address: DAVE, state: "reauth" }] });
    const inner = f.getMockImplementation()!;
    f.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/rest/v1/google_tokens") && !url.includes("email=")) { calls.push({ url, method: "GET", body: null }); return res([{ email: DAVE, state: "DEAD" }]); }
      return inner(url, init);
    });
    const r = await answer(await accountsHandler(post("/api/email/accounts", {})));
    expect(r.json).toEqual({ ok: true, mirrored: [], reauth: [DAVE], disconnected: [] });
    expect(rpc("email_account_state")).toEqual([]);
  });

  it("mirrors every stored sign-in into an account row and marks the rows whose sign-in is gone as disconnected", async () => {
    const enc = await encrypt("1//refresh", KEY);
    await stubWorld({ tokens: { [DAVE]: enc }, accountRows: [{ id: "acct-dave", address: DAVE, state: "connected" }, { id: "acct-work", address: WORK, state: "connected" }, { id: "acct-old", address: "old@gmail.com", state: "disconnected" }] });
    const r = await answer(await accountsHandler(post("/api/email/accounts", {})));
    expect(r.json).toEqual({ ok: true, mirrored: [DAVE], reauth: [], disconnected: [WORK] });
    expect(rpc("email_account_upsert")[0]).toMatchObject({ p_owner: USER, p_address: DAVE, p_capabilities: { archive: true, trash: true, read: true } });
    expect(rpc("email_account_state")).toEqual([{ p_owner: USER, p_account: "acct-work", p_state: "disconnected", p_error: null }]);
  });
});

describe("sync honesty (Email spec section 8, AC40, AC41)", () => {
  it("a Gmail quota 403 is RATE_LIMITED and is not recorded as a reconnect (AC41)", async () => {
    await stubWorld({ gmail: (_m, path) => (path.startsWith("/profile") ? res({ error: { code: 403, status: "PERMISSION_DENIED", errors: [{ reason: "userRateLimitExceeded" }] } }, 403) : undefined) });
    const r = await answer(await syncHandler(post("/api/email/sync", { email: DAVE })));
    expect(r.status).toBe(429);
    expect(r.json).toMatchObject({ code: "RATE_LIMITED", retryable: true });
    expect(rpc("email_sync_failed")[0]).toMatchObject({ p_reauth: false });
  });

  it("a Gmail 403 with no quota reason is still the grant", async () => {
    await stubWorld({ gmail: (_m, path) => (path.startsWith("/profile") ? res({ error: { errors: [{ reason: "insufficientPermissions" }] } }, 403) : undefined) });
    const r = await answer(await syncHandler(post("/api/email/sync", { email: DAVE })));
    expect(r.status).toBe(410);
    expect(r.json).toMatchObject({ code: "PROVIDER_AUTH" });
    expect(rpc("email_sync_failed")[0]).toMatchObject({ p_reauth: true });
  });

  it("a history read cut off at the page bound applies what it saw but leaves the cursor where it was (AC40)", async () => {
    await stubWorld({
      cursor: { [DAVE]: "h100", [WORK]: null },
      gmail: (_m, path) => {
        if (path.startsWith("/history")) return res({ history: [{ messagesAdded: [{ message: { id: "m7" } }] }], historyId: "h999", nextPageToken: "more" });
        return listingGmail()(_m, path);
      },
    });
    const r = await answer(await syncHandler(post("/api/email/sync", { email: DAVE })));
    expect(r.json).toMatchObject({ ok: true, truncated: true });
    expect(gmailCalls().filter((c) => c.startsWith("GET /history")).length).toBe(20);
    expect(rpc("email_sync_apply")[0]).toMatchObject({ p_cursor: null, p_advance: true });
  });

  it("a history read that reaches the end moves the cursor, and says it was not cut off", async () => {
    await stubWorld({ cursor: { [DAVE]: "h100", [WORK]: null }, gmail: listingGmail() });
    const r = await answer(await syncHandler(post("/api/email/sync", { email: DAVE })));
    expect(r.json).toMatchObject({ ok: true, truncated: false });
    expect(rpc("email_sync_apply")[0]).toMatchObject({ p_cursor: "h300" });
  });
});
