// @vitest-environment jsdom
// THE MAIL HOME, END TO END AGAINST A FAKE SESSION (Email v1 spec 3.1 to 3.3,
// 11; Dave's rulings 2026-10-12). The five sections with their counts and the
// remembered All by Date; Same Content as a label on two rows that both stay
// actionable; select mode with a frozen selection, a section's Select, Select
// All Loaded, the tray, per-item results, retry of only proven failures, Undo
// of only what changed, and the session checked before anything is sent.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import EmailFlow from "./EmailFlow";
import { RECONNECT_FIRST, SIGN_IN_FIRST, TRASH_HELPER, UNDO } from "./copy";
import type { EmailAccount, InboxRow, RpcClient } from "./emailClient";
import { newestFirst } from "./emailClient";
import { loadView } from "./sections";
import { subscribeToast, resetToasts, type ToastState } from "../shared/toast";

const NOW = new Date("2026-10-03T15:00:00Z");
const USER = "user-1";
const DAVE = "dave@example.test";
const WORK = "work@example.test";

const account = (o: Partial<EmailAccount>): EmailAccount => ({ id: "acct-dave", address: DAVE, state: "connected", last_sync_at: "2026-10-03T14:50:00Z", sync_error: null, capabilities: { archive: true, trash: true, read: true }, connected_at: "2026-09-01T00:00:00Z", scopes: [], cached: 4, signature_text: "", signature_revision: 1, ...o });
const accounts: EmailAccount[] = [account({}), account({ id: "acct-work", address: WORK })];

const row = (id: string, iso: string, o: Partial<InboxRow> = {}): InboxRow => ({
  id: `u-${id}`, account_id: "acct-dave", account: DAVE, provider_id: id, thread_id: `t-${id}`, internal_date: iso, from_address: "maya@example.test", from_name: "Maya Chen",
  subject: `Subject ${id}`, snippet: "Can we meet at 10?", has_body: false, attachment_metadata: [], provider_labels: ["INBOX"], source_hash: "sh", read: true, ...o,
});
const ROWS: InboxRow[] = [
  row("c1", "2026-10-03T12:00:00Z", { own_reply: true, read: false }),
  row("s1", "2026-10-03T11:00:00Z", { mime_type: "text/calendar", from_name: "Alex Morgan", from_address: "alex@example.test" }),
  row("l1", "2026-10-03T10:00:00Z", { list_id: "<news.studio.test>", from_name: "Community Studio", from_address: "news@studio.test", rfc_message_id: "<same@studio.test>" }),
  row("l2", "2026-10-03T09:00:00Z", { account_id: "acct-work", account: WORK, list_unsubscribe: "<mailto:off@studio.test>", from_name: "Community Studio", from_address: "news@studio.test", rfc_message_id: "<same@studio.test>" }),
  row("o1", "2026-10-02T09:00:00Z", { from_name: "Invoice Desk", subject: "Subject o1 Invoice $40 meeting" }),
];

type Route = (path: string, body: Record<string, unknown>) => { status: number; body: unknown } | undefined;

function rig(o: { rows?: InboxRow[]; accounts?: EmailAccount[]; routes?: Route; inboxFails?: boolean } = {}) {
  let all = [...(o.rows ?? ROWS)].sort(newestFirst);
  const acc = o.accounts ?? accounts;
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  const table: Record<string, (a: Record<string, unknown>) => unknown> = {
    email_accounts: () => acc,
    email_inbox: (a) => { if (o.inboxFails) throw new Error("offline"); return { rows: all.slice(0, a.p_limit as number), cached_total: all.length, page: a.p_limit }; },
    substrate_readiness: () => ({ registered: [] }),
    candidates_for: () => [],
  };
  const client: RpcClient = { rpc: async (fn, args) => { const f = table[fn]; if (!f) throw new Error("no fake for " + fn); return { data: f(args as Record<string, unknown>), error: null }; } };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    posts.push({ path: url, body });
    const custom = o.routes?.(url, body);
    let answer = custom;
    if (!answer && url.endsWith("/api/email/message") && Array.isArray(body.items)) {
      const op = body.op as string;
      const items = body.items as Array<{ email: string; id: string }>;
      answer = { status: 200, body: { ok: true, op, results: items.map((x) => ({ ...x, status: "accepted", read: op !== "unread", in_inbox: !(op === "archive" || op === "trash"), labels: [] })) } };
    }
    answer ??= url.endsWith("/api/email/sync") ? { status: 200, body: { ok: true, synced: 0, removed: 0, next_page: null, complete: true, resynced: false } } : { status: 404, body: { code: "NOT_FOUND" } };
    return { ok: answer.status < 300, status: answer.status, json: async () => answer!.body } as Response;
  }));
  return { client, posts, arrive: (r: InboxRow) => { all = [r, ...all].sort(newestFirst); } };
}

const mount = (r: ReturnType<typeof rig>, token: string | null = "jwt") =>
  render(<EmailFlow client={r.client} token={token} userId={USER} categories={[]} now={() => NOW} onOpenConnections={() => {}} />);
const rowEls = () => [...document.querySelectorAll(".erow")] as HTMLElement[];
const subjects = () => rowEls().map((b) => /Subject (\w+)/.exec(b.getAttribute("aria-label")!)![1]);
const heads = () => [...document.querySelectorAll(".sh2")].map((h) => [h.querySelector(".t")!.textContent, h.querySelector(".n")!.textContent]);
const batches = (r: ReturnType<typeof rig>) => r.posts.filter((p) => p.path.endsWith("/api/email/message") && Array.isArray(p.body.items)).map((p) => p.body as { op: string; items: Array<{ email: string; id: string }> });

let toasts: ToastState[] = [];
let unsub = () => {};
beforeEach(() => {
  localStorage.clear();
  resetToasts();
  toasts = [];
  unsub = subscribeToast((t) => { if (t) toasts.push(t); });
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});
afterEach(() => { unsub(); cleanup(); vi.unstubAllGlobals(); document.body.classList.remove("selecting"); });

// THE FIRST LOAD FAILED (issue 112, open call 5; Dave 2026-10-05, locked: no button in a row). With nothing cached the screen said why in a
// card and offered Retry as a full-width row. It is the same empty state every other Email screen draws now: the reason as its sub, Retry as
// the one filled primary, nothing in a row.
describe("the inbox's first load failing", () => {
  it("draws the empty state with Retry as its one primary, and Retry loads again", async () => {
    const r = rig({ inboxFails: true });
    mount(r);
    expect(await screen.findByText("Couldn't Load Your Mail")).toBeInTheDocument();
    const empty = document.querySelector(".empty-state") as HTMLElement;
    expect(empty).not.toBeNull();
    expect(empty.querySelector(".btn-primary")).toHaveTextContent("Retry");
    expect(document.querySelector(".row-act"), "no button in a row").toBeNull();
    expect(rowEls().length).toBe(0);
  });
});

describe("the grouped home (spec 3.1, 3.2)", () => {
  it("is the five sections in their fixed order, expanded, empty ones omitted, each with its loaded count and colour", async () => {
    mount(rig());
    await waitFor(() => expect(rowEls().length).toBe(5));
    expect(heads()).toEqual([["Conversations", "1 Loaded"], ["Schedule", "1 Loaded"], ["Mailing Lists", "2 Loaded"], ["Other", "1 Loaded"]]);
    expect(subjects()).toEqual(["c1", "s1", "l1", "l2", "o1"]);
    expect(document.querySelector(".sh2 .email-sec-name")).toHaveClass("cat-fg-purple");
    // An invoice word and an amount do not make Money; Other carries no colour.
    expect(screen.queryByText("Money")).toBeNull();
    const other = [...document.querySelectorAll(".sh2")].find((h) => h.textContent!.startsWith("Other"))!;
    expect(other.querySelector(".email-sec-name")).toBeNull();
    // The header: date over the title, the account picker, the search field, the arrangement, Select and Compose.
    expect(document.querySelector(".email-hero .eyebrow")).toHaveTextContent("Saturday, October 3");
    expect(document.querySelector(".email-hero .pagehead-title")).toHaveTextContent("Inbox");
    expect(screen.getByRole("tab", { name: "Grouped" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Select" })).toBeInTheDocument();
    expect(document.querySelector(".email-fab")).toHaveAttribute("aria-label", "Compose");
  });

  it("every section heading carries Why This Section?, which opens that section's own answer and closes on Done", async () => {
    mount(rig());
    await waitFor(() => expect(rowEls().length).toBe(5));
    const purpose: Record<string, string> = { Conversations: "Threads Where You Sent a Message", Schedule: "Mail with Calendar Structure", "Mailing Lists": "Mail Sent to a Mailing List", Other: "Mail No Section Rule Matched" };
    const hs = [...document.querySelectorAll(".sh2")] as HTMLElement[];
    expect(hs.length).toBe(4);
    for (const h of hs) {
      const name = h.querySelector(".t")!.textContent!;
      const btn = h.querySelector(".email-sec-why") as HTMLElement;
      expect(btn, name).toHaveAttribute("aria-label", "Why This Section?");
      fireEvent.click(btn);
      const d = screen.getByRole("dialog", { name: "Why This Section?" });
      expect(d).toHaveTextContent(`In ${name}`);
      expect(d).toHaveTextContent(purpose[name]!);
      fireEvent.click(screen.getByRole("button", { name: "Done" }));
      expect(screen.queryByRole("dialog", { name: "Why This Section?" })).toBeNull();
    }
    // All by Date's day headings are not sections and carry no such control.
    fireEvent.click(screen.getByRole("tab", { name: "All by Date" }));
    expect(document.querySelector(".email-sec-why")).toBeNull();
  });

  it("All by Date shows the same rows under days, and the choice is remembered on this device", async () => {
    const r = rig();
    const ui = mount(r);
    await waitFor(() => expect(rowEls().length).toBe(5));
    fireEvent.click(screen.getByRole("tab", { name: "All by Date" }));
    expect(heads().map((h) => h[0])).toEqual(["Today", "Yesterday"]);
    expect(new Set(subjects())).toEqual(new Set(["c1", "s1", "l1", "l2", "o1"]));
    expect(loadView(USER)).toBe("date");
    ui.unmount();
    mount(rig());
    await waitFor(() => expect(rowEls().length).toBe(5));
    expect(screen.getByRole("tab", { name: "All by Date" })).toHaveAttribute("aria-selected", "true");
    expect(heads().map((h) => h[0])).toEqual(["Today", "Yesterday"]);
  });

  it("the account picker shows one mailbox's rows and clears back to all", async () => {
    mount(rig());
    await waitFor(() => expect(rowEls().length).toBe(5));
    fireEvent.click(document.querySelector(".email-acct")!);
    fireEvent.click(screen.getByText(WORK));
    expect(subjects()).toEqual(["l2"]);
    fireEvent.click(document.querySelector(".email-acct")!);
    fireEvent.click(screen.getAllByText("All Accounts").find((e) => e.closest(".email-acct") === null)!);
    expect(rowEls().length).toBe(5);
  });
});

describe("one row per message, and the thread count (issue 103)", () => {
  const THREAD: InboxRow[] = [
    row("g1", "2026-10-03T12:00:00Z", { thread_id: "geico", own_reply: true, subject: "Subject g1" }),
    row("g2", "2026-10-03T11:30:00Z", { thread_id: "geico", list_unsubscribe: "<mailto:off@geico.test>", subject: "Subject g2" }),
    row("g3", "2026-10-03T11:00:00Z", { thread_id: "geico", mime_type: "text/calendar", subject: "Subject g3" }),
    row("g4", "2026-10-03T10:30:00Z", { thread_id: "geico", subject: "Subject g4" }),
    row("o1", "2026-10-03T10:00:00Z"),
  ];
  const facts = () => rowEls().map((e) => e.querySelector(".mthread")?.textContent ?? null);

  it("Grouped and All by Date each draw every message once; Grouped says '4 Messages' on the thread's rows only, All by Date stays plain", async () => {
    mount(rig({ rows: THREAD }));
    await waitFor(() => expect(rowEls().length).toBe(5));
    expect(subjects().sort()).toEqual(["g1", "g2", "g3", "g4", "o1"]);
    expect(facts().filter(Boolean)).toEqual(["4 Messages", "4 Messages", "4 Messages", "4 Messages"]);
    expect(rowEls().find((e) => /Subject o1/.test(e.getAttribute("aria-label")!))!.querySelector(".mthread")).toBeNull();
    // A fact, not a pill, and no dot in the string.
    for (const f of document.querySelectorAll(".mthread")) { expect(f.tagName).toBe("SPAN"); expect(f.textContent).not.toMatch(/[\u00b7\u2022]/); expect(f.closest(".pill-act, .row-act")).toBeNull(); }
    fireEvent.click(screen.getByRole("tab", { name: "All by Date" }));
    expect(subjects().sort()).toEqual(["g1", "g2", "g3", "g4", "o1"]);
    expect(document.querySelectorAll(".mthread").length).toBe(0);
    fireEvent.click(screen.getByRole("tab", { name: "Grouped" }));
    expect(subjects().sort()).toEqual(["g1", "g2", "g3", "g4", "o1"]);
  });

  it("the same message arriving under two row ids is one row in Grouped", async () => {
    const dup = [...THREAD, row("g4", "2026-10-03T10:30:00Z", { id: "u-g4-stale", thread_id: "geico", subject: "Subject g4" })];
    mount(rig({ rows: dup }));
    await waitFor(() => expect(rowEls().length).toBeGreaterThan(0));
    expect(subjects().sort()).toEqual(["g1", "g2", "g3", "g4", "o1"]);
    expect(heads().reduce((n, h) => n + parseInt(String(h[1]), 10), 0)).toBe(5);
  });

  it("select mode stays per message: a tap on a threaded row picks that message alone", async () => {
    const r = rig({ rows: THREAD });
    mount(r);
    await waitFor(() => expect(rowEls().length).toBe(5));
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(rowEls()[0]!);
    expect(rowEls()[0]!).toHaveAttribute("aria-pressed", "true");
    expect(rowEls().filter((e) => e.getAttribute("aria-pressed") === "true")).toHaveLength(1);
  });
});

describe("Same Content (spec 3.3, Dave's ruling 2026-10-12)", () => {
  it("labels both copies of an exact Message-ID, keeps both rows, and a copy is acted on alone", async () => {
    const r = rig();
    mount(r);
    await waitFor(() => expect(rowEls().length).toBe(5));
    const labelled = rowEls().filter((e) => e.textContent!.includes("Same Content"));
    expect(labelled.map((e) => /Subject (\w+)/.exec(e.getAttribute("aria-label")!)![1])).toEqual(["l1", "l2"]);
    // Select All Loaded is every row, the copies counted once each, never collapsed or added by the label.
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    // Select mode takes the swipe off the rows, so they are drawn again: read them fresh.
    const again = rowEls().filter((e) => e.textContent!.includes("Same Content"));
    fireEvent.click(again[0]!);
    expect(document.querySelector(".email-selcount")).toHaveTextContent("1 Selected");
    fireEvent.click(screen.getByRole("button", { name: /^Read/ }));
    await waitFor(() => expect(batches(r).length).toBe(1));
    expect(batches(r)[0]!.items).toEqual([{ email: DAVE, id: "l1" }]);
  });
});

describe("select mode (spec 11, V04)", () => {
  it("Cancel and the count head the list, circles lead the rows, and the tray offers four verbs with Delete's helper", async () => {
    mount(rig());
    await waitFor(() => expect(rowEls().length).toBe(5));
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(document.querySelector(".email-selcount")).toHaveTextContent("0 Selected");
    expect(document.querySelectorAll(".erow .sel-box").length).toBe(5);
    expect(screen.getByText(TRASH_HELPER)).toBeInTheDocument();
    const tray = document.querySelector(".email-tray")!;
    expect([...tray.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Read", "Unread", "Archive", "Delete"]);
    // Delete is the one red.
    expect([...tray.querySelectorAll(".btn-primary")].map((b) => b.textContent)).toEqual(["Delete"]);
    expect(document.body).toHaveClass("selecting");
    // A row's tap is its circle, not the message.
    fireEvent.click(rowEls()[0]!);
    expect(rowEls()[0]).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector(".email-sheet, iframe.mail-html")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.querySelector(".email-tray")).toBeNull();
    expect(rowEls()[0]!.querySelector(".sel-box")).toBeNull();
  });

  it("a section's Select takes its rows; Select All Loaded takes what is loaded; a later arrival is never selected", async () => {
    const r = rig();
    mount(r);
    await waitFor(() => expect(rowEls().length).toBe(5));
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    const lists = [...document.querySelectorAll(".sh2")].find((h) => h.textContent!.startsWith("Mailing Lists"))!;
    fireEvent.click(lists.querySelector(".email-sec-pick")!);
    expect(document.querySelector(".email-selcount")).toHaveTextContent("2 Selected");
    expect(lists.querySelector(".email-sec-pick")).toHaveTextContent("Deselect");
    fireEvent.click(screen.getByRole("button", { name: "Select All 5 Loaded" }));
    expect(document.querySelector(".email-selcount")).toHaveTextContent("5 Selected");
    // New mail arrives on a refresh while selecting: it shows, unselected, and the command names only the five.
    r.arrive(row("n1", "2026-10-03T14:00:00Z", { own_reply: true }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh" })); });
    await waitFor(() => expect(rowEls().length).toBe(6));
    expect(document.querySelector(".email-selcount")).toHaveTextContent("5 Selected");
    fireEvent.click(screen.getByRole("button", { name: /^Archive/ }));
    await waitFor(() => expect(batches(r).length).toBe(1));
    expect(batches(r)[0]!.op).toBe("archive");
    expect(batches(r)[0]!.items.map((x) => x.id).sort()).toEqual(["c1", "l1", "l2", "o1", "s1"]);
    // Gmail confirmed: the five leave, the arrival stays, select mode ends, and Undo is offered.
    await waitFor(() => expect(subjects()).toEqual(["n1"]));
    expect(document.querySelector(".email-tray")).toBeNull();
    expect(toasts.at(-1)).toMatchObject({ message: "5 Archived", actionLabel: UNDO });
  });

  it("Delete moves to Gmail's Trash; Undo puts back only what this action moved", async () => {
    const r = rig();
    mount(r);
    await waitFor(() => expect(rowEls().length).toBe(5));
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(rowEls()[0]!);
    fireEvent.click(rowEls()[4]!);
    fireEvent.click(screen.getByRole("button", { name: /^Delete/ }));
    await waitFor(() => expect(subjects()).toEqual(["s1", "l1", "l2"]));
    expect(batches(r)[0]).toMatchObject({ op: "trash" });
    const undo = toasts.at(-1)!;
    expect(undo).toMatchObject({ message: "2 Moved to Trash", actionLabel: UNDO });
    await act(async () => { undo.onAction!(); });
    await waitFor(() => expect(batches(r).length).toBe(2));
    expect(batches(r)[1]!.op).toBe("untrash");
    expect(batches(r)[1]!.items.map((x) => x.id).sort()).toEqual(["c1", "o1"]);
    await waitFor(() => expect(subjects()).toEqual(["c1", "s1", "l1", "l2", "o1"]));
  });

  it("a partial result says what was done and what needs attention, keeps those selected, retries only proven failures, and Undo covers only the done", async () => {
    const r = rig({ routes: (path, body) => {
      if (!path.endsWith("/api/email/message") || !Array.isArray(body.items)) return undefined;
      const items = body.items as Array<{ email: string; id: string }>;
      return { status: 200, body: { ok: true, op: body.op, results: items.map((x) => (
        x.id === "s1" ? { ...x, status: "failed", code: "RATE_LIMITED", retryable: true }
          : x.id === "l1" ? { ...x, status: "unknown" }
            : x.id === "o1" ? { ...x, status: "failed", code: "NOT_FOUND", retryable: false }
              : { ...x, status: "accepted", in_inbox: false, read: true, labels: [] })) } };
    } });
    mount(r);
    await waitFor(() => expect(rowEls().length).toBe(5));
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("button", { name: "Select All 5 Loaded" }));
    fireEvent.click(screen.getByRole("button", { name: /^Archive/ }));
    await waitFor(() => expect(document.querySelector(".email-bulk-note")).toBeTruthy());
    const note = document.querySelector(".email-bulk-note")!;
    expect([...note.querySelectorAll(".facts")][0]!.textContent).toBe("2 Archived3 Need Attention");
    expect(note).toHaveTextContent("Gmail Needs a Moment");
    expect(note).toHaveTextContent("Not Confirmed by Gmail");
    expect(note).toHaveTextContent("Not in Saved Mail");
    // The two that Gmail confirmed left; the three stay, still selected, the tray still up.
    expect(subjects()).toEqual(["s1", "l1", "o1"]);
    expect(document.querySelector(".email-selcount")).toHaveTextContent("3 Selected");
    expect(toasts.at(-1)).toMatchObject({ message: "2 Archived", actionLabel: UNDO });
    // Retry Failed sends only the proven, retryable failure.
    fireEvent.click(screen.getByRole("button", { name: "Retry Failed" }));
    await waitFor(() => expect(batches(r).length).toBe(2));
    expect(batches(r)[1]!.items).toEqual([{ email: DAVE, id: "s1" }]);
  });

  it("checks the session before sending anything: signed out, or a mailbox that needs reconnecting, is said and nothing is sent", async () => {
    const r = rig();
    const ui = mount(r, null);
    await waitFor(() => expect(rowEls().length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(rowEls()[0]!);
    fireEvent.click(screen.getByRole("button", { name: /^Read/ }));
    expect(await screen.findByText(SIGN_IN_FIRST)).toBeInTheDocument();
    expect(batches(r)).toEqual([]);
    ui.unmount();

    const r2 = rig({ accounts: [account({ state: "reauth" }), account({ id: "acct-work", address: WORK })] });
    mount(r2);
    await waitFor(() => expect(rowEls().length).toBe(5));
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(rowEls()[0]!);
    fireEvent.click(screen.getByRole("button", { name: /^Unread/ }));
    expect(await screen.findByText(RECONNECT_FIRST)).toBeInTheDocument();
    expect(batches(r2)).toEqual([]);
  });
});

describe("an inbox row swipes (Dave 2026-10-13: swipe is the standard)", () => {
  it("each row carries Archive and Delete, and select mode takes them off", async () => {
    const r = rig();
    mount(r);
    await waitFor(() => expect(rowEls().length).toBe(5));
    expect(document.querySelectorAll(".task-swipe .mail-arch").length).toBe(5);
    expect(document.querySelectorAll(".task-swipe .task-del").length).toBe(5);
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(document.querySelectorAll(".task-swipe").length).toBe(0);
  });
});
