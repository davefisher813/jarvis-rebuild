// @vitest-environment jsdom
// THE ONE-TIME USE GROUPED MAIL EXPLAINER, END TO END AGAINST A FAKE SESSION (issue 112, item 17; Email v1 spec 2.2 and AC01:
// "First grouped-view choice: explain factual grouping; explicit selection persisted; All by date available").
// "Shows once, dismissible, never shown again after dismissal" is read as: until it is dealt with, then never again. It is dealt
// with three ways, each permanent and per person on this device: Use Grouped Mail (the explicit approval), the Dismiss X, and
// any tap on the Grouped / All by Date control. It is drawn at the top of the Grouped list and nowhere else: never in All by
// Date, never over an empty, loading or failed inbox, never while selecting, never in Search, never under Waiting. It makes no
// call, and the words of the card are not a button (the approval is explicit).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, fireEvent, waitFor, cleanup, within, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import EmailFlow from "./EmailFlow";
import { EMAIL_TITLE, EMPTY_ACCOUNTS, EMPTY_INBOX, GROUPED_INTRO_SUB, GROUPED_INTRO_TITLE, USE_GROUPED, VIEW_DATE, VIEW_GROUPED } from "./copy";
import type { EmailAccount, InboxRow, RpcClient } from "./emailClient";
import { newestFirst } from "./emailClient";
import { loadGroupedIntroDone, loadView, saveGroupedIntroDone, saveView } from "./sections";

const NOW = new Date("2026-10-03T15:00:00Z");
const USER = "user-1";
const DAVE = "dave@example.test";
const WORK = "work@example.test";
const KEY = `jarvis.email.groupedIntro.v1:${USER}`;
const VIEW_KEY = `jarvis.email.homeView.v1:${USER}`;
const SECTIONS = ["Conversations", "Schedule", "Mailing Lists", "Other"];

const account = (o: Partial<EmailAccount>): EmailAccount => ({ id: "acct-dave", address: DAVE, state: "connected", last_sync_at: "2026-10-03T14:50:00Z", sync_error: null, capabilities: { archive: true, trash: true, read: true }, connected_at: "2026-09-01T00:00:00Z", scopes: [], cached: 4, signature_text: "", signature_revision: 1, ...o });
const accounts: EmailAccount[] = [account({}), account({ id: "acct-work", address: WORK })];

const row = (id: string, iso: string, o: Partial<InboxRow> = {}): InboxRow => ({
  id: `u-${id}`, account_id: "acct-dave", account: DAVE, provider_id: id, thread_id: `t-${id}`, internal_date: iso, from_address: "maya@example.test", from_name: "Maya Chen",
  subject: `Subject ${id}`, snippet: "Can we meet at 10?", has_body: false, attachment_metadata: [], provider_labels: ["INBOX"], source_hash: "sh", read: true, ...o,
});
const ROWS: InboxRow[] = [
  row("c1", "2026-10-03T12:00:00Z", { own_reply: true, read: false }),
  row("s1", "2026-10-03T11:00:00Z", { mime_type: "text/calendar", from_name: "Alex Morgan", from_address: "alex@example.test" }),
  row("l1", "2026-10-03T10:00:00Z", { list_id: "<news.studio.test>", from_name: "Community Studio", from_address: "news@studio.test" }),
  row("l2", "2026-10-03T09:00:00Z", { account_id: "acct-work", account: WORK, list_unsubscribe: "<mailto:off@studio.test>", from_name: "Community Studio", from_address: "news@studio.test" }),
  row("o1", "2026-10-02T09:00:00Z", { from_name: "Invoice Desk", subject: "Subject o1 Invoice $40 meeting" }),
];

function rig(o: { rows?: InboxRow[]; accounts?: EmailAccount[] } = {}) {
  const all = [...(o.rows ?? ROWS)].sort(newestFirst);
  const acc = o.accounts ?? accounts;
  const rpcs: string[] = [];
  const posts: string[] = [];
  const table: Record<string, (a: Record<string, unknown>) => unknown> = {
    email_accounts: () => acc,
    email_inbox: (a) => ({ rows: all.slice(0, a.p_limit as number), cached_total: all.length, page: a.p_limit }),
    substrate_readiness: () => ({ registered: [] }),
    candidates_for: () => [],
    email_search_cached: (a) => ({ rows: [], coverage: "cached", q: a.p_q, window: all.length }),
  };
  const client: RpcClient = { rpc: async (fn, args) => { rpcs.push(fn); const f = table[fn]; if (!f) throw new Error("no fake for " + fn); return { data: f(args as Record<string, unknown>), error: null }; } };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    posts.push(url);
    const answer = url.endsWith("/api/email/sync") ? { status: 200, body: { ok: true, synced: 0, removed: 0, next_page: null, complete: true, resynced: false } } : { status: 404, body: { code: "NOT_FOUND" } };
    return { ok: answer.status < 300, status: answer.status, json: async () => answer.body } as Response;
  }));
  return { client, rpcs, posts };
}
type Rig = ReturnType<typeof rig>;

const mount = (r: Rig, userId = USER) =>
  render(<EmailFlow client={r.client} token="jwt" userId={userId} categories={[]} now={() => NOW} onOpenConnections={() => {}} />);
const rowEls = () => [...document.querySelectorAll(".erow")] as HTMLElement[];
const heads = () => [...document.querySelectorAll(".sh2 .t")].map((h) => h.textContent);
const intro = () => document.querySelector(".email-intro") as HTMLElement | null;
const tab = (name: string) => screen.getByRole("tab", { name });
const dismiss = () => fireEvent.click(within(intro()!).getByRole("button", { name: "Dismiss" }));
const loaded = () => waitFor(() => expect(rowEls().length).toBe(5), { timeout: 4000 });
/** Calls and requests have stopped coming: the first load and its sync are over. */
async function settle(r: Rig) {
  let last = -1;
  for (let i = 0; i < 30; i++) {
    await act(async () => { await new Promise((res) => setTimeout(res, 25)); });
    const n = r.rpcs.length + r.posts.length;
    if (n === last) return;
    last = n;
  }
}

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.classList.remove("selecting"); });

describe("the first visit to Grouped (spec 2.2, AC01)", () => {
  it("shows the explainer above the first section, as the notice card's own words, one capsule and one Dismiss, over the same five-section list", async () => {
    mount(rig());
    await loaded();
    const card = intro()!;
    expect(card).toBeTruthy();
    // Above the first section head, in the same column as the list.
    const first = document.querySelector(".sh2")!;
    expect(card.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelectorAll(".email-intro")).toHaveLength(1);
    // Its words: a title and one fact.
    expect(card.querySelector(".conn-name")!.textContent).toBe(GROUPED_INTRO_TITLE);
    expect([...card.querySelectorAll(".conn-meta .fact")].map((f) => f.textContent)).toEqual([GROUPED_INTRO_SUB]);
    // Its controls: the explicit approval, and a real Dismiss. Nothing else is a button.
    expect(within(card).getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual([USE_GROUPED, "Dismiss"]);
    expect(card.querySelectorAll(".pill-act")).toHaveLength(1);
    expect(card.querySelector("button.notice-x")).toHaveAttribute("aria-label", "Dismiss");
    expect(card.querySelector(".notice-dismiss")).toBeNull();
    // It is Email's card: its type icon wears Email teal, never flat ink.
    expect(card.querySelector(".notice-disc")).toHaveClass("cat-bg-teal");
    // The list under it is the five sections, unchanged, every message once.
    expect(heads()).toEqual(SECTIONS);
    expect(rowEls()).toHaveLength(5);
    // Nothing was stored just by showing it.
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("is not an arrangement control: the Grouped and All by Date tabs are the screen's own, and the card holds neither", async () => {
    mount(rig());
    await loaded();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Inbox", "Waiting", VIEW_DATE, VIEW_GROUPED]);
    expect(within(intro()!).queryByRole("tab")).toBeNull();
    expect(within(intro()!).queryByRole("button", { name: VIEW_DATE })).toBeNull();
    expect(tab(VIEW_GROUPED)).toHaveAttribute("aria-selected", "true");
  });

  it("the words of the card are not a button: a tap on them does not approve or settle anything", async () => {
    mount(rig());
    await loaded();
    const card = intro()!;
    // No door and no tab stop on the body: the only interactive things are the capsule and the Dismiss.
    expect(card.querySelectorAll('[role="button"], [tabindex]')).toHaveLength(0);
    fireEvent.click(card.querySelector(".conn-name")!);
    fireEvent.click(card.querySelector(".notice-disc")!);
    fireEvent.click(card.querySelector(".conn-meta")!);
    expect(intro()).not.toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(localStorage.getItem(VIEW_KEY)).toBeNull();
  });

  it("a person who chose Grouped before this shipped has stored the view but not dealt with the explainer: they see it once", async () => {
    saveView(USER, "grouped");
    mount(rig());
    await loaded();
    expect(intro()).not.toBeNull();
    dismiss();
    expect(intro()).toBeNull();
  });
});

describe("Dismiss: gone at once, and never again", () => {
  it("hides it immediately, stores only its own flag (never the view), and a fresh mount does not bring it back", async () => {
    const ui = mount(rig());
    await loaded();
    dismiss();
    expect(intro()).toBeNull();
    expect(localStorage.getItem(KEY)).toBe("1");
    expect(loadGroupedIntroDone(USER)).toBe(true);
    // Dismissing is not choosing: the view is still the default, nothing stored for it.
    expect(localStorage.getItem(VIEW_KEY)).toBeNull();
    expect(loadView(USER)).toBe("grouped");
    expect(tab(VIEW_GROUPED)).toHaveAttribute("aria-selected", "true");
    expect(heads()).toEqual(SECTIONS);
    // A reload: a new mount reads the flag.
    ui.unmount();
    mount(rig());
    await loaded();
    expect(intro()).toBeNull();
  });

  it("is per person: someone else signing in on this phone has not dealt with it", async () => {
    const ui = mount(rig());
    await loaded();
    dismiss();
    ui.unmount();
    mount(rig(), "user-2");
    await loaded();
    expect(intro()).not.toBeNull();
    expect(localStorage.getItem("jarvis.email.groupedIntro.v1:user-2")).toBeNull();
  });
});

describe("Use Grouped Mail: the explicit approval", () => {
  it("hides it, stores Grouped as the person's choice and the flag, keeps Grouped selected with All by Date available, and a fresh mount does not bring it back", async () => {
    const ui = mount(rig());
    await loaded();
    fireEvent.click(within(intro()!).getByRole("button", { name: USE_GROUPED }));
    expect(intro()).toBeNull();
    expect(localStorage.getItem(VIEW_KEY)).toBe("grouped");
    expect(localStorage.getItem(KEY)).toBe("1");
    expect(tab(VIEW_GROUPED)).toHaveAttribute("aria-selected", "true");
    expect(tab(VIEW_DATE)).toBeVisible();
    expect(heads()).toEqual(SECTIONS);
    ui.unmount();
    mount(rig());
    await loaded();
    expect(intro()).toBeNull();
    expect(tab(VIEW_GROUPED)).toHaveAttribute("aria-selected", "true");
  });
});

describe("never in All by Date, and any use of the arrangement control settles it", () => {
  it("a device already on All by Date sees no explainer, and nothing is stored because nothing was shown", async () => {
    saveView(USER, "date");
    mount(rig());
    await loaded();
    expect(intro()).toBeNull();
    expect(document.querySelector(".notice-card")).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("tapping All by Date hides it, and tapping Grouped again does not bring it back", async () => {
    mount(rig());
    await loaded();
    expect(intro()).not.toBeNull();
    fireEvent.click(tab(VIEW_DATE));
    expect(intro()).toBeNull();
    expect(heads()).toEqual(["Today", "Yesterday"]);
    expect(localStorage.getItem(KEY)).toBe("1");
    expect(loadView(USER)).toBe("date");
    fireEvent.click(tab(VIEW_GROUPED));
    expect(heads()).toEqual(SECTIONS);
    expect(intro()).toBeNull();
  });

  it("a person on All by Date who switches to Grouped has chosen it: the explainer does not follow", async () => {
    saveView(USER, "date");
    mount(rig());
    await loaded();
    fireEvent.click(tab(VIEW_GROUPED));
    expect(intro()).toBeNull();
    expect(localStorage.getItem(KEY)).toBe("1");
  });
});

describe("only over a Grouped list that has mail, outside select mode", () => {
  it("is not drawn while the first load is pending", async () => {
    mount(rig());
    expect(document.querySelector(".skel-row")).not.toBeNull();
    expect(intro()).toBeNull();
    await loaded();
    expect(intro()).not.toBeNull();
  });

  it("is not drawn over an empty inbox", async () => {
    mount(rig({ rows: [] }));
    expect(await screen.findByText(EMPTY_INBOX.title)).toBeInTheDocument();
    expect(intro()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("is not drawn when no mailbox is connected", async () => {
    mount(rig({ rows: [], accounts: [] }));
    expect(await screen.findByText(EMPTY_ACCOUNTS.title)).toBeInTheDocument();
    expect(intro()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  // The first load that failed with nothing cached is not drawn here on purpose: its Retry is a capsule inside a list row
  // (EmailFlow's error card, .row.row-act), which laws/catalogSetup.ts rejects in any test that renders it. That is debt in that
  // card, reported with this item and not rostered; the explainer needs rows (visible.length > 0), so it cannot show there.

  it("is not drawn while selecting, and comes back when select mode ends if nothing settled it", async () => {
    mount(rig());
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(intro()).toBeNull();
    expect(document.querySelectorAll(".erow .sel-box").length).toBe(5);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(intro()).not.toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("is not in Search (its own screen) and is still waiting when Search is left; and not under the Waiting tab", async () => {
    mount(rig());
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByPlaceholderText("Search Mail")).toBeInTheDocument();
    expect(intro()).toBeNull();
    expect(document.querySelector(".notice-card")).toBeNull();
    fireEvent.click(screen.getByText(EMAIL_TITLE, { selector: ".nav-back .back-pill-t" }));
    expect(intro()).not.toBeNull();
    // The Waiting tab is not the Grouped list.
    fireEvent.click(tab("Waiting"));
    expect(intro()).toBeNull();
    fireEvent.click(tab("Inbox"));
    expect(intro()).not.toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("stays over one mailbox's rows when the account picker narrows the list", async () => {
    mount(rig());
    await loaded();
    fireEvent.click(document.querySelector(".email-acct")!);
    fireEvent.click(screen.getByText(WORK));
    expect(rowEls()).toHaveLength(1);
    expect(intro()).not.toBeNull();
  });
});

describe("storage that cannot be read or written (private mode)", () => {
  it("the explainer shows, Dismiss still hides it for the visit, and nothing throws", async () => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    const mine = (k: string) => k.startsWith("jarvis.email.groupedIntro");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, k: string) { if (mine(k)) throw new Error("blocked"); return get.call(this, k); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) { if (mine(k)) throw new Error("blocked"); return set.call(this, k, v); });
    mount(rig());
    await loaded();
    expect(intro()).not.toBeNull();
    expect(() => dismiss()).not.toThrow();
    expect(intro()).toBeNull();
    // The arrangement control still works on the same phone, and does not bring it back.
    fireEvent.click(tab(VIEW_DATE));
    fireEvent.click(tab(VIEW_GROUPED));
    expect(intro()).toBeNull();
    expect(heads()).toEqual(SECTIONS);
  });
});

describe("it asks for nothing: no request and no database call", () => {
  it("approving it makes none beyond the first load", async () => {
    const r = rig();
    mount(r);
    await loaded();
    await settle(r);
    const before = { rpcs: [...r.rpcs], posts: [...r.posts] };
    fireEvent.click(within(intro()!).getByRole("button", { name: USE_GROUPED }));
    await settle(r);
    expect({ rpcs: r.rpcs, posts: r.posts }).toEqual(before);
  });

  it("dismissing it makes none beyond the first load", async () => {
    const r = rig();
    mount(r);
    await loaded();
    await settle(r);
    const before = { rpcs: [...r.rpcs], posts: [...r.posts] };
    dismiss();
    await settle(r);
    expect({ rpcs: r.rpcs, posts: r.posts }).toEqual(before);
  });

  it("a flag saved by the helper keeps a fresh mount away without the screen writing a thing", async () => {
    saveGroupedIntroDone(USER);
    mount(rig());
    await loaded();
    expect(intro()).toBeNull();
    expect(localStorage.getItem(KEY)).toBe("1");
    expect(localStorage.getItem(VIEW_KEY)).toBeNull();
  });
});

describe("its stylesheet is room and nothing else (Dave: the font style and the card colours do not change)", () => {
  it("the .email-intro rules set only margin and padding, in spacing tokens, with no colour, no type and no theme branch", () => {
    const css = readFileSync(resolve(__dirname, "../styles/email.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim().replace(/\s+/g, " "), body: m[2]! })).filter((r) => r.sel.includes("email-intro"));
    expect(rules.map((r) => r.sel)).toEqual([".email-intro", ".email-intro .notice-stack > .pill-act"]);
    for (const r of rules) {
      const props = [...r.body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]!);
      expect(props.length).toBeGreaterThan(0);
      expect(props.filter((p) => !/^(margin|padding)(-top|-left|-right)?$/.test(p)), r.sel).toEqual([]);
      expect(r.body, r.sel).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|\d+px/i);
      expect(r.sel).not.toMatch(/data-theme/);
    }
  });
});
