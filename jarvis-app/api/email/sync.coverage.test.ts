// THE COVERAGE CRAWL, END TO END OVER A FAKE GMAIL AND A FAKE DATABASE (Email v1 spec 2026-10-08, sections 8.1 and 8.3;
// AC39 "OAuth succeeds but history incomplete -> Connected + Catching up; not Current", AC40 "Expired checkpoint /
// interrupted pages -> safe resync; stable IDs; no premature freshness advancement"). The real handler runs. The database
// is a small in-memory model of migration 0065's functions with the same guards (epoch, expected page token, every label
// listed before completion), so what the route SENDS and what the account ends up saying are both held here; the real
// functions are proven on Postgres by jarvis-core/supabase/tests/email_coverage.sh.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import syncHandler, { COVERAGE_DAYS, CRAWL_MAX_PAGES, CRAWL_PAGE } from "./sync";
import { encrypt } from "../_google";

const KEY = Buffer.alloc(32, 7).toString("base64");
const USER = "user-1";
const DAVE = "dave@gmail.com";
const ACCT = "acct-dave";

const res = (body: unknown, status = 200): Response => ({ ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body }) as Response;
const meta = (id: string, labels: string[]) => ({
  id, threadId: `thr-${id}`, historyId: "h5", internalDate: "1790000000000", snippet: "s", labelIds: labels,
  payload: { headers: [{ name: "From", value: "A <a@x.test>" }, { name: "To", value: DAVE }, { name: "Subject", value: `Subject ${id}` }] },
});

interface Progress { next: string | null; done: boolean; listed: number }
interface Crawl { epoch: number; history_id: string; order: string[]; labels: Record<string, Progress> }

/** Migration 0065's functions, as a model: the same refusals, the same state. */
class Db {
  sync_state = "not_started";
  sync_epoch = 0;
  coverage_start: string | null = null;
  verified_through_at: string | null = null;
  last_sync_at: string | null = null;
  cursor: string | null = null;
  crawl: Crawl | null = null;
  rows = new Map<string, string[]>();
  removed = new Set<string>();
  json() { return { account_id: ACCT, sync_state: this.sync_state, sync_epoch: this.sync_epoch, coverage_start: this.coverage_start, verified_through_at: this.verified_through_at, last_sync_at: this.last_sync_at, cursor: this.cursor, crawl: this.crawl ? JSON.parse(JSON.stringify(this.crawl)) : null }; }
  apply(msgs: Array<{ provider_id: string; labels: string[] }>, gone: string[], cursor: string | null, advance: boolean) {
    for (const m of msgs) this.rows.set(m.provider_id, m.labels);
    for (const g of gone) { this.rows.delete(g); this.removed.add(g); }
    if (advance) { this.last_sync_at = "2026-10-10T12:00:00Z"; this.cursor = cursor ?? this.cursor; }
  }
  call(fn: string, b: Record<string, unknown>): Response {
    const msgs = (b.p_messages ?? []) as Array<{ provider_id: string; labels: string[] }>;
    switch (fn) {
      case "email_coverage_state": return res(this.json());
      case "email_coverage_begin": {
        const labels = b.p_labels as string[];
        this.sync_epoch++;
        this.sync_state = "catching_up";
        this.coverage_start = new Date(Date.now() - (b.p_days as number) * 86400e3).toISOString();
        this.crawl = { epoch: this.sync_epoch, history_id: String(b.p_history_id), order: labels, labels: Object.fromEntries(labels.map((l) => [l, { next: null, done: false, listed: 0 }])) };
        return res(this.json());
      }
      case "email_coverage_page": {
        const lp = this.crawl?.labels[String(b.p_label)];
        if (!this.crawl || this.sync_epoch !== b.p_epoch || !lp || lp.done || lp.next !== (b.p_page ?? null)) return res({ error: "STALE_PAGE", state: this.json() });
        this.apply(msgs, (b.p_removed ?? []) as string[], null, false);
        this.crawl.labels[String(b.p_label)] = { next: (b.p_next as string | null) ?? null, done: b.p_next == null, listed: lp.listed + msgs.length };
        return res({ upserted: msgs.length, removed: ((b.p_removed ?? []) as string[]).length, state: this.json() });
      }
      case "email_coverage_complete": {
        if (!this.crawl || this.sync_epoch !== b.p_epoch) return res({ error: "STALE_PAGE", state: this.json() });
        if (Object.values(this.crawl.labels).some((l) => !l.done)) return res({ error: "NOT_LISTED", state: this.json() });
        this.apply(msgs, (b.p_removed ?? []) as string[], String(b.p_cursor), true);
        this.sync_state = "current"; this.verified_through_at = "2026-10-10T12:00:00Z"; this.crawl = null;
        return res({ upserted: msgs.length, removed: ((b.p_removed ?? []) as string[]).length, last_sync_at: this.last_sync_at, state: this.json() });
      }
      case "email_coverage_checked": {
        if (this.crawl || this.sync_epoch !== b.p_epoch) return res({ error: "STALE_PAGE", state: this.json() });
        if (!this.verified_through_at) return res({ error: "NOT_LISTED", state: this.json() });
        this.sync_state = b.p_complete ? "current" : "catching_up";
        if (b.p_complete) this.verified_through_at = "2026-10-10T12:30:00Z";
        return res({ state: this.json() });
      }
    }
    throw new Error("unexpected rpc " + fn);
  }
}

type Call = { url: string; method: string; body: Record<string, unknown> | null };
let calls: Call[] = [];
let db: Db;
const rpc = (fn: string) => calls.filter((c) => c.url.includes(`/rest/v1/rpc/${fn}`)).map((c) => c.body!);
const gmailCalls = () => calls.filter((c) => c.url.includes("gmail.googleapis.com")).map((c) => c.url.replace("https://gmail.googleapis.com/gmail/v1/users/me", ""));
const lists = () => gmailCalls().filter((p) => p.startsWith("/messages?")).map((p) => new URL("https://g.test" + p).searchParams);

/** A mailbox: per label, its pages of ids (token "LABEL:n" is page n); its history since the checkpoint. */
interface Mailbox {
  pages: Record<string, string[][]>;
  profile?: string;
  history?: (label: string, start: string, pageToken: string | null) => Response;
  meta?: (id: string) => Response | undefined;
  list?: (label: string, pageToken: string | null) => Response | undefined;
}

async function stub(box: Mailbox) {
  const enc = await encrypt("1//refresh", KEY);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ url, method, body });
    const u = new URL(url, "https://x.test");
    if (url.includes("/auth/v1/user")) return res({ id: USER });
    if (url.includes("oauth2.googleapis.com/token")) return res({ access_token: "ya29.secret", expires_in: 3599 });
    if (url.includes("/rest/v1/google_tokens")) return res([{ email: DAVE, token_enc: enc }]);
    if (url.includes("/rest/v1/rpc/email_account_upsert")) return res({ account_id: ACCT });
    if (url.includes("/rest/v1/email_account?")) return res([{ id: ACCT, cursor: db.cursor, state: "connected" }]);
    if (url.includes("/rest/v1/rpc/email_sync_apply")) {
      db.apply((body!.p_messages ?? []) as Array<{ provider_id: string; labels: string[] }>, (body!.p_removed ?? []) as string[], (body!.p_cursor as string | null) ?? null, !!body!.p_advance);
      return res({ account_id: ACCT, upserted: (body!.p_messages as unknown[]).length, removed: 0, last_sync_at: db.last_sync_at });
    }
    if (url.includes("/rest/v1/rpc/email_sync_failed")) return res({ recorded: true });
    const fn = /\/rest\/v1\/rpc\/(email_coverage_\w+)/.exec(url)?.[1];
    if (fn) return db.call(fn, body ?? {});
    if (url.includes("/rest/v1/rpc/google_")) return res({}, 404);
    if (url.includes("gmail.googleapis.com")) {
      const path = url.replace("https://gmail.googleapis.com/gmail/v1/users/me", "");
      if (path.startsWith("/profile")) return res({ emailAddress: DAVE, historyId: box.profile ?? "h200" });
      if (path.startsWith("/history")) {
        const label = u.searchParams.get("labelId")!;
        return box.history ? box.history(label, u.searchParams.get("startHistoryId")!, u.searchParams.get("pageToken")) : res({ history: [], historyId: "h300" });
      }
      if (path.startsWith("/messages?")) {
        const label = u.searchParams.get("labelIds")!;
        const tok = u.searchParams.get("pageToken");
        const custom = box.list?.(label, tok);
        if (custom) return custom;
        const n = tok ? Number(tok.split(":")[1]) : 0;
        const pages = box.pages[label] ?? [];
        return res({ messages: (pages[n] ?? []).map((id) => ({ id })), ...(n + 1 < pages.length ? { nextPageToken: `${label}:${n + 1}` } : {}) });
      }
      const m = /^\/messages\/([^/?]+)\?format=metadata/.exec(path);
      if (m) {
        const custom = box.meta?.(m[1]!);
        if (custom) return custom;
        const label = Object.entries(box.pages).find(([, ps]) => ps.some((p) => p.includes(m[1]!)))?.[0] ?? "INBOX";
        return res(meta(m[1]!, [label]));
      }
    }
    throw new Error("unexpected " + method + " " + url);
  }));
}

const post = (body: unknown) => new Request("https://x.test/api/email/sync", { method: "POST", headers: { authorization: "Bearer jwt", "content-type": "application/json" }, body: JSON.stringify(body) });
const sync = async (body: unknown = { email: DAVE }) => { const r = await syncHandler(post(body)); return { status: r.status, json: (await r.json()) as Record<string, unknown> }; };
/** n pages of two ids each, for one label. */
const pagesOf = (label: string, n: number): string[][] => Array.from({ length: n }, (_, i) => [`${label[0]}${i}a`, `${label[0]}${i}b`]);

beforeEach(() => {
  calls = [];
  db = new Db();
  vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "web.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "shh");
  vi.stubEnv("GOOGLE_TOKEN_KEY", KEY);
  vi.stubEnv("VITE_SUPABASE_URL", "https://supa.test");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("the first sync is a coverage crawl, not a freshness claim (AC39)", () => {
  it("takes the history checkpoint first, starts catching_up, and does NOT mark current or advance freshness after the first pages", async () => {
    await stub({ pages: { INBOX: pagesOf("INBOX", CRAWL_MAX_PAGES + 2), SENT: pagesOf("SENT", 1) } });
    const r = await sync();
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, coverage_complete: false, sync_state: "catching_up", next_page: null, last_sync_at: null });
    // The mailbox's clock is read before anything is listed, and kept as the crawl's checkpoint.
    expect(gmailCalls()[0]).toBe("/profile");
    expect(rpc("email_coverage_begin")[0]).toMatchObject({ p_history_id: "h200", p_labels: ["INBOX", "SENT"], p_days: COVERAGE_DAYS });
    // A bounded number of pages per call, every one applied through the crawl's own door, never through the freshness one.
    expect(rpc("email_coverage_page")).toHaveLength(CRAWL_MAX_PAGES);
    expect(rpc("email_sync_apply")).toEqual([]);
    expect(rpc("email_coverage_complete")).toEqual([]);
    expect(db.sync_state).toBe("catching_up");
    expect(db.last_sync_at).toBeNull();
    expect(db.verified_through_at).toBeNull();
    expect(db.cursor).toBeNull();
    expect(db.crawl!.labels.INBOX).toEqual({ next: `INBOX:${CRAWL_MAX_PAGES}`, done: false, listed: CRAWL_MAX_PAGES * 2 });
    expect(JSON.stringify(r.json)).not.toMatch(/ya29|1\/\/refresh/);
  });

  it("lists Inbox and then Sent, each inside the 90-day window, a page at a time", async () => {
    await stub({ pages: { INBOX: pagesOf("INBOX", 2), SENT: pagesOf("SENT", 2) } });
    await sync();
    const l = lists();
    expect(l.map((p) => p.get("labelIds"))).toEqual(["INBOX", "INBOX", "SENT", "SENT"]);
    const after = l.map((p) => Number(/^after:(\d+)$/.exec(p.get("q") ?? "")?.[1]));
    // One window for the whole crawl, so a page token stays valid between calls: 90 days back from the crawl's start.
    expect(new Set(after).size).toBe(1);
    expect(Math.abs(after[0]! * 1000 - (Date.now() - COVERAGE_DAYS * 86400e3))).toBeLessThan(60_000);
    expect(l.every((p) => p.get("maxResults") === String(CRAWL_PAGE))).toBe(true);
    expect(l.map((p) => p.get("pageToken"))).toEqual([null, "INBOX:1", null, "SENT:1"]);
    expect([...db.rows.keys()].sort()).toEqual(["I0a", "I0b", "I1a", "I1b", "S0a", "S0b", "S1a", "S1b"]);
  });

  it("an id in both Inbox and Sent, or twice on one page, is fetched once per page and kept as one row", async () => {
    await stub({ pages: { INBOX: [["x1", "x1", "x2"]], SENT: [["x2", "s9"]] } });
    await sync();
    const fetched = gmailCalls().filter((p) => p.includes("format=metadata")).map((p) => /messages\/([^?]+)/.exec(p)![1]);
    expect(fetched.filter((id) => id === "x1")).toHaveLength(1);
    expect([...db.rows.keys()].sort()).toEqual(["s9", "x1", "x2"]);
  });

  it("resumes from the persisted page on the next call, then reconciles from the checkpoint, and only then is current", async () => {
    await stub({
      pages: { INBOX: pagesOf("INBOX", CRAWL_MAX_PAGES + 2), SENT: pagesOf("SENT", 1) },
      // While the crawl ran: one message arrived, one was deleted. The history is read from the crawl's checkpoint, per label.
      history: (label, start) => {
        expect(start).toBe("h200");
        return label === "INBOX" ? res({ history: [{ messagesAdded: [{ message: { id: "new1" } }] }, { messagesDeleted: [{ message: { id: "I0a" } }] }], historyId: "h310" }) : res({ history: [], historyId: "h311" });
      },
    });
    const first = await sync();
    expect(first.json.coverage_complete).toBe(false);
    calls = [];
    const second = await sync();
    // Picked up exactly where the first call stopped; no second checkpoint, no restart.
    expect(lists()[0]!.get("pageToken")).toBe(`INBOX:${CRAWL_MAX_PAGES}`);
    expect(rpc("email_coverage_begin")).toEqual([]);
    expect(gmailCalls().some((p) => p === "/profile")).toBe(false);
    expect(gmailCalls().filter((p) => p.startsWith("/history")).map((p) => new URL("https://g.test" + p).searchParams.get("labelId"))).toEqual(["INBOX", "SENT"]);
    expect(rpc("email_coverage_complete")[0]).toMatchObject({ p_epoch: 1, p_cursor: "h310", p_removed: ["I0a"] });
    expect((rpc("email_coverage_complete")[0]!.p_messages as Array<{ provider_id: string }>).map((m) => m.provider_id)).toEqual(["new1"]);
    expect(second.json).toMatchObject({ ok: true, coverage_complete: true, sync_state: "current", last_sync_at: "2026-10-10T12:00:00Z" });
    expect(db).toMatchObject({ sync_state: "current", cursor: "h310", crawl: null, verified_through_at: "2026-10-10T12:00:00Z" });
    expect(db.rows.has("new1")).toBe(true);
    expect(db.rows.has("I0a")).toBe(false);
  });
});

describe("no premature freshness (AC40)", () => {
  it("an interrupted page (a metadata read that fails) writes nothing and the next call retries the same page", async () => {
    let broken = true;
    await stub({ pages: { INBOX: pagesOf("INBOX", 3), SENT: [] }, meta: (id) => (id === "I1b" && broken ? res({ error: "down" }, 503) : undefined) });
    const r = await sync();
    expect(r.status).toBe(503);
    // Page 0 is durable with its progress; page 1 wrote nothing, and its token is still the one awaited.
    expect(rpc("email_coverage_page").map((b) => b.p_page)).toEqual([null]);
    expect(db.crawl!.labels.INBOX).toMatchObject({ next: "INBOX:1", done: false, listed: 2 });
    expect(db.rows.has("I1a")).toBe(false);
    expect(db.last_sync_at).toBeNull();
    expect(rpc("email_sync_failed")[0]).toMatchObject({ p_account: ACCT, p_reauth: false });
    broken = false;
    calls = [];
    const again = await sync();
    expect(lists()[0]!.get("pageToken")).toBe("INBOX:1");
    expect(again.json).toMatchObject({ coverage_complete: true, sync_state: "current" });
  });

  it("completion waits for every label: a reconciliation cut off at its bound stays catching up and moves nothing", async () => {
    await stub({ pages: { INBOX: pagesOf("INBOX", 1), SENT: pagesOf("SENT", 1) }, history: () => res({ history: [], historyId: "h999", nextPageToken: "more" }) });
    const r = await sync();
    expect(r.json).toMatchObject({ coverage_complete: false, sync_state: "catching_up" });
    expect(rpc("email_coverage_complete")).toEqual([]);
    expect(db).toMatchObject({ sync_state: "catching_up", last_sync_at: null, cursor: null, verified_through_at: null });
    expect(db.crawl!.labels).toMatchObject({ INBOX: { done: true }, SENT: { done: true } });
  });

  it("a crawl that outlives Gmail's history restarts as a bounded full resync from a fresh checkpoint, keeping what is cached", async () => {
    await stub({ pages: { INBOX: pagesOf("INBOX", 1), SENT: [] }, history: () => res({ error: "gone" }, 404) });
    const first = await sync();
    expect(first.json).toMatchObject({ coverage_complete: false, sync_state: "catching_up", resynced: true });
    expect(db.sync_epoch).toBe(2);
    expect(db.crawl).toMatchObject({ epoch: 2, labels: { INBOX: { next: null, done: false } } });
    expect(db.rows.size).toBe(2);
    expect(db.last_sync_at).toBeNull();
    expect(rpc("email_coverage_begin")).toHaveLength(2);
  });

  it("a page token Gmail no longer takes restarts the crawl rather than skip what that page held", async () => {
    await stub({ pages: { INBOX: pagesOf("INBOX", 3), SENT: [] }, list: (_l, tok) => (tok === "INBOX:1" ? res({ error: "Invalid pageToken" }, 400) : undefined) });
    const r = await sync();
    expect(r.json).toMatchObject({ coverage_complete: false, resynced: true });
    expect(rpc("email_coverage_begin")).toHaveLength(2);
    expect(db.crawl!.labels.INBOX).toMatchObject({ next: null, done: false });
  });

  it("a page another call already applied is refused whole by the database, and this call stops without failing", async () => {
    await stub({ pages: { INBOX: pagesOf("INBOX", 3), SENT: [] } });
    db.call("email_coverage_begin", { p_history_id: "h200", p_labels: ["INBOX", "SENT"], p_days: 90 });
    // The other call moved the crawl on between this call's read of the state and its first page.
    const realCall = db.call.bind(db);
    let raced = false;
    db.call = (fn, b) => {
      if (fn === "email_coverage_page" && !raced) { raced = true; db.crawl!.labels.INBOX!.next = "INBOX:1"; }
      return realCall(fn, b);
    };
    const r = await sync();
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ coverage_complete: false, synced: 0 });
    expect(db.rows.size).toBe(0);
  });
});

describe("a mailbox already verified refreshes from its cursor, as before", () => {
  const verified = () => { db.sync_state = "current"; db.sync_epoch = 1; db.verified_through_at = "2026-10-09T09:00:00Z"; db.last_sync_at = "2026-10-09T09:00:00Z"; db.cursor = "h100"; };

  it("reads INBOX history from the cursor, applies it through the freshness door, and is current again", async () => {
    verified();
    await stub({ pages: {}, history: () => res({ history: [{ messagesAdded: [{ message: { id: "m7" } }] }], historyId: "h300" }) });
    const r = await sync();
    expect(gmailCalls()[0]).toMatch(/^\/history\?startHistoryId=h100&labelId=INBOX/);
    expect(rpc("email_sync_apply")[0]).toMatchObject({ p_cursor: "h300", p_advance: true });
    expect(rpc("email_coverage_checked")[0]).toMatchObject({ p_epoch: 1, p_complete: true });
    expect(r.json).toMatchObject({ ok: true, synced: 1, truncated: false, coverage_complete: true, sync_state: "current" });
    expect(lists()).toEqual([]);
  });

  it("a history read cut off at its bound leaves the cursor and is catching up, not current", async () => {
    verified();
    await stub({ pages: {}, history: () => res({ history: [], historyId: "h999", nextPageToken: "more" }) });
    const r = await sync();
    expect(rpc("email_sync_apply")[0]).toMatchObject({ p_cursor: null });
    expect(r.json).toMatchObject({ truncated: true, coverage_complete: false, sync_state: "catching_up" });
    expect(db.verified_through_at).toBe("2026-10-09T09:00:00Z");
  });

  it("an expired cursor (Gmail 404) restarts the crawl as catching_up and never claims freshness for it", async () => {
    verified();
    await stub({ pages: { INBOX: pagesOf("INBOX", CRAWL_MAX_PAGES + 1), SENT: [] }, history: () => res({ error: "expired" }, 404) });
    const r = await sync();
    expect(r.json).toMatchObject({ ok: true, resynced: true, coverage_complete: false, sync_state: "catching_up" });
    expect(rpc("email_coverage_begin")).toHaveLength(1);
    expect(db).toMatchObject({ sync_state: "catching_up", sync_epoch: 2, last_sync_at: "2026-10-09T09:00:00Z", cursor: "h100" });
  });

  it("a mailbox with a cursor but never verified (synced before coverage existed) crawls instead of refreshing", async () => {
    db.cursor = "h100";
    db.sync_state = "catching_up";
    await stub({ pages: { INBOX: pagesOf("INBOX", 1), SENT: [] } });
    const r = await sync();
    expect(gmailCalls()[0]).toBe("/profile");
    expect(r.json).toMatchObject({ coverage_complete: true, sync_state: "current" });
    expect(db.cursor).toBe("h300");
  });

  it("the next-page path is untouched by coverage: appended, no freshness, no coverage call", async () => {
    verified();
    await stub({ pages: {}, list: (label, tok) => (label === "INBOX" && tok === "p2" ? res({ messages: [{ id: "m3" }] }) : undefined) });
    const r = await sync({ email: DAVE, page: "p2" });
    expect(r.json).toMatchObject({ ok: true, synced: 1, next_page: null, complete: true, resynced: false });
    expect(rpc("email_sync_apply")[0]).toMatchObject({ p_cursor: null, p_advance: false });
    expect(calls.some((c) => c.url.includes("email_coverage_"))).toBe(false);
  });
});
