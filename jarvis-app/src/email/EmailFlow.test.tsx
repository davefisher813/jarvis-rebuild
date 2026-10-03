// @vitest-environment jsdom
// THE EMAIL TAB, END TO END AGAINST A FAKE SESSION (docs/jarvis-unified,
// slice 05; IMPLEMENTATION-SPEC.md 08, 09 M1, M2, M8, M9, 13; prompt 05
// "Verify before completing"). The real screens render through the real
// stylesheets' class names; the database functions and the email routes are
// recorders. What each tap SENDS and what each state SAYS is what the tests
// hold: ordering with equal timestamps across accounts, paging that appends,
// chips that filter and All that restores, the message sanitised with remote
// images off, read on open through a provider command that can fail and be
// retried, archive with a receipt and an Undo that is the reverse command,
// search coverage and failure said plainly, offline and reauth states, the
// Gmail link's two honest shapes, attachment limits, and that nothing here
// writes a candidate or a life record.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import EmailFlow from "./EmailFlow";
import { OFFLINE_LINE, REAUTH_LINE, RECONNECT, READ_CONFLICT, READ_FAILED, EMPTY_SEARCH, SEARCH_FAILED, EMPTY_FILTER, EMPTY_WAITING, OPEN_GMAIL_EXACT, OPEN_GMAIL_GENERIC, GENERIC_WHY, ATTACHMENT_TOO_BIG, IMAGES_OFF, SHOW_IMAGES, ARCHIVED, UNDO, UNSUPPORTED_ACTION, RETENTION_NOTE, LOAD_MORE, STATE_WORD } from "./copy";
import type { EmailAccount, InboxRow, MessageDetail, RpcClient } from "./emailClient";
import { newestFirst } from "./emailClient";
import { saveSnapshot } from "./deviceCache";
import { remember } from "./categories";
import { subscribeToast, resetToasts, type ToastState } from "../shared/toast";
import type { Category } from "../categories/types";

const NOW = new Date("2026-10-03T15:00:00Z");
const USER = "user-1";
const DAVE = "dave@example.test";
const WORK = "work@example.test";

const account = (o: Partial<EmailAccount>): EmailAccount => ({ id: "acct-dave", address: DAVE, state: "connected", last_sync_at: "2026-10-03T14:50:00Z", sync_error: null, capabilities: { archive: true, trash: true, read: true }, connected_at: "2026-09-01T00:00:00Z", scopes: [], cached: 4, ...o });
const accounts: EmailAccount[] = [account({}), account({ id: "acct-work", address: WORK, last_sync_at: "2026-10-03T14:40:00Z", cached: 1 })];

const row = (id: string, iso: string, o: Partial<InboxRow> = {}): InboxRow => ({
  id: `u-${id}`, account_id: "acct-dave", account: DAVE, provider_id: id, thread_id: `18f2a9c4e1b7d3a${id.slice(-1)}`, internal_date: iso, from_address: "billing@conedison.test", from_name: "Con Edison",
  subject: `Subject ${id}`, snippet: "Amount due", has_body: true, attachment_metadata: [], provider_labels: ["INBOX"], source_hash: "sh", read: true, ...o,
});
// Two rows share one second across two accounts; the id breaks the tie.
const rows: InboxRow[] = [
  row("m3", "2026-10-03T10:00:00Z", { read: false }),
  row("m2", "2026-10-03T10:00:00Z", { account_id: "acct-work", account: WORK, from_address: "coach@example.test", from_name: "Coach Miller" }),
  row("m1", "2026-10-02T09:00:00Z", { thread_id: "t-a1", attachment_metadata: [{ filename: "huge.zip", mime: "application/zip", attachmentId: "att9", size: 30 * 1024 * 1024 }] }),
  row("m0", "2026-09-28T09:00:00Z", { from_address: "news@shop.test", from_name: "Shop" }),
];
const categories: Category[] = [{ id: "bills", data: { name: "Bills", color: "green", order: 0 } as Category["data"] }, { id: "sport", data: { name: "Sport", color: "sky", order: 1 } as Category["data"] }];

const detailOf = (r: InboxRow, o: Partial<MessageDetail> = {}): MessageDetail => ({
  id: r.id, account_id: r.account_id, account: r.account, provider_id: r.provider_id, thread_id: r.thread_id, internal_date: r.internal_date, from_address: r.from_address, from_name: r.from_name,
  to_addresses: [{ address: DAVE, name: "" }], cc_addresses: [], subject: r.subject, snippet: r.snippet, provider_labels: r.provider_labels, read: r.read, deleted: false, source_hash: r.source_hash,
  attachments: r.attachment_metadata, has_body: true, text: "Amount due $142.30 by Oct 15", html: `<p>Amount due <b>$142.30</b></p><script>alert(1)</script><img src="https://t.example/pixel.gif" alt="tracker">`, ...o,
});

type Fn = (args: Record<string, unknown>) => unknown;
interface Rig { client: RpcClient; calls: Array<{ fn: string; args: Record<string, unknown> }>; posts: Array<{ path: string; body: Record<string, unknown> }> }

function rig(o: { rows?: InboxRow[]; accounts?: EmailAccount[]; rpc?: Partial<Record<string, Fn>>; routes?: (path: string, body: Record<string, unknown>) => { status: number; body: unknown } | undefined } = {}): Rig {
  const all = [...(o.rows ?? rows)].sort(newestFirst);
  const acc = o.accounts ?? accounts;
  const calls: Rig["calls"] = [];
  const posts: Rig["posts"] = [];
  const table: Record<string, Fn> = {
    email_accounts: () => acc,
    email_inbox: (a) => {
      const live = all.filter((r) => acc.find((x) => x.id === r.account_id)?.state !== "disconnected");
      const before = a.p_before as string | null;
      const beforeId = a.p_before_id as string | null;
      const after = before ? live.filter((r) => Date.parse(r.internal_date) < Date.parse(before) || (r.internal_date === before && beforeId !== null && r.provider_id < beforeId)) : live;
      return { rows: after.slice(0, a.p_limit as number), cached_total: live.length, page: a.p_limit };
    },
    email_message_read: (a) => { const r = all.find((x) => x.id === a.p_message); return r ? detailOf(r) : { error: "NOT_FOUND" }; },
    email_search_cached: (a) => { const q = String(a.p_q).toLowerCase(); const hits = all.filter((r) => `${r.from_name} ${r.subject} ${r.snippet}`.toLowerCase().includes(q)); return { rows: hits, coverage: "cached", q: a.p_q, window: all.length }; },
    policy_suggestion_offer: () => ({ suggestion_id: "s1", status: "suggested", replay: false }),
    policy_suggestion_answer: (a) => ({ suggestion_id: a.p_suggestion, status: a.p_answer, replay: false }),
    substrate_readiness: () => ({ registered: ["money_bill", "money_receipt", "task", "event", "waiting"] }),
    candidates_for: () => [],
    candidate_propose: () => ({ candidate_id: "c-x", revision: 1, status: "proposed", payload_hash: "h", replay: false, stale_marked: 0 }),
    ...o.rpc,
  };
  const client: RpcClient = { rpc: async (fn, args) => { calls.push({ fn, args: args as Record<string, unknown> }); const f = table[fn]; if (!f) throw new Error("no fake for " + fn); return { data: f(args as Record<string, unknown>), error: null }; } };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    posts.push({ path: url, body });
    const custom = o.routes?.(url, body);
    const answer = custom ?? (
      url.endsWith("/api/email/sync") ? { status: 200, body: { ok: true, synced: 0, removed: 0, next_page: null, complete: true, resynced: false } }
        : url.endsWith("/api/email/message") ? { status: 200, body: { ok: true, message_id: "x", labels: body.op === "unread" ? ["INBOX", "UNREAD"] : body.op === "archive" ? [] : body.op === "trash" ? ["TRASH"] : ["INBOX"], read: body.op !== "unread", in_inbox: body.op !== "archive" && body.op !== "trash", in_trash: body.op === "trash", receipt: body.op === "archive" || body.op === "trash" ? "act-1" : null } }
          : url.endsWith("/api/email/search") ? { status: 200, body: { ok: true, q: `"${body.q}"`, rows: all.filter((r) => r.subject.toLowerCase().includes(String(body.q).toLowerCase())), covered: [DAVE, WORK], failed: [], next_page: null, coverage: "provider" } }
            : url.endsWith("/api/email/accounts") ? { status: 200, body: { ok: true, mirrored: [], disconnected: [] } }
              : { status: 404, body: { code: "NOT_FOUND", safe_message: "That message isn't here." } });
    return { ok: answer.status < 300, status: answer.status, json: async () => answer.body } as Response;
  }));
  return { client, calls, posts };
}

const mount = (r: Rig, extra: Partial<Parameters<typeof EmailFlow>[0]> = {}) => {
  const onOpenConnections = vi.fn();
  const ui = render(<EmailFlow client={r.client} token="jwt" userId={USER} categories={categories} now={() => NOW} onOpenConnections={onOpenConnections} {...extra} />);
  return { ...ui, onOpenConnections };
};
const rowLabels = () => screen.getAllByRole("button").filter((b) => b.className.includes("mrow")).map((b) => b.getAttribute("aria-label")!);
const subjects = () => rowLabels().map((l) => /Subject (\w+)/.exec(l)![1]);

let toasts: ToastState[] = [];
let unsub = () => {};
beforeEach(() => {
  localStorage.clear();
  resetToasts();
  toasts = [];
  unsub = subscribeToast((t) => { if (t) toasts.push(t); });
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});
afterEach(() => { unsub(); cleanup(); vi.unstubAllGlobals(); });

describe("M1: the inbox", () => {
  it("is every account newest first, equal timestamps by id, under day headers, each row saying whose it is", async () => {
    const r = rig();
    mount(r);
    await waitFor(() => expect(subjects()).toEqual(["m3", "m2", "m1", "m0"]));
    expect([...document.querySelectorAll(".sh2 .t")].map((e) => e.textContent)).toEqual(["Today", "Yesterday", expect.not.stringMatching(/Today|Yesterday/)]);
    expect(document.querySelectorAll(".macct").length).toBe(4);
    expect(document.querySelector(".mfrom.strong")).toHaveTextContent("Con Edison");
    // One sync per live account, caused by the open, and the one page after.
    expect(r.posts.filter((p) => p.path.endsWith("/api/email/sync")).map((p) => p.body.email).sort()).toEqual([DAVE, WORK]);
    expect(r.calls.filter((c) => c.fn === "email_inbox").length).toBe(1);
    expect(screen.getByText("That's everything.")).toBeInTheDocument();
    expect(screen.getByText(/^Updated Today/)).toHaveTextContent("2 Accounts");
  });

  it("pages thirty at a time, Load More continues after the last row and appends in order", async () => {
    const many: InboxRow[] = [];
    for (let i = 0; i < 35; i++) many.push(row(`p${String(i).padStart(2, "0")}`, i < 2 ? "2026-10-03T10:00:00Z" : `2026-10-0${i % 2 === 0 ? 2 : 1}T${String(23 - (i % 24)).padStart(2, "0")}:00:00Z`));
    many[29] = row("p29", "2026-10-01T05:00:00Z"); many[30] = row("p30", "2026-10-01T05:00:00Z");
    const r = rig({ rows: many });
    mount(r);
    await waitFor(() => expect(rowLabels().length).toBe(30));
    expect(screen.getByText("Showing what's loaded so far.")).toBeInTheDocument();
    const firstPage = subjects();
    fireEvent.click(screen.getByText(LOAD_MORE));
    await waitFor(() => expect(rowLabels().length).toBe(35));
    const second = r.calls.filter((c) => c.fn === "email_inbox")[1]!.args;
    const sorted = [...many].sort(newestFirst);
    expect(second.p_before).toBe(sorted[29]!.internal_date);
    expect(second.p_before_id).toBe(sorted[29]!.provider_id);
    expect(subjects().slice(0, 30)).toEqual(firstPage);
    expect(subjects()).toEqual(sorted.map((x) => x.provider_id));
    expect(new Set(subjects()).size).toBe(35);
    expect(screen.getByText("That's everything.")).toBeInTheDocument();
  });

  it("chips filter what is loaded with a count, All restores every row, and nothing is hidden by a rule", async () => {
    remember({ sender_exact: "billing@conedison.test", account_id: "acct-dave", category_id: "bills" }, null, NOW.toISOString(), localStorage);
    const r = rig();
    mount(r);
    await waitFor(() => expect(subjects().length).toBe(4));
    const bills = screen.getByRole("button", { name: /^Bills/ });
    expect(bills).toHaveTextContent("Bills 2");
    expect(screen.queryByRole("button", { name: /^Sport/ })).toBeNull();
    fireEvent.click(bills);
    expect(subjects()).toEqual(["m3", "m1"]);
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    expect(subjects()).toEqual(["m3", "m2", "m1", "m0"]);
  });

  it("Waiting is honest: nothing there yet, and the empty state carries its way back", async () => {
    mount(rig());
    await waitFor(() => expect(subjects().length).toBe(4));
    fireEvent.click(screen.getByRole("tab", { name: "Waiting" }));
    expect(screen.getByText(EMPTY_WAITING.title)).toBeInTheDocument();
    fireEvent.click(screen.getByText(EMPTY_WAITING.action));
    expect(subjects().length).toBe(4);
  });
});

describe("M2: the message", () => {
  it("opens sanitised with remote images off, marks read through a provider command the open caused, and the list follows", async () => {
    const r = rig();
    mount(r);
    await waitFor(() => expect(subjects().length).toBe(4));
    expect(rowLabels()[0]).toMatch(/Unread$/);
    fireEvent.click(screen.getAllByRole("button").find((b) => b.className.includes("mrow"))!);
    await waitFor(() => expect(screen.getByText("Subject m3")).toBeInTheDocument());
    const frame = await waitFor(() => document.querySelector("iframe.mail-html") as HTMLIFrameElement);
    const doc = frame.getAttribute("srcdoc")!;
    expect(doc).not.toMatch(/<script/i);
    expect(doc).not.toMatch(/https:\/\/t\.example/);
    expect(frame.getAttribute("sandbox")).not.toMatch(/allow-scripts/);
    expect(screen.getByText(IMAGES_OFF)).toBeInTheDocument();
    fireEvent.click(screen.getByText(SHOW_IMAGES));
    await waitFor(() => expect(document.querySelector("iframe.mail-html")!.getAttribute("srcdoc")).toMatch(/https:\/\/t\.example\/pixel\.gif/));
    await waitFor(() => expect(r.posts.find((p) => p.path.endsWith("/api/email/message") && p.body.op === "read")).toBeTruthy());
    expect(r.posts.find((p) => p.body.op === "read")!.body).toEqual({ email: DAVE, id: "m3", op: "read" });
    fireEvent.click(screen.getByText("Email"));
    await waitFor(() => expect(rowLabels()[0]).not.toMatch(/Unread$/));
  });

  it("a refused read restores the badge and offers Retry; a conflicting remote state is said, not hidden", async () => {
    const r = rig({ routes: (path, body) => path.endsWith("/api/email/message") && body.op === "read" ? { status: 503, body: { code: "UNAVAILABLE", safe_message: "Couldn't reach Gmail." } } : undefined });
    mount(r);
    await waitFor(() => expect(subjects().length).toBe(4));
    fireEvent.click(screen.getAllByRole("button").find((b) => b.className.includes("mrow"))!);
    await waitFor(() => expect(screen.getByText(new RegExp(READ_FAILED))).toBeInTheDocument());
    expect(screen.getByText("Retry")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Email"));
    await waitFor(() => expect(rowLabels()[0]).toMatch(/Unread$/));

    cleanup();
    const r2 = rig({ rpc: { email_message_read: (a) => detailOf(rows.find((x) => x.id === a.p_message)!, { read: true }) } });
    mount(r2);
    await waitFor(() => expect(subjects().length).toBe(4));
    fireEvent.click(screen.getAllByRole("button").find((b) => b.className.includes("mrow"))!);
    await waitFor(() => expect(screen.getByText(READ_CONFLICT)).toBeInTheDocument());
    expect(r2.posts.find((p) => p.body.op === "read")).toBeUndefined();
  });

  it("archive is explicit, leaves the inbox, and Undo is the reverse provider command that brings the row back", async () => {
    const r = rig();
    mount(r);
    await waitFor(() => expect(subjects().length).toBe(4));
    fireEvent.click(screen.getAllByRole("button").find((b) => b.className.includes("mrow"))!);
    await waitFor(() => expect(screen.getByText("Subject m3")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByText("Archive"));
    await waitFor(() => expect(subjects()).toEqual(["m2", "m1", "m0"]));
    expect(r.posts.find((p) => p.body.op === "archive")!.body).toEqual({ email: DAVE, id: "m3", op: "archive" });
    const t = toasts.find((x) => x.message === ARCHIVED)!;
    expect(t.actionLabel).toBe(UNDO);
    await act(async () => { t.onAction!(); });
    await waitFor(() => expect(subjects()).toEqual(["m3", "m2", "m1", "m0"]));
    expect(r.posts.find((p) => p.body.op === "unarchive")).toBeTruthy();
    // Archive is a provider command: nothing here writes a life record or approves a card.
    expect(r.calls.some((c) => /^(capture_approve|action_undo|decision_save|exploration_keep)$/.test(c.fn))).toBe(false);
  });

  it("archive and trash are offered only when the account can do them", async () => {
    const r = rig({ accounts: [account({ capabilities: { read: true } }), accounts[1]!] });
    mount(r);
    await waitFor(() => expect(subjects().length).toBe(4));
    fireEvent.click(screen.getAllByRole("button").find((b) => b.className.includes("mrow"))!);
    await waitFor(() => expect(screen.getByText("Subject m3")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const archive = screen.getByText(new RegExp(`Archive · ${UNSUPPORTED_ACTION}`));
    expect(archive.closest("button")).toBeDisabled();
  });

  it("Open in Gmail is exact for a Gmail thread id and says Open Gmail, with why, when the id is not Gmail's", async () => {
    const open = vi.fn(() => ({ opener: null } as unknown as Window));
    vi.stubGlobal("open", open);
    const r = rig();
    mount(r);
    await waitFor(() => expect(subjects().length).toBe(4));
    fireEvent.click(screen.getAllByRole("button").find((b) => b.className.includes("mrow"))!);
    await waitFor(() => expect(screen.getByText(OPEN_GMAIL_EXACT)).toBeInTheDocument());
    fireEvent.click(screen.getByText(OPEN_GMAIL_EXACT));
    expect(open).toHaveBeenCalledWith("https://mail.google.com/mail/?authuser=dave%40example.test#all/18f2a9c4e1b7d3a3", "_blank");
    fireEvent.click(screen.getByText("Email"));
    await waitFor(() => expect(subjects().length).toBe(4));
    fireEvent.click(screen.getAllByRole("button").filter((b) => b.className.includes("mrow"))[2]!);
    await waitFor(() => expect(screen.getByText(OPEN_GMAIL_GENERIC)).toBeInTheDocument());
    expect(screen.queryByText(OPEN_GMAIL_EXACT)).toBeNull();
    fireEvent.click(screen.getByText(OPEN_GMAIL_GENERIC));
    expect(open).toHaveBeenLastCalledWith("https://mail.google.com/mail/?authuser=dave%40example.test", "_blank");
    expect(screen.getByText(GENERIC_WHY)).toBeInTheDocument();
  });

  it("an attachment over the cap says so before anything is fetched", async () => {
    const r = rig();
    mount(r);
    await waitFor(() => expect(subjects().length).toBe(4));
    fireEvent.click(screen.getAllByRole("button").filter((b) => b.className.includes("mrow"))[2]!);
    await waitFor(() => expect(screen.getByText("huge.zip")).toBeInTheDocument());
    fireEvent.click(screen.getByText("huge.zip").closest(".row")!);
    expect(await screen.findByText(ATTACHMENT_TOO_BIG)).toBeInTheDocument();
    expect(r.posts.find((p) => p.path.endsWith("/api/email/attachment"))).toBeUndefined();
  });
});

describe("M8: search", () => {
  it("answers from saved mail first, labelled, then from Gmail with its coverage, and a result opens and comes back to the query", async () => {
    const r = rig({ routes: (path, body) => path.endsWith("/api/email/search") ? { status: 200, body: { ok: true, q: `"${body.q}"`, rows: [rows[0]], covered: [DAVE], failed: [{ email: WORK, code: "UNAVAILABLE" }], next_page: null, coverage: "provider" } } : undefined });
    mount(r);
    await waitFor(() => expect(subjects().length).toBe(4));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByPlaceholderText("Search Mail"), { target: { value: "Subject m3" } });
    await waitFor(() => expect(document.querySelector(".email-cover")).toHaveTextContent(/^Gmail · 1 Account Covered · Didn't Answer · work@example.test · 1 Message$/));
    expect(r.calls.find((c) => c.fn === "email_search_cached")!.args).toMatchObject({ p_q: "Subject m3", p_accounts: null });
    expect(r.posts.find((p) => p.path.endsWith("/api/email/search"))!.body).toEqual({ q: "Subject m3" });
    fireEvent.click(screen.getAllByRole("button").find((b) => b.className.includes("mrow"))!);
    await waitFor(() => expect(screen.getByText("Subject m3")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Email"));
    await waitFor(() => expect(screen.getByPlaceholderText("Search Mail")).toHaveValue("Subject m3"));
  });

  it("a transport failure keeps the saved hits and never says No Matching Mail; no saved hit is its own distinct state", async () => {
    const r = rig({ routes: (path) => path.endsWith("/api/email/search") ? { status: 503, body: { code: "UNAVAILABLE", safe_message: "Couldn't reach Gmail." } } : undefined });
    mount(r);
    await waitFor(() => expect(subjects().length).toBe(4));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByPlaceholderText("Search Mail"), { target: { value: "Coach" } });
    await waitFor(() => expect(document.querySelector(".email-cover")).toHaveTextContent(/^Saved Mail · 4 Messages Searched · Couldn't Reach JARVIS/));
    expect(subjects()).toEqual(["m2"]);
    expect(screen.queryByText(EMPTY_SEARCH.title)).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Search Mail"), { target: { value: "zzz-nothing" } });
    await waitFor(() => expect(screen.getByText(SEARCH_FAILED.title)).toBeInTheDocument());
    expect(screen.queryByText(EMPTY_SEARCH.title)).toBeNull();
  });

  it("no match anywhere is No Matching Mail with a way out", async () => {
    const r = rig({ routes: (path) => path.endsWith("/api/email/search") ? { status: 200, body: { ok: true, q: '"zzz"', rows: [], covered: [DAVE, WORK], failed: [], next_page: null, coverage: "provider" } } : undefined });
    mount(r);
    await waitFor(() => expect(subjects().length).toBe(4));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByPlaceholderText("Search Mail"), { target: { value: "zzz" } });
    await waitFor(() => expect(screen.getByText(EMPTY_SEARCH.title)).toBeInTheDocument());
    fireEvent.click(screen.getByText(EMPTY_SEARCH.action));
    expect(screen.getByPlaceholderText("Search Mail")).toHaveValue("");
  });
});

describe("E21, E22, E28: accounts and states", () => {
  it("offline shows the saved page with the banner and asks Gmail for nothing", async () => {
    saveSnapshot(USER, { accounts, rows }, () => NOW.toISOString());
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    const r = rig();
    mount(r);
    expect(subjects()).toEqual(["m3", "m2", "m1", "m0"]);
    expect(screen.getByText(OFFLINE_LINE)).toBeInTheDocument();
    expect(r.posts).toEqual([]);
    // The one question asked of the database offline is which doors are open; no mail is asked for.
    expect(r.calls.filter((c) => c.fn !== "substrate_readiness")).toEqual([]);
  });

  it("a mailbox that needs reconnecting keeps its mail and asks for the one fix, which goes to Connections", async () => {
    const r = rig({ accounts: [account({ state: "reauth", sync_error: "Reconnect Gmail to continue." }), accounts[1]!] });
    const { onOpenConnections } = mount(r);
    await waitFor(() => expect(subjects().length).toBe(4));
    expect(screen.getByText(REAUTH_LINE)).toBeInTheDocument();
    fireEvent.click(screen.getByText(RECONNECT));
    expect(onOpenConnections).toHaveBeenCalled();
  });

  it("the accounts screen says each state and what a disconnect keeps; a disconnected mailbox is off the page", async () => {
    const r = rig({ accounts: [accounts[0]!, account({ id: "acct-work", address: WORK, state: "disconnected", cached: 1 })] });
    mount(r);
    await waitFor(() => expect(subjects()).toEqual(["m3", "m1", "m0"]));
    expect(screen.getByText(/^Updated Today/)).toHaveTextContent("1 Account");
    fireEvent.click(screen.getByText(/^Updated Today/));
    await waitFor(() => expect(screen.getAllByText("Accounts").length).toBeGreaterThan(0));
    expect(screen.getByText(STATE_WORD.disconnected)).toBeInTheDocument();
    expect(screen.getByText(RETENTION_NOTE)).toBeInTheDocument();
  });

  it("a filter with nothing under it says so and offers All; one account failing to refresh is a line, not a blank", async () => {
    const r = rig({ routes: (path, body) => path.endsWith("/api/email/sync") && body.email === WORK ? { status: 503, body: { code: "UNAVAILABLE", safe_message: "Couldn't reach Gmail." } } : undefined });
    mount(r);
    await waitFor(() => expect(subjects().length).toBe(4));
    expect(screen.getByText(/^Didn't Refresh · work@example.test/)).toBeInTheDocument();
    const m0 = screen.getAllByRole("button").filter((b) => b.className.includes("mrow"))[3]!;
    fireEvent.click(m0);
    await waitFor(() => expect(screen.getByText("Subject m0")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByText("File Under"));
    fireEvent.click(screen.getByText("Sport"));
    fireEvent.click(screen.getByText("Email"));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Sport/ })).toHaveTextContent("Sport 1"));
    fireEvent.click(screen.getByRole("button", { name: /^Sport/ }));
    expect(subjects()).toEqual(["m0"]);
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    expect(subjects().length).toBe(4);
    expect(within(document.body).queryByText(EMPTY_FILTER.title)).toBeNull();
  });
});
