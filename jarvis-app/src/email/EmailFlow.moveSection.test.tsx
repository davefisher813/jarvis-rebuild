// @vitest-environment jsdom
// MOVE TO SECTION, WIRED ONTO THE MESSAGE (issue 104, Dave 2026-10-13: "Email Sections is unreachable"). The control lived
// as the tenth and last row of the message sheet's More menu and gave no sign it had done anything, so a person who tapped
// it and then looked at an unchanged list (All by Date, or a sheet still open over the list) saw a dead button. Now:
//   - the message sheet's face carries a Move to Section row (the Email teal tile, the section it sits in as its one fact),
//     in the inbox, in Search and in the Review list, because all three open the same sheet; the More entry stays;
//   - a pick writes the move, CLOSES the sheet (a toast is painted behind an open sheet, so it could never be seen) and
//     raises "Moved to Money" with an Undo that sets the section the message was in; Use Its Own Section says
//     "Back in Its Own Section" the same way;
//   - Settings lists the move with Put Back, and reads the same key the tab writes when there is no signed-in id.
// Against a fake session, through the real screens. Every case runs with fetch trapped to the mail routes it needs.
// The words are written out here, not imported, so a rename of the copy constants cannot pass this by renaming both.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import EmailFlow from "./EmailFlow";
import { listMoves, loadOverrides, loadView, saveView } from "./sections";
import { saveSnapshot } from "./deviceCache";
import type { EmailAccount, InboxRow, MessageDetail, RpcClient } from "./emailClient";
import { newestFirst } from "./emailClient";
import { subscribeToast, resetToasts, type ToastState } from "../shared/toast";
import { NotesProvider } from "../data/NotesProvider";
import EmailSectionsPage from "../settings/EmailSectionsPage";

const NOW = new Date("2026-10-13T15:00:00Z");
const USER = "user-1";
const DAVE = "dave@example.test";

const ACCOUNT: EmailAccount = { id: "acct-dave", address: DAVE, state: "connected", last_sync_at: "2026-10-13T14:50:00Z", sync_error: null, capabilities: { archive: true, trash: true, read: true }, connected_at: "2026-09-01T00:00:00Z", scopes: [], cached: 4, signature_text: "", signature_revision: 1 };
const row = (id: string, iso: string, o: Partial<InboxRow> = {}): InboxRow => ({
  id: `u-${id}`, account_id: "acct-dave", account: DAVE, provider_id: id, thread_id: `t-${id}`, internal_date: iso, from_address: "maya@example.test", from_name: "Maya Chen",
  subject: `Subject ${id}`, snippet: "Can we meet at 10?", has_body: true, attachment_metadata: [], provider_labels: ["INBOX"], source_hash: "sh", read: true, ...o,
});
// One message in each of four sections; o1 has an invoice word and an amount in its subject, which never make it Money.
const ROWS: InboxRow[] = [
  row("c1", "2026-10-13T12:00:00Z", { own_reply: true }),
  row("s1", "2026-10-13T11:00:00Z", { mime_type: "text/calendar", from_name: "Alex Morgan", from_address: "alex@example.test" }),
  row("l1", "2026-10-13T10:00:00Z", { list_id: "<news.studio.test>", from_name: "Community Studio", from_address: "news@studio.test" }),
  row("o1", "2026-10-12T09:00:00Z", { from_name: "Invoice Desk", subject: "Subject o1 Invoice $40" }),
];
// A message the inbox page does not hold (an older one a deep link opens): its facts are not in the loaded list.
const OLDER = row("zz", "2026-07-01T09:00:00Z", { subject: "Subject zz" });

const detailOf = (r: InboxRow): MessageDetail => ({
  id: r.id, account_id: r.account_id, account: r.account, provider_id: r.provider_id, thread_id: r.thread_id, internal_date: r.internal_date, from_address: r.from_address, from_name: r.from_name,
  to_addresses: [{ address: DAVE, name: "" }], cc_addresses: [], subject: r.subject, snippet: r.snippet, provider_labels: r.provider_labels, read: r.read, deleted: false, source_hash: r.source_hash,
  attachments: [], has_body: true, text: "Can we meet at 10 on Friday?", html: null,
});

type Fn = (args: Record<string, unknown>) => unknown;
function rig(extra: Partial<Record<string, Fn>> = {}) {
  const all = [...ROWS].sort(newestFirst);
  const table: Record<string, Fn> = {
    email_accounts: () => [ACCOUNT],
    email_inbox: (a) => ({ rows: all.slice(0, a.p_limit as number), cached_total: all.length, page: a.p_limit }),
    email_message_read: (a) => { const r = [...all, OLDER].find((x) => x.id === a.p_message); return r ? detailOf(r) : { error: "NOT_FOUND" }; },
    email_search_cached: (a) => { const q = String(a.p_q).toLowerCase(); return { rows: all.filter((r) => r.subject.toLowerCase().includes(q)), coverage: "cached", q: a.p_q, window: all.length }; },
    substrate_readiness: () => ({ registered: [] }),
    candidates_for: () => [],
    candidate_review_count: () => ({ count: 0, messages: 0 }),
    ...extra,
  };
  const client: RpcClient = { rpc: async (fn, args) => { const f = table[fn]; if (!f) return { data: null, error: { code: "PGRST202", message: "no fake for " + fn } }; return { data: f((args ?? {}) as Record<string, unknown>), error: null }; } };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const answer = url.endsWith("/api/email/sync") ? { status: 200, body: { ok: true, synced: 0, removed: 0, next_page: null, complete: true, resynced: false } }
      : url.endsWith("/api/email/message") ? { status: 200, body: { ok: true, message_id: "x", labels: ["INBOX"], read: true, in_inbox: true, in_trash: false, receipt: null } }
        : url.endsWith("/api/email/search") ? { status: 200, body: { ok: true, q: `"${body.q}"`, rows: all.filter((r) => r.subject.toLowerCase().includes(String(body.q).toLowerCase())), covered: [DAVE], failed: [], next_page: null, coverage: "provider" } }
          : { status: 404, body: { code: "NOT_FOUND" } };
    return { ok: answer.status < 300, status: answer.status, json: async () => answer.body } as Response;
  }));
  return { client };
}

const mount = (r: ReturnType<typeof rig>, extra: Partial<Parameters<typeof EmailFlow>[0]> = {}) =>
  render(<EmailFlow client={r.client} token="jwt" userId={USER} categories={[]} now={() => NOW} onOpenConnections={() => {}} {...extra} />);
const rowEls = () => [...document.querySelectorAll(".erow")] as HTMLElement[];
const rowOf = (id: string) => rowEls().find((e) => new RegExp(`Subject ${id}\\b`).test(e.getAttribute("aria-label") ?? ""))!;
const heads = () => [...document.querySelectorAll(".sh2")].map((h) => [h.querySelector(".t")!.textContent, h.querySelector(".n")!.textContent]);
const headNames = () => heads().map((h) => h[0]);
/** The message sheet's own card (a portal, so it is never inside render's container). */
const sheetOpen = () => document.querySelector(".msg-sheet-bar") !== null;
const faceRows = () => [...document.querySelectorAll(".email-actions .row")] as HTMLElement[];
const faceRow = () => faceRows().find((r) => r.querySelector(".conn-name")?.textContent === "Move to Section");
/** The picker: the RowActionSheet titled Move to Section (the face row and the More entry carry the same words, the sheet's title is its own). */
const picker = () => [...document.querySelectorAll(".sheet-scrim")].find((s) => s.querySelector(".grp .eyebrow")?.textContent === "Move to Section") as HTMLElement | undefined;
const pickerWords = () => [...picker()!.querySelectorAll(".action-sheet button")].map((b) => b.textContent);
/** Tap a row and wait for its sheet. */
const openSheet = async (id: string) => {
  await waitFor(() => expect(rowOf(id)).toBeTruthy());
  fireEvent.click(rowOf(id));
  await waitFor(() => expect(document.querySelector(".email-actions")).toBeTruthy());
};
/** The same, and wait for the Move to Section row on its face. */
const open = async (id: string) => {
  await openSheet(id);
  await waitFor(() => expect(faceRow()).toBeTruthy());
};
/** Move a message to a section through the More menu's entry, the second door (the face row is not needed). */
const moveViaMore = async (id: string, word: string) => {
  await openSheet(id);
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  fireEvent.click([...document.querySelectorAll(".action-sheet button")].find((b) => b.textContent === "Move to Section")!);
  pick(word);
};
const pick = (word: string) => fireEvent.click(within(picker()!).getByRole("button", { name: word }));
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

describe("the message sheet's face: Move to Section", () => {
  it("sits between Track This and Archive, wears Email's teal, names the section the message sits in as its one fact, and is a plain row with no pill", async () => {
    mount(rig());
    await open("o1");
    const names = faceRows().map((r) => r.querySelector(".conn-name")?.textContent);
    expect(names.filter((n) => n === "Move to Section")).toHaveLength(1);
    expect(names.indexOf("Track This")).toBeGreaterThanOrEqual(0);
    expect(names.indexOf("Move to Section")).toBeGreaterThan(names.indexOf("Track This"));
    expect(names.indexOf("Archive")).toBeGreaterThan(names.indexOf("Move to Section"));
    const r = faceRow()!;
    expect(r.querySelector(".sec-ico")).toHaveClass("ico-teal");
    expect(r.querySelector(".chev")).not.toBeNull();
    // The catalog, in the DOM: one fact, a span, no dot in the string, Title Case, not a pill, a real row (a button to a keyboard, 44px by .row).
    const facts = [...r.querySelectorAll(".fact")];
    expect(facts.map((f) => f.textContent)).toEqual(["Other"]);
    expect(facts[0]!.tagName).toBe("SPAN");
    expect(r.textContent).not.toMatch(/[·•]/);
    expect(r.querySelector(".pill-act, .row-act, .btn-sm, .quiet-action, button")).toBeNull();
    expect(r).toHaveClass("row");
    expect(r).toHaveAttribute("role", "button");
    expect(r).toHaveAttribute("tabindex", "0");
    expect(r).not.toHaveClass("dim");
    expect(r).not.toHaveAttribute("aria-disabled");
  });

  it("opens the picker with the other four sections, never the one it is in, and no Use Its Own Section before there is a move", async () => {
    mount(rig());
    await open("o1");
    fireEvent.click(faceRow()!);
    expect(pickerWords()).toEqual(["Conversations", "Schedule", "Money", "Mailing Lists", "Cancel"]);
  });

  it("a pick writes the move, closes the sheet so the receipt can be seen, regroups the list, and says 'Moved to Money' with an Undo", async () => {
    mount(rig());
    await waitFor(() => expect(rowEls().length).toBe(4));
    expect(heads()).toEqual([["Conversations", "1 Loaded"], ["Schedule", "1 Loaded"], ["Mailing Lists", "1 Loaded"], ["Other", "1 Loaded"]]);
    await open("o1");
    fireEvent.click(faceRow()!);
    pick("Money");
    expect(loadOverrides(USER)).toEqual({ "u-o1": "money" });
    // No sheet is left open over the list: a toast under a scrim is invisible and its Undo cannot be tapped.
    expect(sheetOpen()).toBe(false);
    expect(document.querySelector(".sheet-scrim")).toBeNull();
    expect(lastToast()).toMatchObject({ message: "Moved to Money", actionLabel: "Undo" });
    expect(typeof lastToast().onAction).toBe("function");
    expect(heads()).toEqual([["Conversations", "1 Loaded"], ["Schedule", "1 Loaded"], ["Money", "1 Loaded"], ["Mailing Lists", "1 Loaded"]]);
  });

  it("Undo SETS the section the message was in, never toggles: twice, or late, lands on the same answer", async () => {
    mount(rig());
    await open("o1");
    fireEvent.click(faceRow()!);
    pick("Money");
    const undo = lastToast();
    act(() => { undo.onAction!(); });
    expect(loadOverrides(USER)).toEqual({});
    expect(headNames()).toEqual(["Conversations", "Schedule", "Mailing Lists", "Other"]);
    act(() => { undo.onAction!(); });
    expect(loadOverrides(USER)).toEqual({});
    expect(headNames()).toEqual(["Conversations", "Schedule", "Mailing Lists", "Other"]);
  });

  it("a message that already has a move names it, can go to another section, and Undo goes back to the earlier move, not to its own section", async () => {
    mount(rig());
    await open("o1");
    fireEvent.click(faceRow()!);
    pick("Money");
    await open("o1");
    expect(faceRow()!.querySelector(".fact")).toHaveTextContent("Money");
    fireEvent.click(faceRow()!);
    // Money is where it is, so it is not offered; Other is, now that it is not where it sits; its own section is one tap.
    expect(pickerWords()).toEqual(["Conversations", "Schedule", "Mailing Lists", "Other", "Use Its Own Section", "Cancel"]);
    pick("Schedule");
    expect(loadOverrides(USER)).toEqual({ "u-o1": "schedule" });
    expect(lastToast()).toMatchObject({ message: "Moved to Schedule", actionLabel: "Undo" });
    act(() => { lastToast().onAction!(); });
    expect(loadOverrides(USER)).toEqual({ "u-o1": "money" });
    expect(headNames()).toEqual(["Conversations", "Schedule", "Money", "Mailing Lists"]);
  });

  it("Undo of a move made over an earlier one puts the earlier move back exactly as it was, its time included (Settings lists newest first)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-13T16:00:00Z"));
      mount(rig());
      await open("o1");
      fireEvent.click(faceRow()!);
      pick("Money");
      expect(listMoves(USER)[0]).toMatchObject({ key: "money", at: "2026-10-13T16:00:00.000Z" });
      vi.setSystemTime(new Date("2026-10-13T17:30:00Z"));
      await open("o1");
      fireEvent.click(faceRow()!);
      pick("Schedule");
      expect(listMoves(USER)[0]).toMatchObject({ key: "schedule", at: "2026-10-13T17:30:00.000Z" });
      vi.setSystemTime(new Date("2026-10-13T18:00:00Z"));
      act(() => { lastToast().onAction!(); });
      expect(listMoves(USER)[0]).toMatchObject({ key: "money", at: "2026-10-13T16:00:00.000Z", subject: "Subject o1 Invoice $40" });
    } finally { vi.useRealTimers(); }
  });

  it("Use Its Own Section clears the move, says 'Back in Its Own Section' with an Undo that sets the move again", async () => {
    mount(rig());
    await open("o1");
    fireEvent.click(faceRow()!);
    pick("Money");
    await open("o1");
    fireEvent.click(faceRow()!);
    pick("Use Its Own Section");
    expect(loadOverrides(USER)).toEqual({});
    expect(sheetOpen()).toBe(false);
    expect(lastToast()).toMatchObject({ message: "Back in Its Own Section", actionLabel: "Undo" });
    expect(headNames()).toEqual(["Conversations", "Schedule", "Mailing Lists", "Other"]);
    act(() => { lastToast().onAction!(); });
    expect(loadOverrides(USER)).toEqual({ "u-o1": "money" });
    expect(headNames()).toEqual(["Conversations", "Schedule", "Money", "Mailing Lists"]);
  });

  it("cancelling the picker moves nothing and says nothing", async () => {
    mount(rig());
    await open("o1");
    fireEvent.click(faceRow()!);
    const before = toasts.length;
    fireEvent.click(within(picker()!).getByRole("button", { name: "Cancel" }));
    expect(loadOverrides(USER)).toEqual({});
    expect(toasts.length).toBe(before);
    expect(picker()).toBeUndefined();
    expect(sheetOpen()).toBe(true);
  });

  it("is local to this phone: offline the row is not dimmed, the picker opens, and the move is kept and said", async () => {
    saveSnapshot(USER, { accounts: [ACCOUNT], rows: ROWS }, () => NOW.toISOString());
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    mount(rig());
    await open("o1");
    expect(faceRow()).not.toHaveClass("dim");
    fireEvent.click(faceRow()!);
    pick("Schedule");
    expect(loadOverrides(USER)).toEqual({ "u-o1": "schedule" });
    expect(lastToast()).toMatchObject({ message: "Moved to Schedule", actionLabel: "Undo" });
  });

  it("a message opened from outside the loaded list has the row but no fact: the list holds none of its facts, so nothing is guessed", async () => {
    mount(rig(), { openId: OLDER.id, openNonce: 1 });
    await waitFor(() => expect(faceRow()).toBeTruthy());
    expect(faceRow()!.querySelector(".fact")).toBeNull();
    expect(faceRow()!.querySelector(".facts, .conn-meta")).toBeNull();
    fireEvent.click(faceRow()!);
    pick("Money");
    expect(loadOverrides(USER)).toEqual({ [OLDER.id]: "money" });
    expect(lastToast()).toMatchObject({ message: "Moved to Money", actionLabel: "Undo" });
  });
});

describe("All by Date: the receipt is the confirmation, and the person's view is theirs", () => {
  it("the pick records the move and raises the receipt, the list does not regroup, and the saved view stays All by Date", async () => {
    saveView(USER, "date");
    mount(rig());
    await waitFor(() => expect(rowEls().length).toBe(4));
    const order = rowEls().map((e) => e.getAttribute("aria-label"));
    expect(headNames()).toEqual(["Today", "Yesterday"]);
    await open("o1");
    fireEvent.click(faceRow()!);
    pick("Money");
    expect(loadOverrides(USER)).toEqual({ "u-o1": "money" });
    expect(lastToast()).toMatchObject({ message: "Moved to Money", actionLabel: "Undo" });
    expect(sheetOpen()).toBe(false);
    expect(headNames()).toEqual(["Today", "Yesterday"]);
    expect(rowEls().map((e) => e.getAttribute("aria-label"))).toEqual(order);
    expect(loadView(USER)).toBe("date");
    expect(screen.getByRole("tab", { name: "All by Date" })).toHaveAttribute("aria-selected", "true");
    // The move is not lost on the way: Grouped shows it.
    fireEvent.click(screen.getByRole("tab", { name: "Grouped" }));
    expect(headNames()).toEqual(["Conversations", "Schedule", "Money", "Mailing Lists"]);
  });
});

describe("the second door: the More menu", () => {
  it("still carries Move to Section, opens the same picker, and a pick behaves the same: the move, the sheet closed, the receipt with its Undo", async () => {
    mount(rig());
    await openSheet("o1");
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const more = [...document.querySelectorAll(".action-sheet button")].filter((b) => b.textContent === "Move to Section");
    expect(more).toHaveLength(1);
    fireEvent.click(more[0]!);
    expect(pickerWords()).toEqual(["Conversations", "Schedule", "Money", "Mailing Lists", "Cancel"]);
    pick("Mailing Lists");
    expect(loadOverrides(USER)).toEqual({ "u-o1": "lists" });
    expect(sheetOpen()).toBe(false);
    expect(document.querySelector(".sheet-scrim")).toBeNull();
    expect(lastToast()).toMatchObject({ message: "Moved to Mailing Lists", actionLabel: "Undo" });
    act(() => { lastToast().onAction!(); });
    expect(loadOverrides(USER)).toEqual({});
  });

  it("with the face row there, the sheet and the More menu are two doors to one picker", async () => {
    mount(rig());
    await open("o1");
    expect(screen.getAllByText("Move to Section")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getAllByText("Move to Section")).toHaveLength(2);
    fireEvent.click([...document.querySelectorAll(".action-sheet button")].find((b) => b.textContent === "Move to Section")!);
    expect(pickerWords()).toEqual(["Conversations", "Schedule", "Money", "Mailing Lists", "Cancel"]);
  });
});

describe("every way into a message has the row", () => {
  it("Search: the row is on the sheet a result opens, a pick closes it back to the same search, and the receipt goes up", async () => {
    mount(rig());
    await waitFor(() => expect(rowEls().length).toBe(4));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByPlaceholderText("Search Mail"), { target: { value: "Subject o1" } });
    await waitFor(() => expect(rowOf("o1")).toBeTruthy());
    fireEvent.click(rowOf("o1"));
    await waitFor(() => expect(faceRow()).toBeTruthy());
    expect(faceRow()!.querySelector(".fact")).toHaveTextContent("Other");
    fireEvent.click(faceRow()!);
    pick("Schedule");
    expect(loadOverrides(USER)).toEqual({ "u-o1": "schedule" });
    expect(sheetOpen()).toBe(false);
    expect(lastToast()).toMatchObject({ message: "Moved to Schedule", actionLabel: "Undo" });
    expect(screen.getByPlaceholderText("Search Mail")).toHaveValue("Subject o1");
  });

  it("Review: the row is on the sheet a review row opens, a pick closes it back to the review list, and the receipt goes up", async () => {
    const r = rig({ candidates_to_review: () => ({ count: 1, rows: [ROWS[3]], candidates: [] }) });
    mount(r, { focus: { kind: "candidates" }, focusNonce: 1 });
    await waitFor(() => expect(screen.getAllByText("To Review").length).toBeGreaterThan(0));
    await waitFor(() => expect(rowOf("o1")).toBeTruthy());
    fireEvent.click(rowOf("o1"));
    await waitFor(() => expect(faceRow()).toBeTruthy());
    fireEvent.click(faceRow()!);
    pick("Money");
    expect(loadOverrides(USER)).toEqual({ "u-o1": "money" });
    expect(sheetOpen()).toBe(false);
    expect(lastToast()).toMatchObject({ message: "Moved to Money", actionLabel: "Undo" });
    // Back on the review list, not the inbox.
    expect(screen.getAllByText("To Review").length).toBeGreaterThan(0);
    expect(rowOf("o1")).toBeTruthy();
  });
});

describe("Settings lists the move, and the two screens agree on whose it is", () => {
  const settings = (props: Record<string, unknown> = {}) => render(<NotesProvider userId={USER}><EmailSectionsPage onBack={() => {}} userId={USER} {...props} /></NotesProvider>);

  it("a move made from the message sheet is in Email Sections with its section and sender, and Put Back returns it to the tab", async () => {
    const view = mount(rig());
    await open("o1");
    fireEvent.click(faceRow()!);
    pick("Money");
    view.unmount();
    settings();
    const settingsRows = [...document.querySelectorAll(".set-row")];
    expect(settingsRows.map((e) => e.querySelector(".conn-name")!.textContent)).toEqual(["Subject o1 Invoice $40"]);
    expect([...settingsRows[0]!.querySelectorAll(".conn-meta .fact")].map((f) => f.textContent)).toEqual(["In Money", "Invoice Desk"]);
    fireEvent.click(screen.getByText("Subject o1 Invoice $40"));
    fireEvent.click(within(document.querySelector(".sheet-scrim") as HTMLElement).getByRole("button", { name: "Put Back" }));
    expect(loadOverrides(USER)).toEqual({});
    expect(screen.getByText("No Moves Yet")).toBeInTheDocument();
    cleanup();
    mount(rig());
    await waitFor(() => expect(rowEls().length).toBe(4));
    expect(headNames()).toEqual(["Conversations", "Schedule", "Mailing Lists", "Other"]);
  });

  it("with no signed-in id at all the tab files the move under 'local' and Settings reads the same key", async () => {
    const r = rig();
    const view = render(<EmailFlow client={r.client} token="jwt" categories={[]} now={() => NOW} onOpenConnections={() => {}} />);
    await moveViaMore("o1", "Money");
    expect(loadOverrides("local")).toEqual({ "u-o1": "money" });
    expect(loadOverrides("")).toEqual({});
    view.unmount();
    render(<EmailSectionsPage onBack={() => {}} />);
    expect(screen.getByText("Subject o1 Invoice $40")).toBeInTheDocument();
    expect(screen.queryByText("No Moves Yet")).toBeNull();
  });
});
