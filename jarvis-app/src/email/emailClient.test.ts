// THE EMAIL TAB'S READS AND COMMANDS (slice 05): the Gmail link's two honest
// shapes, the one order with its tiebreak, a merge that never duplicates,
// and the server's codes carried through as the command vocabulary.
import { describe, it, expect, vi, afterEach } from "vitest";
import { apiPost, gmailLink, inboxPage, mergeRows, newestFirst, type InboxRow, type RpcClient } from "./emailClient";

const row = (id: string, iso: string, extra: Partial<InboxRow> = {}): InboxRow => ({
  id, account_id: "a", account: "dave@example.test", provider_id: id, thread_id: id, internal_date: iso, from_address: "x@y.test", from_name: "",
  subject: "s", snippet: "", has_body: false, attachment_metadata: [], provider_labels: ["INBOX"], source_hash: "h", read: true, ...extra,
});

afterEach(() => vi.unstubAllGlobals());

describe("E20: the Gmail link", () => {
  it("is exact for the account and a hex thread id", () => {
    expect(gmailLink("dave@example.test", "18f2a9c4e1b7d3a2")).toEqual({ href: "https://mail.google.com/mail/?authuser=dave%40example.test#all/18f2a9c4e1b7d3a2", exact: true });
  });
  it("falls back to the account's Gmail, labelled as such, when the thread id is not Gmail's", () => {
    expect(gmailLink("dave@example.test", null)).toEqual({ href: "https://mail.google.com/mail/?authuser=dave%40example.test", exact: false });
    expect(gmailLink("dave@example.test", "t-a1").exact).toBe(false);
    expect(gmailLink("dave@example.test", "<script>").href).not.toContain("<");
  });
});

describe("E01: the order", () => {
  it("is newest first, equal timestamps by id descending, across accounts", () => {
    const rows = [row("a", "2026-10-03T10:00:00Z"), row("c", "2026-10-03T10:00:00Z", { account: "work@example.test" }), row("b", "2026-10-03T11:00:00Z")];
    expect([...rows].sort(newestFirst).map((r) => r.id)).toEqual(["b", "c", "a"]);
  });
  it("a merge keeps one row per id, the incoming facts winning, in the one order", () => {
    const merged = mergeRows([row("a", "2026-10-03T10:00:00Z", { read: false }), row("b", "2026-10-02T10:00:00Z")], [row("a", "2026-10-03T10:00:00Z", { read: true }), row("z", "2026-10-04T10:00:00Z")]);
    expect(merged.map((r) => r.id)).toEqual(["z", "a", "b"]);
    expect(merged[1]!.read).toBe(true);
  });
});

describe("the page call", () => {
  it("sends the keyset cursor the function expects, never an offset", async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const client: RpcClient = { rpc: async (fn, args) => { calls.push({ fn, args: args as Record<string, unknown> }); return { data: { rows: [], cached_total: 0, page: 30 }, error: null }; } };
    await inboxPage(client, { before: { internal_date: "2026-10-03T10:00:00Z", provider_id: "m9" }, accounts: ["acct-1"] });
    expect(calls[0]).toEqual({ fn: "email_inbox", args: { p_accounts: ["acct-1"], p_before: "2026-10-03T10:00:00Z", p_before_id: "m9", p_limit: 30 } });
  });
});

describe("the server's answers", () => {
  const res = (body: unknown, status: number) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
  it("needs a session before it needs a network", async () => {
    const f = vi.fn();
    expect((await apiPost("/api/email/sync", {}, null, f as unknown as typeof fetch))).toMatchObject({ ok: false, code: "AUTH_REQUIRED" });
    expect(f).not.toHaveBeenCalled();
  });
  it("carries the route's code and safe line, and a size refusal as unsupported with its status", async () => {
    const f = vi.fn(async () => res({ code: "PROVIDER_AUTH", safe_message: "Reconnect Gmail to continue.", retryable: false }, 410));
    const r = await apiPost("/api/email/sync", { email: "d@x.test" }, "jwt", f as unknown as typeof fetch);
    expect(r).toMatchObject({ ok: false, code: "PROVIDER_AUTH", detail: "Reconnect Gmail to continue." });
    const big = await apiPost("/api/email/attachment", {}, "jwt", (async () => res({ code: "STORAGE_LIMIT", safe_message: "Too big." }, 413)) as unknown as typeof fetch);
    expect(big).toMatchObject({ ok: false, code: "UNSUPPORTED", data: { status: 413 } });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/email/sync");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt");
  });
  it("a dropped connection is unavailable, not a blank", async () => {
    const r = await apiPost("/api/email/sync", {}, "jwt", (async () => { throw new Error("down"); }) as unknown as typeof fetch);
    expect(r).toMatchObject({ ok: false, code: "UNAVAILABLE" });
  });
  it("a good answer is the body", async () => {
    const r = await apiPost<{ synced: number }>("/api/email/sync", {}, "jwt", (async () => res({ ok: true, synced: 3 }, 200)) as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, value: { ok: true, synced: 3 } });
  });
});
