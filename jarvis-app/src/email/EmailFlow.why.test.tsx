// @vitest-environment jsdom
// WHY THIS SECTION? ON THE MESSAGE SHEET (issue 112, item 15; Email v1 spec 3.2: "Click Why this section? for the rule and evidence").
// A message in Grouped view can say why it sits where it does:
//   - the More menu carries Why This Section? right after Move to Section, in Grouped view, for a message the loaded list holds;
//     All by Date has no sections to explain, and a message opened from outside the loaded list carries none of the facts;
//   - it opens a small sheet: the rule, the evidence the rule read, and (for a message the person moved) what it would be without
//     the move. Every line is a fact the resolver really used, so the same rows that are drawn under Money say Money's reason;
//   - the sheet's Move to Section is the same picker, Use Its Own Section is the same receipt and Undo; Done closes it;
//   - reading it sends nothing and changes nothing: no request leaves, no move is written, nothing in Gmail changes.
// Against a fake session, through the real screens. The words are written out here, not imported, so a rename of the copy
// constants cannot pass this by renaming both.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup, configure } from "@testing-library/react";
import "@testing-library/jest-dom";
import EmailFlow from "./EmailFlow";
import { loadOverrides, recordMove, saveView } from "./sections";
import type { EmailAccount, InboxRow, MessageDetail, RpcClient } from "./emailClient";
import { newestFirst } from "./emailClient";
import { subscribeToast, resetToasts, type ToastState } from "../shared/toast";

// Each case mounts the whole home and waits on its rows and its debounced search: a second or two on a busy machine, more while the
// whole suite runs in parallel, so the default one second wait and five second test are not the honest limits.
vi.setConfig({ testTimeout: 20000 });
configure({ asyncUtilTimeout: 5000 });

// Local-time instants, so the clock a move shows reads the same in any zone the suite runs in.
const NOW = new Date(2026, 9, 13, 15, 0, 0);
const MOVED_AT = new Date(2026, 9, 13, 9, 12, 0);
const USER = "user-1";
const DAVE = "dave@example.test";

const ACCOUNT: EmailAccount = { id: "acct-dave", address: DAVE, state: "connected", last_sync_at: "2026-10-13T14:50:00Z", sync_error: null, capabilities: { archive: true, trash: true, read: true }, connected_at: "2026-09-01T00:00:00Z", scopes: [], cached: 6, signature_text: "", signature_revision: 1 };
// A row as the server hands it over after migration 0067: every fact present, null when the header is absent.
const KEPT = { rfc_message_id: null, list_id: null, list_unsubscribe: null, mime_type: null, content_class: null, own_reply: null } as const;
const row = (id: string, iso: string, o: Partial<InboxRow> = {}): InboxRow => ({
  id: `u-${id}`, account_id: "acct-dave", account: DAVE, provider_id: id, thread_id: `t-${id}`, internal_date: iso, from_address: "maya@example.test", from_name: "Maya Chen",
  subject: `Subject ${id}`, snippet: "Can we meet at 10?", has_body: true, attachment_metadata: [], provider_labels: ["INBOX"], source_hash: "sh", read: true, ...KEPT, ...o,
});
// One message in each section, a second Other message that went through the cache before 0067 (it has none of the facts), and a
// message the inbox page does not hold.
const C1 = row("c1", "2026-10-13T12:00:00Z", { own_reply: true });
const S1 = row("s1", "2026-10-13T11:00:00Z", { mime_type: "text/calendar", from_name: "Alex Morgan", from_address: "alex@example.test" });
const M1 = row("m1", "2026-10-13T10:30:00Z", { from_name: "Con Edison", from_address: "noreply@billing.coned.com", subject: "Your Con Edison Bill Is Due" });
const L1 = row("l1", "2026-10-13T10:00:00Z", { list_id: "<news.studio.test>", list_unsubscribe: "<mailto:off@studio.test>", from_name: "Community Studio", from_address: "news@studio.test" });
const O1 = row("o1", "2026-10-12T09:00:00Z", { from_name: "Invoice Desk", subject: "Subject o1 Invoice $40" });
const OLD = (() => {
  const { rfc_message_id: _a, list_id: _b, list_unsubscribe: _c, mime_type: _d, content_class: _e, own_reply: _f, ...rest } = row("old", "2026-10-11T09:00:00Z", { from_name: "Pat Kim" });
  return rest as InboxRow;
})();
const ROWS: InboxRow[] = [C1, S1, M1, L1, O1, OLD];
const OUTSIDE = row("zz", "2026-07-01T09:00:00Z", { subject: "Subject zz" });

const detailOf = (r: InboxRow): MessageDetail => ({
  id: r.id, account_id: r.account_id, account: r.account, provider_id: r.provider_id, thread_id: r.thread_id, internal_date: r.internal_date, from_address: r.from_address, from_name: r.from_name,
  to_addresses: [{ address: DAVE, name: "" }], cc_addresses: [], subject: r.subject, snippet: r.snippet, provider_labels: r.provider_labels, read: r.read, deleted: false, source_hash: r.source_hash,
  attachments: [], has_body: true, text: "Can we meet at 10 on Friday?", html: null,
});

type Fn = (args: Record<string, unknown>) => unknown;
function rig() {
  const all = [...ROWS].sort(newestFirst);
  const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
  const table: Record<string, Fn> = {
    email_accounts: () => [ACCOUNT],
    email_inbox: (a) => ({ rows: all.slice(0, a.p_limit as number), cached_total: all.length, page: a.p_limit }),
    email_message_read: (a) => { const r = [...all, OUTSIDE].find((x) => x.id === a.p_message); return r ? detailOf(r) : { error: "NOT_FOUND" }; },
    email_search_cached: (a) => { const q = String(a.p_q).toLowerCase(); return { rows: [...all, OUTSIDE].filter((r) => r.subject.toLowerCase().includes(q)), coverage: "cached", q: a.p_q, window: all.length }; },
    substrate_readiness: () => ({ registered: [] }),
    candidates_for: () => [],
    candidate_review_count: () => ({ count: 0, messages: 0 }),
  };
  const client: RpcClient = { rpc: async (fn, args) => { const f = table[fn]; if (!f) return { data: null, error: { code: "PGRST202", message: "no fake for " + fn } }; return { data: f((args ?? {}) as Record<string, unknown>), error: null }; } };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    posts.push({ url, body });
    const answer = url.endsWith("/api/email/sync") ? { status: 200, body: { ok: true, synced: 0, removed: 0, next_page: null, complete: true, resynced: false } }
      : url.endsWith("/api/email/message") ? { status: 200, body: { ok: true, message_id: "x", labels: ["INBOX"], read: true, in_inbox: true, in_trash: false, receipt: null } }
        : url.endsWith("/api/email/search") ? { status: 200, body: { ok: true, q: `"${body.q}"`, rows: [...all, OUTSIDE].filter((r) => r.subject.toLowerCase().includes(String(body.q).toLowerCase())), covered: [DAVE], failed: [], next_page: null, coverage: "provider" } }
          : { status: 404, body: { code: "NOT_FOUND" } };
    return { ok: answer.status < 300, status: answer.status, json: async () => answer.body } as Response;
  }));
  return { client, posts };
}

const mount = (r: ReturnType<typeof rig>, extra: Partial<Parameters<typeof EmailFlow>[0]> = {}) =>
  render(<EmailFlow client={r.client} token="jwt" userId={USER} categories={[]} now={() => NOW} onOpenConnections={() => {}} {...extra} />);
const rowEls = () => [...document.querySelectorAll(".erow")] as HTMLElement[];
const rowFor = (subject: string) => rowEls().find((e) => (e.getAttribute("aria-label") ?? "").includes(subject))!;
const headNames = () => [...document.querySelectorAll(".sh2")].map((h) => h.querySelector(".t")!.textContent);
const clean = (t: string | null) => (t ?? "").replace(/ | /g, " ").trim();
/** Tap a row and wait for its message sheet. */
const openSheet = async (subject: string) => {
  await waitFor(() => expect(rowFor(subject)).toBeTruthy());
  fireEvent.click(rowFor(subject));
  await waitFor(() => expect(document.querySelector(".email-actions")).toBeTruthy());
};
const moreButtons = () => [...document.querySelectorAll(".action-sheet button")] as HTMLElement[];
const moreWords = () => moreButtons().map((b) => b.textContent);
const openMore = () => fireEvent.click(screen.getByRole("button", { name: "More" }));
const tapMore = (word: string) => fireEvent.click(moreButtons().find((b) => b.textContent === word)!);
/** The explanation sheet, if one is open. */
const why = () => document.querySelector('[role="dialog"][aria-label="Why This Section?"]') as HTMLElement | null;
const open = async (subject: string) => {
  await openSheet(subject);
  openMore();
  tapMore("Why This Section?");
  await waitFor(() => expect(why()).toBeTruthy());
  return why()!;
};
/** The sheet's rows as the person reads them: the name, then each fact on its line. */
const rowsOf = (d: HTMLElement) => [...d.querySelectorAll(".row")].map((r) => [r.querySelector(".conn-name")!.textContent, [...r.querySelectorAll(".fact")].map((f) => clean(f.textContent))] as const);
const eyebrow = (d: HTMLElement) => d.querySelector(".grp .eyebrow")!.textContent;
const buttonsOf = (d: HTMLElement) => [...d.parentElement!.querySelectorAll(".action-sheet button")].map((b) => b.textContent);
const picker = () => [...document.querySelectorAll(".sheet-scrim")].find((s) => s.querySelector(".grp .eyebrow")?.textContent === "Move to Section") as HTMLElement | undefined;
const lastToast = () => toasts.at(-1)!;

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

describe("the door: the More menu, in Grouped view, for a message the loaded list holds", () => {
  it("Why This Section? sits directly after Move to Section", async () => {
    mount(rig());
    await openSheet("Subject o1");
    openMore();
    const words = moreWords();
    expect(words.filter((w) => w === "Why This Section?")).toHaveLength(1);
    expect(words.indexOf("Why This Section?")).toBe(words.indexOf("Move to Section") + 1);
    // And it is a plain menu entry, the same kind as its neighbours: no pill, no icon, enabled.
    const entry = moreButtons().find((b) => b.textContent === "Why This Section?")!;
    expect(entry).not.toBeDisabled();
    expect(entry.className).toBe("");
  });

  it("every section's message has it, and the face of the sheet gains no row for it (the entry is the one door)", async () => {
    for (const s of ["Subject c1", "Subject s1", "Your Con Edison", "Subject l1", "Subject o1", "Subject old"]) {
      cleanup();
      vi.unstubAllGlobals();
      mount(rig());
      await openSheet(s);
      expect([...document.querySelectorAll(".email-actions .row .conn-name")].map((n) => n.textContent)).not.toContain("Why This Section?");
      openMore();
      expect(moreWords(), s).toContain("Why This Section?");
    }
  });

  it("All by Date has no sections to explain, so the menu does not offer it", async () => {
    saveView(USER, "date");
    mount(rig());
    await openSheet("Subject o1");
    openMore();
    expect(moreWords()).toContain("Move to Section");
    expect(moreWords()).not.toContain("Why This Section?");
  });

  it("a message the loaded list does not hold carries none of the facts, so it is not explained", async () => {
    mount(rig(), { openId: OUTSIDE.id, openNonce: 1 });
    await waitFor(() => expect(document.querySelector(".email-actions")).toBeTruthy());
    openMore();
    expect(moreWords()).toContain("Move to Section");
    expect(moreWords()).not.toContain("Why This Section?");
  });

  it("a search hit the loaded list does not hold has none; one it does hold has it", async () => {
    mount(rig());
    await waitFor(() => expect(rowEls().length).toBe(ROWS.length));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByPlaceholderText("Search Mail"), { target: { value: "Subject zz" } });
    await waitFor(() => expect(rowFor("Subject zz")).toBeTruthy());
    fireEvent.click(rowFor("Subject zz"));
    await waitFor(() => expect(document.querySelector(".email-actions")).toBeTruthy());
    openMore();
    expect(moreWords()).not.toContain("Why This Section?");
    cleanup();
    vi.unstubAllGlobals();
    mount(rig());
    await waitFor(() => expect(rowEls().length).toBe(ROWS.length));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByPlaceholderText("Search Mail"), { target: { value: "Subject o1" } });
    await waitFor(() => expect(rowFor("Subject o1")).toBeTruthy());
    fireEvent.click(rowFor("Subject o1"));
    await waitFor(() => expect(document.querySelector(".email-actions")).toBeTruthy());
    openMore();
    expect(moreWords()).toContain("Why This Section?");
  });
});

describe("the sheet says the rule that decided, and the evidence it read", () => {
  it("Conversations: you sent a message in the thread, found in this mailbox's synced mail", async () => {
    mount(rig());
    const d = await open("Subject c1");
    expect(eyebrow(d)).toBe("In Conversations");
    expect(rowsOf(d)).toEqual([["Rule", ["You Sent a Message in This Thread"]], ["Evidence", ["Sent Message in Synced Mail", DAVE]]]);
    // It names no message: own_reply is one yes or no for the thread.
    expect(d.textContent).not.toMatch(/Subject c1/);
  });

  it("Schedule: the calendar structure it carries, by name", async () => {
    mount(rig());
    const d = await open("Subject s1");
    expect(eyebrow(d)).toBe("In Schedule");
    expect(rowsOf(d)).toEqual([["Rule", ["It Has Calendar Structure"]], ["Evidence", ["Message Type Is Calendar"]]]);
  });

  it("Money: the registered sender, the issuer and the registry's word for it, from the sender and subject alone", async () => {
    mount(rig());
    const d = await open("Your Con Edison");
    expect(eyebrow(d)).toBe("In Money");
    expect(rowsOf(d)).toEqual([["Rule", ["It Matches a Money Sender Template"]], ["Evidence", ["Con Edison", "Invoice", "noreply@billing.coned.com"]]]);
    // The registry's internals are not for the screen: no template id, no version, no subject.
    expect(d.textContent).not.toMatch(/coned\.bill|version|Bill Is Due/i);
  });

  it("Mailing Lists: which headers it carries", async () => {
    mount(rig());
    const d = await open("Subject l1");
    expect(eyebrow(d)).toBe("In Mailing Lists");
    expect(rowsOf(d)).toEqual([["Rule", ["It Has a Mailing List Header"]], ["Evidence", ["List-ID and List-Unsubscribe Headers"]]]);
  });

  it("Other with its facts kept: no rule matched, and nothing is invented to fill a second row", async () => {
    mount(rig());
    const d = await open("Subject o1");
    expect(eyebrow(d)).toBe("In Other");
    expect(rowsOf(d)).toEqual([["Rule", ["No Section Rule Matched"]]]);
    // The subject says Invoice and carries an amount; words never decide.
    expect(d.textContent).not.toMatch(/Invoice|\$40/);
  });

  it("Other for a message cached before the facts were kept: says the facts are not kept, rather than imply a rule ran", async () => {
    mount(rig());
    const d = await open("Subject old");
    expect(eyebrow(d)).toBe("In Other");
    expect(rowsOf(d)).toEqual([["Rule", ["No Section Rule Matched"]], ["Evidence", ["Facts Not Kept for This Message"]]]);
  });
});

describe("a message the person moved", () => {
  it("says it was moved, that the move stays on this phone and when it was made, and what the message would be without it", async () => {
    recordMove(USER, M1, "lists", MOVED_AT);
    mount(rig());
    const d = await open("Your Con Edison");
    expect(eyebrow(d)).toBe("In Mailing Lists");
    expect(rowsOf(d)).toEqual([
      ["Rule", ["You Moved It Here"]],
      ["Evidence", ["Saved on This Phone Only", "Today", "9:12 AM"]],
      ["Without Your Move", ["Money"]],
    ]);
    // The section its own facts give is named with that section's dot, not as a second grey.
    const without = [...d.querySelectorAll(".row")][2]!;
    expect(without.querySelector(".fact.cat .cd")).toHaveClass("cat-bg-teal");
  });

  it("a move that has no stored time says nothing about when, and a message that would be Other says so in white", async () => {
    window.localStorage.setItem(`jarvis.email.sectionOverride.v1:${USER}`, JSON.stringify({ [O1.id]: "money" }));
    mount(rig());
    const d = await open("Subject o1");
    expect(rowsOf(d)).toEqual([["Rule", ["You Moved It Here"]], ["Evidence", ["Saved on This Phone Only"]], ["Without Your Move", ["Other"]]]);
    expect([...d.querySelectorAll(".row")][2]!.querySelector(".fact b")).toHaveTextContent("Other");
  });

  it("a moved message whose facts were never kept carries that caveat on what it would be", async () => {
    recordMove(USER, OLD, "money", MOVED_AT);
    mount(rig());
    const d = await open("Subject old");
    expect(rowsOf(d)[2]).toEqual(["Without Your Move", ["Other", "Facts Not Kept for This Message"]]);
  });

  it("offers Use Its Own Section only for a moved message; Move to Section for every one", async () => {
    mount(rig());
    let d = await open("Subject o1");
    expect(buttonsOf(d)).toEqual(["Move to Section", "Done"]);
    cleanup();
    vi.unstubAllGlobals();
    recordMove(USER, O1, "money", MOVED_AT);
    mount(rig());
    d = await open("Subject o1");
    expect(buttonsOf(d)).toEqual(["Move to Section", "Use Its Own Section", "Done"]);
  });
});

describe("what the sheet's own buttons do", () => {
  it("Move to Section closes the sheet and opens the same picker, the other four sections, then a pick moves the message with its receipt", async () => {
    mount(rig());
    await waitFor(() => expect(rowEls().length).toBe(ROWS.length));
    const d = await open("Subject o1");
    fireEvent.click(within(d.parentElement!).getByRole("button", { name: "Move to Section" }));
    expect(why()).toBeNull();
    expect([...picker()!.querySelectorAll(".action-sheet button")].map((b) => b.textContent)).toEqual(["Conversations", "Schedule", "Money", "Mailing Lists", "Cancel"]);
    fireEvent.click(within(picker()!).getByRole("button", { name: "Money" }));
    expect(loadOverrides(USER)).toEqual({ [O1.id]: "money" });
    expect(lastToast()).toMatchObject({ message: "Moved to Money", actionLabel: "Undo" });
    expect(document.querySelector(".sheet-scrim")).toBeNull();
    // Asked again, the same message explains the move.
    await openSheet("Subject o1");
    openMore();
    tapMore("Why This Section?");
    await waitFor(() => expect(why()).toBeTruthy());
    expect(rowsOf(why()!).map((r) => r[0])).toEqual(["Rule", "Evidence", "Without Your Move"]);
    expect(rowsOf(why()!)[0]).toEqual(["Rule", ["You Moved It Here"]]);
    expect(rowsOf(why()!)[2]).toEqual(["Without Your Move", ["Other"]]);
  });

  it("Use Its Own Section puts the message back with its receipt and Undo, and the move is gone", async () => {
    recordMove(USER, O1, "money", MOVED_AT);
    mount(rig());
    await waitFor(() => expect(headNames()).toContain("Money"));
    const d = await open("Subject o1");
    fireEvent.click(within(d.parentElement!).getByRole("button", { name: "Use Its Own Section" }));
    expect(loadOverrides(USER)).toEqual({});
    expect(why()).toBeNull();
    expect(document.querySelector(".sheet-scrim")).toBeNull();
    expect(lastToast()).toMatchObject({ message: "Back in Its Own Section", actionLabel: "Undo" });
    expect(headNames()).toEqual(["Conversations", "Schedule", "Money", "Mailing Lists", "Other"]);
  });

  it("Done closes the sheet and moves nothing", async () => {
    mount(rig());
    const d = await open("Subject o1");
    fireEvent.click(within(d.parentElement!).getByRole("button", { name: "Done" }));
    expect(why()).toBeNull();
    expect(loadOverrides(USER)).toEqual({});
    // The message sheet is still there underneath.
    expect(document.querySelector(".email-actions")).toBeTruthy();
  });

  it("a tap on the scrim outside the sheet closes it too", async () => {
    mount(rig());
    const d = await open("Subject o1");
    fireEvent.click(d.parentElement!);
    expect(why()).toBeNull();
    expect(document.querySelector(".email-actions")).toBeTruthy();
  });
});

describe("reading the explanation changes nothing", () => {
  it("no request leaves, no move is written, and the message's flags, labels and place in Gmail are untouched", async () => {
    const r = rig();
    mount(r);
    await waitFor(() => expect(rowEls().length).toBe(ROWS.length));
    await openSheet("Subject o1");
    const before = r.posts.filter((p) => !p.url.endsWith("/api/email/sync")).length;
    const written = JSON.stringify(Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
    openMore();
    tapMore("Why This Section?");
    await waitFor(() => expect(why()).toBeTruthy());
    fireEvent.click(within(why()!.parentElement!).getByRole("button", { name: "Done" }));
    expect(r.posts.filter((p) => !p.url.endsWith("/api/email/sync")).length).toBe(before);
    expect(JSON.stringify(Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])))).toBe(written);
    expect(toasts).toEqual([]);
  });

  it("offers no per-sender rule anywhere: no Always Use, no Rule builder, no Every Message From", async () => {
    mount(rig());
    const d = await open("Your Con Edison");
    expect(d.parentElement!.textContent).not.toMatch(/always|every message|this sender|rule builder|for this sender/i);
  });
});

describe("the sheet follows the catalog, in the DOM", () => {
  it("is a dialog with a name; its rows hold no control; its actions are the sheet's own; the head is the section", async () => {
    mount(rig());
    const d = await open("Your Con Edison");
    expect(d).toHaveAttribute("aria-label", "Why This Section?");
    for (const r of d.querySelectorAll(".row")) expect(r.querySelector("button, .pill-act, .row-act, .btn-sm, .quiet-action, a")).toBeNull();
    expect(d.querySelectorAll(".action-sheet button").length).toBe(1);
    expect(d.parentElement!.querySelectorAll(".action-sheet button.cancel")).toHaveLength(1);
    // Facts are spans; the dot between them is the stylesheet's, never a character in a string.
    for (const f of d.querySelectorAll(".fact")) { expect(f.tagName).toBe("SPAN"); expect(f.textContent).not.toMatch(/[·•]| - /); }
  });
});
