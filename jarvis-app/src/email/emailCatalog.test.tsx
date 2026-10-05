// @vitest-environment jsdom
// THE VISUAL CATALOG, ON EVERY SCREEN OF THE EMAIL TAB (Dave, 2026-10-05, "I am
// sick of this": a thin grey subtext came back on the Email card, "Open Email to
// Review" under "5 Email Items to Review" and "Task · Due Today", and he spent
// hours fixing exactly that once). The rules are the rulebook's R1 to R8, asserted
// here as STRUCTURE in the DOM, not as pixels, so they hold in both themes and at
// every type scale:
//   - a separator is drawn by CSS: no middle dot, bullet or " - " inside a fact;
//   - a facts line with nothing to say is not drawn at all;
//   - at most one coloured fact (amber, red, green) on a facts line;
//   - at most ONE untoned (grey) fact per row, per card, per table cell: every
//     other fact is a colour from the key, small caps, a white number or a mark;
//   - a clock time is 12-hour with AM or PM;
//   - every word the app writes in a fact is Title Case (small words lowercase).
// Each screen below renders the REAL component through the real markup and runs
// the same check. The old strings failed it; the fixes pass it.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, waitFor, within, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { RpcClient } from "../substrate/commands/errors";
import type { WaitingItem } from "../substrate/waiting/types";
import type { Category } from "../categories/types";
import CandidateCards from "./CandidateCards";
import WaitingList from "./WaitingList";
import WaitingDetail from "./WaitingDetail";
import AccountsScreen from "./AccountsScreen";
import DraftsScreen from "./DraftsScreen";
import SearchScreen, { EMPTY_SEARCH_STATE, type SearchState } from "./SearchScreen";
import MessageScreen from "./MessageScreen";
import ComposeScreen from "./ComposeScreen";
import SendReviewScreen from "./SendReviewScreen";
import SendOutcomeScreen from "./SendOutcomeScreen";
import { cardLines, type Candidate } from "./candidates";
import { SENT_LINE, UNKNOWN_WHY, STATE_WORD, RETENTION_NOTE } from "./copy";
import type { DraftRow, Review } from "./drafts";
import { emptyFields } from "./drafts";
import type { EmailAccount, InboxRow } from "./emailClient";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// The check. Every screen below runs it over its own DOM.
// ---------------------------------------------------------------------------
const SEPARATOR = /[·•]| - /;
const SMALL = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "per", "the", "to", "with"]);
const TONES = ["warn", "red", "good"] as const;
// "Waiting On" is the tracker's own name (the Waiting On list, the Waiting On card), written with a capital On everywhere
// the app writes it; it is a proper noun here, not a small word, so it is read as one word.
const isTitleCase = (text: string): boolean => {
  const words = text.replace(/\bWaiting On\b/g, "Waiting-On").trim().split(/\s+/).filter(Boolean);
  return words.every((w, i) => {
    if (/[@\d$]/.test(w[0] ?? "") || w.includes("@") || w.includes("/")) return true; // an address, a number, an amount: data, not words
    const bare = w.replace(/^[^A-Za-z]+/, "");
    if (!bare) return true;
    if (SMALL.has(bare.toLowerCase()) && i !== 0 && i !== words.length - 1) return bare === bare.toLowerCase();
    return bare[0] === bare[0]!.toUpperCase();
  });
};
const ROW = "dd, .row, .email-card, .email-receipt-line, .email-note, .email-head, .email-fresh, .email-cover, .email-waiting-card";
const isGrey = (f: Element): boolean => {
  const own = f.textContent?.trim() ?? "";
  if (!own) return false;
  if (["warn", "red", "good", "date", "est", "cat", "st"].some((c) => f.classList.contains(c))) return false;
  const only = f.firstElementChild;
  if (only && only.tagName === "B" && only.textContent === own) return false; // a white number with no state
  return true;
};

/** Every way a catalog line can be wrong, in the DOM under `root`. Empty means it follows the catalog. */
export function catalogViolations(root: ParentNode): string[] {
  const bad: string[] = [];
  for (const line of root.querySelectorAll(".facts, .conn-meta")) {
    const facts = [...line.querySelectorAll(":scope > .fact")];
    if (facts.length === 0 && line.classList.contains("facts")) bad.push("a facts line with no fact in it: " + JSON.stringify(line.textContent));
    const coloured = facts.filter((f) => TONES.some((t) => f.classList.contains(t)));
    if (coloured.length > 1) bad.push("two coloured facts on one line: " + coloured.map((f) => f.textContent).join(" | "));
  }
  for (const f of root.querySelectorAll(".fact")) {
    const text = f.textContent ?? "";
    if (SEPARATOR.test(text)) bad.push("a separator baked into a fact: " + JSON.stringify(text));
    if (/\b\d{1,2}:\d{2}\b/.test(text) && !/\b(AM|PM)\b/i.test(text)) bad.push("a 24-hour clock in a fact: " + JSON.stringify(text));
    if (!isTitleCase(text)) bad.push("a fact that is not Title Case: " + JSON.stringify(text));
  }
  const greys = new Map<Element, string[]>();
  for (const f of root.querySelectorAll(".fact")) {
    if (!isGrey(f)) continue;
    const row = f.closest(ROW);
    if (row) greys.set(row, [...(greys.get(row) ?? []), f.textContent ?? ""]);
  }
  for (const [, list] of greys) if (list.length > 1) bad.push("more than one grey run on one row: " + list.join(" | "));
  return bad;
}

const NOW = new Date("2026-10-05T12:00:00");
const TODAY = "2026-10-05";
const noClient: RpcClient = { rpc: async () => ({ data: { error: "NOT_FOUND" }, error: null }) };
const noop = () => {};

// ---------------------------------------------------------------------------
// THE CARDS UNDER A MESSAGE: the screenshot's own class
// ---------------------------------------------------------------------------
const cand = (id: string, payload: Record<string, unknown>, o: Record<string, unknown> = {}): Candidate => ({
  id, message_id: "m1", account_id: "a", kind: payload.kind, origin: "rule", agent_name: null, status: "proposed", revision: 1, payload, payload_hash: "h",
  provenance_by_field: {}, missing_fields: [], fingerprint: "f", source_hash: "s", message_source_hash: "s", destination_id: null, action_id: null, proposal_id: null,
  extractor_version: "v", created_at: "2026-10-03T00:00:00Z", updated_at: "2026-10-03T00:00:00Z", saved_sibling: null, ...o,
}) as unknown as Candidate;
const BILL = { kind: "bill", issuer: "Con Edison", amount: { minor_units: 14230, currency: "USD" }, due_date: "2026-10-15", no_due_date_confirmed: false };
const RECEIPT = { kind: "receipt", merchant: "Lowe's", amount: { minor_units: 28410, currency: "USD" }, purchase_date: "2026-10-03", transaction_type: "purchase" };
const TASK = { kind: "task", title: "Review the expense summary", due_date: null, notes: "" };
const EVENT = { kind: "event", title: "Quick Call", time: { all_day: false, start_at: "2026-10-05T14:00:00.000Z", end_at: "2026-10-05T15:00:00.000Z", timezone: "America/New_York", selected_offset: "-04:00" }, location: null, external_uid: null };
const WAIT = { kind: "waiting", title: "Peña's Transcript", waiting_for: "it", counterparty_display: "Coach Miller", contact_id: null, follow_up_on: "2026-10-06" };

function cards(candidates: Candidate[], extra: Partial<Parameters<typeof CandidateCards>[0]> = {}) {
  return render(
    <CandidateCards client={noClient} candidates={candidates} row={{ id: "m1", thread_id: "t", account: "a@x.test", source_hash: "s" }} ctx={{ now: () => NOW.toISOString(), today: TODAY, zone: "America/New_York", threadId: "t", account: "a@x.test" }}
      ready={() => true} readyLine={() => ""} offline={false} showDismissed={false} now={() => NOW} onChanged={noop} onDetails={noop} onReview={noop} onReceipt={noop} {...extra} />,
  );
}
const texts = (root: ParentNode, sel: string) => [...root.querySelectorAll(sel)].map((f) => f.textContent);

describe("the cards: the facts are separate spans, the colour is the key, the line is drawn only when it has something to say", () => {
  it("a bill: the due date is a neutral small-caps fact when it is later, the issuer is the one grey, and there is no second thin line", () => {
    const { container } = cards([cand("c1", BILL)]);
    const card = container.querySelector(".email-card.bill")!;
    expect(texts(card, ".conn-meta .fact")).toEqual(["Due Oct 15", "Con Edison"]);
    expect(card.querySelector(".fact.date")).toHaveTextContent("Due Oct 15");
    // The three-line stack of the old card: a title under the badge repeating the button, then the dotted detail.
    expect(card).not.toHaveTextContent("Save Bill to Money");
    expect(card.querySelector(".email-card-title, .email-card-detail, .email-card-note")).toBeNull();
    expect(catalogViolations(container)).toEqual([]);
  });

  it("due today or tomorrow is amber, overdue is red; both lead the line", () => {
    const { container } = cards([cand("c1", { ...BILL, due_date: "2026-10-06" }), cand("c2", { ...BILL, due_date: "2026-10-01" }, { id: "c2" })]);
    const [tomorrow, late] = [...container.querySelectorAll(".email-card")];
    expect(tomorrow!.querySelector(".fact.warn")).toHaveTextContent("Due Oct 6");
    expect(late!.querySelector(".fact.red")).toHaveTextContent("Due Oct 1");
    expect(catalogViolations(container)).toEqual([]);
  });

  it("a task with no due date shows no facts line at all: no 'No Deadline' placeholder", () => {
    const { container } = cards([cand("c1", TASK)]);
    expect(container.querySelector(".email-card .facts, .email-card .conn-meta")).toBeNull();
    expect(container.querySelector(".email-card")).not.toHaveTextContent(/No Deadline|No Due Date/);
  });

  it("a bill the person confirmed has no due date says nothing about it; a missing issuer is ONE amber Needs fact, not a grey 'Issuer Needed'", () => {
    const { container } = cards([cand("c1", { ...BILL, due_date: null, no_due_date_confirmed: true, issuer: "" }, { missing_fields: ["issuer"] })]);
    expect(texts(container, ".email-card .conn-meta .fact")).toEqual(["Needs Issuer"]);
    expect(container.querySelector(".fact.warn")).toHaveTextContent("Needs Issuer");
    expect(container).not.toHaveTextContent(/No Due Date|Issuer Needed|Due Date Needed/);
    expect(catalogViolations(container)).toEqual([]);
  });

  it("with something still needed the due date steps down to a neutral date, so there is one coloured fact on the line", () => {
    const { container } = cards([cand("c1", { ...BILL, issuer: "", due_date: "2026-10-06" }, { missing_fields: ["issuer"] })]);
    const line = container.querySelector(".email-card .conn-meta")!;
    expect(texts(line, ".fact")).toEqual(["Needs Issuer", "Due Oct 6"]);
    expect(line.querySelectorAll(".fact.warn").length).toBe(1);
    expect(line.querySelector(".fact.date")).toHaveTextContent("Due Oct 6");
  });

  it("a receipt: Paid is green, the merchant is the grey and last; a currency the rules could not read is a need, never a dotted headline", () => {
    const { container } = cards([cand("c1", RECEIPT), cand("c2", { ...RECEIPT, amount: { minor_units: 1234, currency: "" } }, { id: "c2", missing_fields: ["currency"] })]);
    const [ok, noCurrency] = [...container.querySelectorAll(".email-card")];
    expect(texts(ok!, ".conn-meta .fact")).toEqual(["Paid Oct 3", "Lowe's"]);
    expect(ok!.querySelector(".fact.good")).toHaveTextContent("Paid Oct 3");
    expect(noCurrency!.querySelector(".email-card-value")).toHaveTextContent(/^12\.34$/);
    expect(noCurrency!.querySelector(".fact.warn")).toHaveTextContent("Needs Currency");
    expect(catalogViolations(container)).toEqual([]);
  });

  it("an event: the day and the 12-hour span are neutral small-caps facts, the zone is the one grey; a missing zone is a need", () => {
    const { container } = cards([cand("c1", EVENT), cand("c2", { ...EVENT, time: { ...EVENT.time, timezone: "" } }, { id: "c2", missing_fields: ["timezone"] })]);
    const [zoned, bare] = [...container.querySelectorAll(".email-card")];
    expect(texts(zoned!, ".conn-meta .fact")).toEqual(["Today", "10:00 AM to 11:00 AM", "Eastern"]);
    expect(zoned!.querySelectorAll(".fact.date").length).toBe(2);
    expect(bare!.querySelector(".fact.warn")).toHaveTextContent("Needs Zone");
    expect(catalogViolations(container)).toEqual([]);
  });

  it("a waiting card: the follow-up date wears its window colour and leads, the sender is the one grey and last", () => {
    const { container } = cards([cand("c1", WAIT)]);
    expect(texts(container, ".email-card .conn-meta .fact")).toEqual(["Follow Up Oct 6", "From Coach Miller"]);
    expect(container.querySelector(".fact.warn")).toHaveTextContent("Follow Up Oct 6");
    expect(catalogViolations(container)).toEqual([]);
  });

  it("cardLines never returns a string with a middle dot in it, for any kind", () => {
    for (const p of [BILL, RECEIPT, TASK, EVENT, WAIT, { ...BILL, issuer: "", amount: { minor_units: 5, currency: "" } }, { ...EVENT, time: { all_day: true, start_date: "2026-10-09" } }]) {
      const { value, facts } = cardLines({ payload: p as never }, NOW);
      expect(value).not.toMatch(SEPARATOR);
      for (const f of facts) expect(f.text).not.toMatch(SEPARATOR);
    }
  });

  it("a module that is not ready says so as facts: the reason is amber, the rest of the line the one grey; the action is the shared capsule", () => {
    const { container } = cards([cand("c1", BILL)], { ready: () => false, readyLine: () => "Money Isn't Ready · Your Bill Is Still Here" });
    const card = container.querySelector(".email-card")!;
    // The reason only, in amber: the rest of the line was a second grey on a card whose facts line already spends the grey.
    expect([...card.querySelectorAll(".conn-meta")].map((l) => texts(l, ".fact"))).toEqual([["Due Oct 15", "Con Edison"], ["Money Isn't Ready"]]);
    expect(card.querySelector(".fact.warn")).toHaveTextContent("Money Isn't Ready");
    expect(catalogViolations(container)).toEqual([]);
    expect(within(card as HTMLElement).getByText("Save Bill")).toHaveClass("pill-act");
    expect(card.querySelector(".email-card-go")).toBeNull();
  });

  it("a conflict is ONE amber fact: the saved record is the same vendor, amount and date as the card, so it is not drawn a second time in grey", () => {
    const { container } = cards([cand("c1", BILL)], { conflictOf: () => true });
    const lines = [...container.querySelectorAll(".email-card .conn-meta")].map((l) => texts(l, ".fact"));
    expect(lines).toEqual([["Due Oct 15", "Con Edison"], ["This May Already Be Saved"]]);
    expect(container.querySelector(".conn-meta .fact.warn")).toHaveTextContent("This May Already Be Saved");
    expect(within(container.querySelector(".email-card") as HTMLElement).getByText("Keep Separate")).toHaveClass("pill-act");
    expect(catalogViolations(container)).toEqual([]);
  });

  it("a card with a saved sibling shows the two copies as a table and draws its facts once, not a third time in grey", () => {
    const sibling = { id: "s1", payload: { ...BILL, due_date: "2026-10-20" }, destination_id: "d", action_id: "a" };
    const { container } = cards([cand("c1", BILL, { saved_sibling: sibling })]);
    const card = container.querySelector(".email-card")!;
    expect(card.querySelectorAll(":scope > .facts, :scope > .conn-meta").length).toBe(0);
    expect(texts(card, "dl dt")).toEqual(["Previously Saved", "Latest"]);
    expect(texts(card, "dl dd .fact")).toEqual(["Due Oct 20", "Con Edison", "Due Oct 15", "Con Edison"]);
    expect(catalogViolations(container)).toEqual([]);
  });

  it("badges carry no baked dot: an agent's name is its own badge; the dismiss circle is a real tap target", () => {
    const { container } = cards([cand("c1", BILL, { origin: "agent", agent_name: "Claude" })]);
    expect(texts(container, ".email-badge")).toEqual(["Money", "Assistant Suggestion", "Claude", "Not Saved Yet"]);
    for (const b of container.querySelectorAll(".email-badge")) expect(b.textContent).not.toMatch(SEPARATOR);
    expect(container.querySelector(".email-card-x")).toBeTruthy();
  });

  it("a saved card is a receipt line of two facts: a green Saved, then the value; a failure is the shared error line, not a coloured note", () => {
    const { container } = cards([cand("c1", BILL, { status: "saved", action_id: "act" })]);
    expect(texts(container, ".email-receipt-line .fact")).toEqual(["✓ Saved Bill", "$142.30"]);
    expect(container.querySelector(".email-receipt-line .fact.good")).toBeTruthy();
    expect(catalogViolations(container)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// WAITING: the list, and one record
// ---------------------------------------------------------------------------
const wait = (id: string, o: Partial<WaitingItem["data"]> = {}): WaitingItem => ({ id, data: { title: `Waiting ${id}`, waitingFor: "it", counterpartyDisplay: "Coach Miller", status: "open", startedAt: "2026-10-02T15:00:00Z", threadId: "t-" + id, ...o } });

describe("Waiting: one facts line per row, the colour first, the name last", () => {
  const list = (items: WaitingItem[], view: "open" | "resolved" = "open", latest = {}) => render(
    <WaitingList items={items} latest={latest} own={["dave@example.test"]} today={TODAY} zone="UTC" view={view} onView={noop} onOpen={noop} onShowInbox={noop} />,
  );

  it("an overdue follow-up is red, today is amber, a later one is a neutral small-caps date; the age is small caps and Waiting On is the one grey, last", () => {
    const { container } = list([wait("late", { followUpOn: "2026-10-03" }), wait("today", { followUpOn: TODAY }), wait("later", { followUpOn: "2026-10-20" }), wait("none")]);
    const row = (id: string) => container.querySelector(`[data-waiting='${id}']`)!;
    expect(row("late").querySelector(".fact.red")).toHaveTextContent("Follow Up Was Oct 3");
    expect(row("today").querySelector(".fact.warn")).toHaveTextContent("Follow Up Today");
    expect(row("later").querySelector(".fact.warn, .fact.red")).toBeNull();
    expect(row("later").querySelector(".fact.date")).toHaveTextContent("Follow Up Oct 20");
    for (const id of ["late", "today", "later", "none"]) {
      const facts = [...row(id).querySelectorAll(".conn-meta")][0]!;
      const all = [...facts.querySelectorAll(".fact")];
      expect(all.at(-1)).toHaveTextContent("Waiting On Coach Miller");
      expect(all.at(-1)!.classList.contains("warn") || all.at(-1)!.classList.contains("red")).toBe(false);
    }
    expect(catalogViolations(container)).toEqual([]);
  });

  it("New Reply is its own amber line, so a row never carries two coloured facts on one line", () => {
    const latest = { "t-r": { message_id: "m9", internal_date: "2026-10-04T10:00:00Z", from_address: "coach@example.test", from_name: "Coach", subject: "Re", account_id: "a" } };
    const { container } = list([wait("r", { followUpOn: TODAY })], "open", latest);
    const lines = [...container.querySelectorAll("[data-waiting='r'] .conn-meta")];
    expect(lines.length).toBe(2);
    expect(lines[0]!.querySelector(".fact.warn")).toHaveTextContent("Follow Up Today");
    expect(texts(lines[1]!, ".fact")).toEqual(["New Reply"]);
    expect(catalogViolations(container)).toEqual([]);
  });

  it("the Resolved view says Resolved in green with its day; and no count note under the list repeats the chips", () => {
    const { container } = list([wait("a", { status: "resolved", resolvedAt: "2026-10-04T10:00:00Z" })], "resolved");
    expect(container.querySelector("[data-waiting='a'] .fact.good")).toHaveTextContent("Resolved Oct 4");
    expect(container).not.toHaveTextContent(/\d Records?/);
    expect(container.querySelector(".email-note")).toBeNull();
    expect(catalogViolations(container)).toEqual([]);
  });
});

describe("a waiting record is a table of labelled values, with no placeholder and no manual", () => {
  const detail = (item: WaitingItem, latest?: Parameters<typeof WaitingDetail>[0]["latest"]) => render(
    <WaitingDetail client={noClient} item={item} own={["dave@example.test"]} today={TODAY} zone="UTC" offline={false} latest={latest} onBack={noop} onChanged={noop} onOpenMessage={noop} onDraftFollowUp={noop} />,
  );

  it("the card is a key/value table: Waiting On, Since, Waited, Account; the follow-up badge wears its key colour", () => {
    const { container } = detail(wait("a", { followUpOn: "2026-10-03", account: "dave@example.test" }));
    const dl = container.querySelector("dl.email-review-facts")!;
    expect(texts(dl, "dt")).toEqual(["Waiting On", "For", "Since", "Waited", "Account"]);
    expect(texts(dl, "dd")).toEqual(["Coach Miller", "it", "Oct 2", "3 Days", "dave@example.test"]);
    expect(container.querySelector(".email-badge.red")).toHaveTextContent("Follow Up Was Oct 3");
    // The old card: three grey lines, the second and third each a string joined by middle dots.
    expect(container.querySelector(".email-card-detail")).toBeNull();
    expect(container.querySelector(".email-waiting-card")!.textContent).not.toMatch(SEPARATOR);
  });

  it("no follow-up date shows nothing under the date field (no 'No Follow-Up Date'), and no manual sentence sits under the page", () => {
    const { container } = detail(wait("a"));
    expect(container).not.toHaveTextContent(/No Follow-Up Date|A Follow-Up Date Is a Reminder|A Reply Never Resolves/);
    expect(container.querySelector(".email-badge.red, .email-badge.warn")).toBeNull();
  });

  it("a new reply is one banner of facts: New Reply amber, the sender the one grey, the day and time small caps; with its action", () => {
    const latest = { message_id: "m9", internal_date: "2026-10-04T10:00:00", from_address: "coach@example.test", from_name: "Coach Miller", subject: "Re", account_id: "a" };
    const { container } = detail(wait("a"), latest);
    const banner = container.querySelector(".email-note.quiet")!;
    expect(texts(banner, ".fact")).toEqual(["New Reply", "Coach Miller", expect.stringMatching(/^(Oct 4|Yesterday)$/), "10:00 AM"]);
    expect(banner.querySelector(".fact.warn")).toHaveTextContent("New Reply");
    expect(within(banner as HTMLElement).getByRole("button", { name: "Review Reply" })).toBeInTheDocument();
    expect(catalogViolations(container)).toEqual([]);
  });

  it("a resolved record states when and why in the same table, the time as words and no dot", () => {
    const { container } = detail(wait("a", { status: "resolved", resolvedAt: "2026-10-04T10:00:00", resolutionNote: "Arrived by post" }));
    const dl = container.querySelector("dl.email-review-facts")!;
    expect(texts(dl, "dt")).toContain("Resolved");
    expect(texts(dl, "dd").some((t) => /^(Oct 4|Yesterday) 10:00 AM$/.test(t ?? ""))).toBe(true);
    expect(texts(dl, "dd")).toContain("Arrived by post");
    expect(dl.textContent).not.toMatch(SEPARATOR);
  });
});

// ---------------------------------------------------------------------------
// ACCOUNTS, DRAFTS, SEARCH, THE MESSAGE
// ---------------------------------------------------------------------------
const account = (o: Partial<EmailAccount>): EmailAccount => ({ id: "a", address: "dave@example.test", state: "connected", last_sync_at: "2026-10-05T09:12:00", sync_error: null, capabilities: {}, connected_at: "2026-09-01T00:00:00", scopes: [], cached: 12, ...o });

describe("Accounts: one facts line per mailbox, never four stacked greys", () => {
  const screen_ = (accounts: EmailAccount[]) => render(<AccountsScreen accounts={accounts} onBack={noop} onOpenConnections={noop} onOpenDrafts={noop} />);

  it("connected is green, the sync time is the one grey plus small caps, the saved count is a white number", () => {
    const { container } = screen_([account({})]);
    const row = container.querySelector(".row .conn-meta")!;
    expect(texts(row, ".fact")).toEqual([STATE_WORD.connected, expect.stringMatching(/^Updated /), expect.stringMatching(/^\d{1,2}:\d{2} (AM|PM)$/), "12 Messages Saved"]);
    expect(row.querySelector(".fact.good")).toHaveTextContent("Connected");
    expect(row.querySelector(".fact b")).toHaveTextContent("12 Messages Saved");
    expect(container.querySelectorAll(".row .conn-meta").length).toBe(1);
    expect(catalogViolations(container)).toEqual([]);
  });

  it("needs reconnecting is amber; a sync error is its own amber line, only when there is one; disconnected has no dotted 'Saved Mail Kept'", () => {
    const { container } = screen_([account({ state: "reauth", sync_error: "Token Expired" }), account({ id: "b", address: "old@example.test", state: "disconnected" })]);
    const [reauth, gone] = [...container.querySelectorAll(".row")].filter((r) => r.querySelector(".conn-meta"));
    expect(reauth!.querySelector(".fact.warn")).toHaveTextContent("Needs Reconnecting");
    expect(reauth!.querySelectorAll(".conn-meta").length).toBe(2);
    expect(texts(gone!, ".fact")).toEqual(["Disconnected", "12 Messages Saved"]);
    expect(container).not.toHaveTextContent("Saved Mail Kept");
    expect(catalogViolations(container)).toEqual([]);
  });

  it("the retention disclosure stays; the manual line that said where Settings is does not", () => {
    const { container } = screen_([account({})]);
    expect(container).toHaveTextContent(RETENTION_NOTE);
    expect(container).not.toHaveTextContent("Connect and Disconnect Under Settings");
  });
});

describe("Drafts: one facts line per row, state first in its colour, time in small caps, recipients last", () => {
  const draft = (id: string, o: Partial<DraftRow>): DraftRow => ({ ...emptyFields(), id, account_id: "a", account: "dave@example.test", send_state: "draft", saved_at: "2026-10-05T09:12:00", revision: 1, updated_at: "2026-10-05T09:12:00", sent_action_id: null, provider_message_id: null, action_state: null, action_verb: null, outbox_state: null, error_code: null, provider_ack: null, subject: `Subject ${id}`, to_addresses: ["coach@example.test"], ...o });
  it("a plain draft says no state word (the head says Drafts); failed and unknown are amber, sent is green; a missing recipient says nothing", async () => {
    const client: RpcClient = { rpc: async () => ({ data: { drafts: [draft("d1", {}), draft("d2", { send_state: "failed" }), draft("d3", { to_addresses: [] })], sent: [draft("s1", { send_state: "sent" }), draft("s2", { send_state: "unknown" })] }, error: null }) };
    const { container } = render(<DraftsScreen client={client} userId="u1" offline={false} onBack={noop} onCompose={noop} onOpenDraft={noop} onOpenLocal={noop} onOpenSent={noop} />);
    await waitFor(() => expect(container.querySelectorAll(".row .conn-meta").length).toBe(5));
    const rows = [...container.querySelectorAll(".row")];
    const line = (i: number) => texts(rows[i]!, ".fact");
    expect(line(0)).toEqual(["Today", expect.stringMatching(/^9:12 AM$/), "coach@example.test"]);
    expect(line(1)[0]).toBe("Not Sent");
    expect(rows[1]!.querySelector(".fact.warn")).toHaveTextContent("Not Sent");
    expect(line(2)).toEqual(["Today", expect.stringMatching(/^9:12 AM$/)]);
    expect(rows[3]!.querySelector(".fact.good")).toHaveTextContent("Sent");
    expect(rows[4]!.querySelector(".fact.warn")).toHaveTextContent("Unknown");
    expect(container).not.toHaveTextContent(/\(No Recipient\)|No Messages Sent From JARVIS Yet/);
    expect(container.querySelectorAll(".row").length).toBe(5);
    expect(catalogViolations(container)).toEqual([]);
  });
});

describe("Search: the coverage line is facts, wrapping, with every fact whole", () => {
  const search = (o: Partial<SearchState>) => render(
    <SearchScreen client={noClient} token="t" accounts={[account({}), account({ id: "b", address: "work@example.test" })]} labels={{}} offline={false} state={{ ...EMPTY_SEARCH_STATE, q: "coach", ...o }} onState={noop}
      categories={[]} categoryOf={() => null} categoryId={null} onCategory={noop} now={NOW} onBack={noop} onOpen={noop} />,
  );
  it("Gmail is a caps label, the account the one grey, a mailbox that did not answer is amber, the count a white number", () => {
    const { container } = search({ coverage: "provider", covered: ["dave@example.test"], failed: [{ email: "work@example.test", code: "UNAVAILABLE" }], rows: [] });
    const cover = container.querySelector(".email-cover")!;
    expect(texts(cover, ".fact")).toEqual(["Gmail", "1 Account Covered", "Didn't Answer: work@example.test", "0 Messages"]);
    expect(cover.querySelector(".conn-meta")).toBeTruthy();
    expect(cover.querySelector(".fact.warn")).toHaveTextContent("Didn't Answer");
    expect(cover.querySelector(".fact.date")).toHaveTextContent("Gmail");
    expect(catalogViolations(cover)).toEqual([]);
  });
  it("saved mail that could not reach Gmail says so in red; saved mail only is amber; searching is the one grey", () => {
    const red = search({ coverage: "cached", window: 40, transportFailed: "Couldn't Reach JARVIS" });
    expect(red.container.querySelector(".email-cover .fact.red")).toHaveTextContent("Couldn't Reach JARVIS");
    cleanup();
    const searching = search({ coverage: "cached", window: 40, searching: true });
    expect(texts(searching.container, ".email-cover .fact")).toEqual(["Saved Mail", "40 Messages Searched", "Searching Gmail..."]);
    expect(catalogViolations(searching.container)).toEqual([]);
  });
});

const ROW_: InboxRow = { id: "m1", account_id: "a", account: "dave@example.test", provider_id: "p1", thread_id: "t1", internal_date: "2026-10-05T09:12:00", from_address: "coach@example.test", from_name: "Coach Miller", subject: "Transcript", snippet: "s", has_body: false, attachment_metadata: [{ filename: "roster.pdf", mime: "application/pdf", attachmentId: "x", size: 245760 }], provider_labels: ["INBOX"], source_hash: "h", read: true };
const AREA: Category = { id: "c1", data: { name: "Money", color: "green", order: 0 } } as Category;

describe("The message head and its attachments", () => {
  const message = () => render(
    <MessageScreen client={noClient} token={null} userId="u-head" row={ROW_} account={null} offline categories={[AREA]} categoryId="c1" onBack={noop} onRowChanged={noop} onLeftInbox={noop} onFileUnder={noop} />,
  );
  it("the head is ONE wrapping line under the subject: the sender is the one grey, the day, time and mailbox small caps, the area a dot and its name", () => {
    const { container } = message();
    const head = container.querySelector(".email-head")!;
    expect(head.querySelectorAll(".conn-meta").length).toBe(1);
    expect(texts(head, ".fact")).toEqual(["Coach Miller", "Today", "9:12 AM", "dave@example.test", "Money"]);
    expect(head.querySelector(".fact.cat .cd")).toBeTruthy();
    expect(head.querySelector(".email-meta")).toBeNull();
    expect(catalogViolations(container)).toEqual([]);
  });
  it("an attachment row is its name, then its size as a white number: no second grey for the mime type", () => {
    const { container } = message();
    const row = [...container.querySelectorAll(".row")].find((r) => r.textContent?.includes("roster.pdf"))!;
    expect(texts(row, ".fact")).toEqual(["240 KB"]);
    expect(row.querySelector(".fact b")).toHaveTextContent("240 KB");
    expect(row).not.toHaveTextContent("application/pdf");
  });
});

// ---------------------------------------------------------------------------
// COMPOSE, REVIEW, OUTCOME
// ---------------------------------------------------------------------------
describe("Compose, review and outcome", () => {
  it("a reply says the name alone under a page already titled Reply; an attachment is a name, a white size and a door to its Remove sheet", () => {
    const fields = { ...emptyFields(), to_addresses: ["coach@example.test"], attachment_refs: [{ storage_id: "s1", filename: "roster.pdf", size_bytes: 245760, sha256: "x", mime_type: "application/pdf" }] };
    const { container } = render(
      <ComposeScreen client={noClient} userId="u-compose" accounts={[account({})]} offline fileStore={null} now={() => NOW}
        start={{ localKey: "k", draftId: null, accountId: "a", fields, revision: null, replyingTo: "Coach Miller" }} onBack={noop} onReview={noop} onDiscarded={noop} />,
    );
    expect(container.querySelector(".email-note.quiet .fact")).toHaveTextContent(/^Coach Miller$/);
    expect(container.querySelector(".email-note.quiet")!.textContent).not.toMatch(/Reply/);
    const row = [...container.querySelectorAll(".row")].find((r) => r.textContent?.includes("roster.pdf"))!;
    expect(texts(row, ".fact")).toEqual(["240 KB"]);
    // Clean rows (Dave 2026-10-05): no control inside the row; the row is the door and Remove is in its sheet.
    expect(within(row as HTMLElement).queryByRole("button", { name: /Remove/ })).toBeNull();
    expect(row!.querySelector(".pill-act, .row-act, .btn-sm, .quiet-action")).toBeNull();
    fireEvent.click(row!);
    const remove = within(document.body).getByRole("button", { name: "Remove Attachment" });
    expect(remove).toHaveClass("destructive");
    expect(catalogViolations(container)).toEqual([]);
  });

  const review = (o: Partial<Review["exact"]> = {}): Review => ({
    review: { action_id: "a", review_nonce: "n", payload_hash: "h", expires_at: "2026-10-05T12:05:00Z", outbox_id: "o" },
    exact: { account_id: "a", from_identity: "dave@example.test", to: ["coach@example.test"], cc: [], bcc: [], subject: "", body_text: "", attachments: [{ storage_id: "s1", filename: "roster.pdf", size_bytes: 245760, sha256: "x", mime_type: "application/pdf" }], ...o } as Review["exact"],
    warnings: [], verb: "Send", draft_revision: 1,
  });
  it("the review's attachment is a name with one white size; an empty subject is amber in a token, a failure is the shared red error line", () => {
    const { container } = render(<SendReviewScreen review={review()} offline={false} now={() => NOW} sending={false} failure={{ ok: false, code: "UNAVAILABLE", data: {} } as never} onEdit={noop} onSend={noop} onReviewAgain={noop} />);
    const att = container.querySelector(".email-review-attachments")!;
    expect(att.querySelector(".conn-name")).toHaveTextContent("roster.pdf");
    expect(texts(att, ".fact")).toEqual(["240 KB"]);
    expect(container.querySelector(".email-warn-word")).toHaveTextContent("No Subject");
    expect(container.querySelector(".input-error")).toBeTruthy();
    expect(container.querySelector(".email-warn")).toBeNull();
    expect(catalogViolations(container)).toEqual([]);
  });

  const sent = (o: Partial<DraftRow>): DraftRow => ({ ...emptyFields(), id: "d1", account_id: "a", account: "dave@example.test", send_state: "sent", saved_at: "2026-10-05T09:12:00", revision: 2, updated_at: "2026-10-05T09:12:00", sent_action_id: "act", provider_message_id: "gm", action_state: "confirmed", action_verb: null, outbox_state: "confirmed", error_code: null, provider_ack: null, subject: "Transcript", to_addresses: ["coach@example.test"], ...o });
  const outcome = (d: DraftRow) => render(<SendOutcomeScreen draft={d} offline={false} checking={false} checkLine={null} onBack={noop} onReviewAgain={noop} onCheckAgain={noop} onReceipt={noop} />);
  it("Sent is a green fact and its caveat the one grey; Unknown is amber; neither repeats the title nor tells the person to press the button that is there", () => {
    const [accepted, notRead] = SENT_LINE.split(" · ");
    const s = outcome(sent({}));
    expect(texts(s.container, ".email-review-card .conn-meta .fact")).toEqual([accepted, notRead]);
    expect(s.container.querySelector(".conn-meta .fact")).toHaveClass("good");
    expect(catalogViolations(s.container)).toEqual([]);
    cleanup();
    const u = outcome(sent({ send_state: "unknown", sent_action_id: null, outbox_state: "outcome_unknown" }));
    const [why, resend] = UNKNOWN_WHY.split(" · ");
    expect(texts(u.container, ".email-review-card .conn-meta .fact")).toEqual([why, resend]);
    expect(u.container.querySelector(".conn-meta .fact")).toHaveClass("warn");
    expect(u.container).not.toHaveTextContent("Check Gmail Before Trying Again");
    expect(catalogViolations(u.container)).toEqual([]);
    cleanup();
    const sending = outcome(sent({ send_state: "sending", outbox_state: "pending", sent_action_id: null }));
    expect(sending.container.querySelector(".email-review-card .email-card-detail, .email-review-card .facts, .email-review-card .conn-meta")).toBeNull();
  });
  it("a failed send is a red error line", () => {
    const f = outcome(sent({ send_state: "failed", outbox_state: "failed", error_code: "PROVIDER_AUTH", sent_action_id: null }));
    expect(f.container.querySelector(".email-review-card .input-error")).toBeTruthy();
    expect(screen.getAllByText("Not Sent").length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// THE WORDS: every string this tab writes, held to the casing rule, and the retired lines kept retired
// ---------------------------------------------------------------------------
import * as copy from "./copy";

describe("copy.ts: every constant is Title Case after every dot and number, and the lines Dave killed stay dead", () => {
  // The two floors under a list are deliberate sentences (shared/ListFloor's own design: "That's everything."), not facts.
  const FLOORS = new Set<string>([copy.LOADED_SO_FAR, copy.SEARCH_RESULTS_FLOOR]);
  const strings = (): [string, string][] => {
    const out: [string, string][] = [];
    for (const [k, v] of Object.entries(copy)) {
      if (typeof v === "string") out.push([k, v]);
      else if (v && typeof v === "object") for (const [k2, s] of Object.entries(v)) if (typeof s === "string") out.push([`${k}.${k2}`, s]);
    }
    return out;
  };
  it("no constant has a lowercase word where Title Case wants a capital, or a capital where it wants a small word", () => {
    const bad: string[] = [];
    for (const [k, v] of strings()) {
      if (FLOORS.has(v)) continue;
      for (const seg of v.split(" · ")) if (!isTitleCase(seg)) bad.push(`${k}: ${JSON.stringify(seg)}`);
    }
    expect(bad).toEqual([]);
  });
  it("the grey line under the Today review row is not a constant any more, and neither are the placeholders", () => {
    const all = strings().map(([, v]) => v);
    for (const dead of ["Open Email to Review", "No Follow-Up Date", "No Messages Sent From JARVIS Yet", "Check Gmail Before Trying Again", "A Reply Never Resolves This on Its Own"]) expect(all).not.toContain(dead);
    expect(Object.keys(copy)).not.toContain("OPEN_TO_REVIEW");
  });
});
