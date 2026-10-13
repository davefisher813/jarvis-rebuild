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
import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from "vitest";
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
import WhySectionSheet from "./WhySectionSheet";
import ComposeScreen from "./ComposeScreen";
import SendReviewScreen from "./SendReviewScreen";
import SendOutcomeScreen from "./SendOutcomeScreen";
import HeldSendScreen from "./HeldSendScreen";
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
// THE CLOCK IS PINNED (2026-10-06): the fixtures say "Today" relative to 2026-10-05, but the components read the real clock, so the
// file failed for everyone the day the date rolled. Only Date is faked, so waitFor and the timers are untouched. Test-only.
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterAll(() => { vi.useRealTimers(); });
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
// Facts binds a clock to its AM or PM with a no-break space (issue 106 V1), and a phone's ICU writes a narrow one: these read the
// words, so both are read as the plain space they look like. The glue itself is held in today/clockGlue.test.tsx.
const texts = (root: ParentNode, sel: string) => [...root.querySelectorAll(sel)].map((f) => (f.textContent ?? "").replace(/[\u00a0\u202f]/g, " "));

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
    // The day is read in the event's own zone (issue 112), so "now" is noon Eastern as an instant, not the host's local noon,
    // which is already another day in New York on a machine far enough east.
    const { container } = cards([cand("c1", EVENT), cand("c2", { ...EVENT, time: { ...EVENT.time, timezone: "" } }, { id: "c2", missing_fields: ["timezone"] })], { now: () => new Date("2026-10-05T16:00:00Z") });
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
const account = (o: Partial<EmailAccount>): EmailAccount => ({ id: "a", address: "dave@example.test", state: "connected", last_sync_at: "2026-10-05T09:12:00", sync_error: null, capabilities: {}, connected_at: "2026-09-01T00:00:00", scopes: [], cached: 12, signature_text: "", signature_revision: 1, ...o });

describe("Accounts: one facts line per mailbox, never four stacked greys", () => {
  const screen_ = (accounts: EmailAccount[]) => render(<AccountsScreen accounts={accounts} onBack={noop} onOpenConnections={noop} onOpenDrafts={noop} />);

  it("connected is green, the sync time is the one grey plus small caps, the saved count is a white number", () => {
    const { container } = screen_([account({})]);
    const row = container.querySelector(".row .conn-meta")!;
    expect(texts(row, ".fact")).toEqual([STATE_WORD.connected, expect.stringMatching(/^Last Checked /), expect.stringMatching(/^\d{1,2}:\d{2} (AM|PM)$/), "12 Messages Saved"]);
    expect(row.querySelector(".fact.good")).toHaveTextContent("Connected");
    expect(row.querySelector(".fact b")).toHaveTextContent("12 Messages Saved");
    expect(container.querySelectorAll(".row .conn-meta").length).toBe(1);
    expect(catalogViolations(container)).toEqual([]);
  });

  it("a mailbox still listing its window is Connected and Catching Up on Mail, never a time (spec 8.1, AC39)", () => {
    const { container } = screen_([account({ sync_state: "catching_up", last_sync_at: "2026-10-05T09:12:00" })]);
    const row = container.querySelector(".row .conn-meta")!;
    expect(texts(row, ".fact")).toEqual([STATE_WORD.connected, "Catching Up on Mail", "12 Messages Saved"]);
    expect(row.querySelector(".fact.good")).toHaveTextContent("Connected");
    expect(row.textContent).not.toMatch(/\d:\d{2}|Checked/);
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
  // Astra's bottom-sheet design (2026-10-10): MessageScreen portals its sheet
  // to document.body (over the dimmed inbox underneath), so it never lands
  // inside render()'s own container -- document.body is where to look.
  const message = () => {
    render(
      <MessageScreen client={noClient} token={null} userId="u-head" row={ROW_} account={null} offline categories={[AREA]} categoryId="c1" onBack={noop} onRowChanged={noop} onLeftInbox={noop} onFileUnder={noop} />,
    );
    return document.body;
  };
  it("V02 head: the name in white beside its face, the day and time small caps at the right, the address the one grey, then To with the mailbox and the area", () => {
    const body = message();
    const head = body.querySelector(".email-head")!;
    expect(head.querySelector(".email-from-name")?.textContent).toBe("Coach Miller");
    expect(head.querySelector(".email-avatar")?.textContent).toBe("C");
    expect(texts(head, ".fact")).toEqual(["Today", "9:12 AM", "coach@example.test", "dave@example.test", "Money"]);
    expect(head.querySelector(".email-to-k")?.textContent).toBe("To");
    expect([...head.querySelectorAll(".fact")].filter((f) => f.className === "fact").length).toBe(1);
    expect(head.querySelector(".fact.cat .cd")).toBeTruthy();
    expect(head.querySelector(".email-meta")).toBeNull();
    expect(catalogViolations(body)).toEqual([]);
  });
  it("an attachment row is its name, then its size as a white number: no second grey for the mime type", () => {
    const body = message();
    const row = [...body.querySelectorAll(".row")].find((r) => r.textContent?.includes("roster.pdf"))!;
    expect(texts(row, ".fact")).toEqual(["240 KB"]);
    expect(row.querySelector(".fact b")).toHaveTextContent("240 KB");
    expect(row).not.toHaveTextContent("application/pdf");
  });
  // Move to Section on the sheet's face (issue 104): a plain row, the tile in Email's teal, the section it sits in as its one grey fact.
  it("the Move to Section row: its title, then the section as the one grey fact, a span with no dot, no pill; the whole sheet still follows the catalog", () => {
    render(
      <MessageScreen client={noClient} token={null} userId="u-head" row={ROW_} account={null} offline categories={[AREA]} categoryId="c1" onBack={noop} onRowChanged={noop} onLeftInbox={noop} onFileUnder={noop} onMoveToSection={noop} sectionName="Mailing Lists" />,
    );
    const row = [...document.body.querySelectorAll(".email-actions .row")].find((r) => r.querySelector(".conn-name")?.textContent === "Move to Section")!;
    expect(row, "the Move to Section row is on the sheet's face").toBeTruthy();
    expect(texts(row, ".fact")).toEqual(["Mailing Lists"]);
    expect(row.querySelector(".fact")!.tagName).toBe("SPAN");
    // The one grey: no tone, no area dot, no white number. Its colour is the row's secondary ink and nothing else.
    expect(row.querySelector(".fact")!.className).toBe("fact");
    expect(row.querySelector(".sec-ico")).toHaveClass("ico-teal");
    expect(row.querySelector(".pill-act, .row-act, .btn-sm, .quiet-action")).toBeNull();
    expect(catalogViolations(document.body)).toEqual([]);
  });
  it("with no section to name the row is its title alone: no facts line is drawn, and without the prop there is no row at all", () => {
    render(
      <MessageScreen client={noClient} token={null} userId="u-head" row={ROW_} account={null} offline categories={[AREA]} categoryId="c1" onBack={noop} onRowChanged={noop} onLeftInbox={noop} onFileUnder={noop} onMoveToSection={noop} />,
    );
    const row = [...document.body.querySelectorAll(".email-actions .row")].find((r) => r.querySelector(".conn-name")?.textContent === "Move to Section")!;
    expect(row, "the Move to Section row is on the sheet's face").toBeTruthy();
    expect(row.querySelector(".facts, .conn-meta, .fact")).toBeNull();
    cleanup();
    message();
    expect([...document.body.querySelectorAll(".email-actions .row")].some((r) => r.textContent?.includes("Move to Section"))).toBe(false);
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
  it("Waiting to Send: Not Sent Yet is the one amber fact, the seconds are white, Undo is the one action; no pill, no empty note (catalog gate, Email v1)", () => {
    const held = (o: Partial<import("./useHeldSend").HeldState> = {}) => ({ phase: "held" as const, seconds: 24, note: null, status: null, undoing: false, ...o });
    const h = render(<HeldSendScreen held={held()} subject="Re: Transcript" from="dave@example.test" recipients={["coach@example.test"]} onUndo={noop} onBack={noop} />);
    expect(texts(h.container, ".email-review-card .conn-meta .fact")).toEqual(["Not Sent Yet", "24s"]);
    expect(h.container.querySelector(".conn-meta .fact")).toHaveClass("warn");
    expect(h.container.querySelector(".email-note")).toBeNull();
    expect(h.container.querySelectorAll(".btn").length).toBe(1);
    expect(catalogViolations(h.container)).toEqual([]);
    cleanup();
    const p = render(<HeldSendScreen held={held({ phase: "preparing", seconds: 0 })} subject="" from="dave@example.test" recipients={["coach@example.test"]} onUndo={noop} onBack={noop} />);
    expect(texts(p.container, ".email-review-card .conn-meta .fact")).toEqual(["Not Sent Yet", "Preparing to Send"]);
    expect(catalogViolations(p.container)).toEqual([]);
    cleanup();
    const sd = render(<HeldSendScreen held={held({ phase: "sending", seconds: 0 })} subject="x" from="dave@example.test" recipients={["coach@example.test"]} onUndo={noop} onBack={noop} />);
    expect(texts(sd.container, ".email-review-card .conn-meta .fact")).toEqual(["Sending"]);
    expect(sd.container.querySelector(".btn")).toBeDisabled();
    expect(catalogViolations(sd.container)).toEqual([]);
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

// ---------------------------------------------------------------------------
// WHY THIS SECTION? (issue 112, item 15): the explanation sheet follows the catalog like every other sheet of the tab
// ---------------------------------------------------------------------------
describe("Why This Section?: one grey a row, facts as spans, no dot in a string, Title Case, 12-hour time", () => {
  // The sheet portals to document.body, so the check runs there. A row of facts is a bare mailbox row plus the facts that decide it.
  const FACTS = { rfc_message_id: null, list_id: null, list_unsubscribe: null, mime_type: null, content_class: null, own_reply: null } as const;
  const msg = (o: Partial<InboxRow>): InboxRow => ({ ...ROW_, attachment_metadata: [], ...FACTS, ...o });
  const sheet = (r: InboxRow, o: Partial<Parameters<typeof WhySectionSheet>[0]> = {}) =>
    render(<WhySectionSheet row={r} overrides={{}} now={NOW} onMove={noop} onPutBack={noop} onClose={noop} {...o} />);
  const rows = () => [...document.body.querySelectorAll('[role="dialog"] .row')] as HTMLElement[];
  const lines = () => rows().map((r) => [r.querySelector(".conn-name")!.textContent, texts(r, ".fact").map((t) => (t ?? "").replace(/ /g, " "))] as const);

  const CASES: Array<[string, InboxRow, Partial<Parameters<typeof WhySectionSheet>[0]>, ReadonlyArray<readonly [string | null, string[]]>]> = [
    ["Conversations", msg({ own_reply: true }), {}, [["Rule", ["You Sent a Message in This Thread"]], ["Evidence", ["Sent Message in Synced Mail", "dave@example.test"]]]],
    ["Schedule by type", msg({ mime_type: "text/calendar" }), {}, [["Rule", ["It Has Calendar Structure"]], ["Evidence", ["Message Type Is Calendar"]]]],
    ["Schedule by Content-Class", msg({ content_class: "urn:content-classes:calendarmessage" }), {}, [["Rule", ["It Has Calendar Structure"]], ["Evidence", ["Marked as a Calendar Message"]]]],
    ["Schedule by file", msg({ attachment_metadata: [{ filename: "invite.ics", mime: "application/octet-stream", attachmentId: "i", size: 1 }] }), {}, [["Rule", ["It Has Calendar Structure"]], ["Evidence", ["Calendar File Attached"]]]],
    ["Money", msg({ from_address: "noreply@billing.coned.com", subject: "Your Con Edison Bill Is Due" }), {}, [["Rule", ["It Matches a Money Sender Template"]], ["Evidence", ["Con Edison", "Invoice", "noreply@billing.coned.com"]]]],
    ["Mailing Lists, both headers", msg({ list_id: "<l>", list_unsubscribe: "<u>" }), {}, [["Rule", ["It Has a Mailing List Header"]], ["Evidence", ["List-ID and List-Unsubscribe Headers"]]]],
    ["Mailing Lists, one header", msg({ list_unsubscribe: "<u>" }), {}, [["Rule", ["It Has a Mailing List Header"]], ["Evidence", ["List-Unsubscribe Header"]]]],
    ["Other, facts kept", msg({}), {}, [["Rule", ["No Section Rule Matched"]]]],
    ["Other, facts not kept", { ...ROW_ }, {}, [["Rule", ["No Section Rule Matched"]], ["Evidence", ["Facts Not Kept for This Message"]]]],
    ["a move with its time", msg({}), { overrides: { m1: "money" }, movedAt: "2026-10-05T09:12:00" }, [["Rule", ["You Moved It Here"]], ["Evidence", ["Saved on This Phone Only", "Today", "9:12 AM"]], ["Without Your Move", ["Other"]]]],
    ["a move over a Money message, an older day", msg({ from_address: "noreply@billing.coned.com", subject: "Your Con Edison Bill Is Due" }), { overrides: { m1: "lists" }, movedAt: "2026-10-01T21:05:00" }, [["Rule", ["You Moved It Here"]], ["Evidence", ["Saved on This Phone Only", "Oct 1", "9:05 PM"]], ["Without Your Move", ["Money"]]]],
    ["a move over a row with no facts kept", { ...ROW_ }, { overrides: { m1: "schedule" } }, [["Rule", ["You Moved It Here"]], ["Evidence", ["Saved on This Phone Only"]], ["Without Your Move", ["Other", "Facts Not Kept for This Message"]]]],
  ];

  for (const [name, r, o, expected] of CASES) {
    it(`${name}: says what it should, and passes the catalog check`, () => {
      sheet(r, o);
      expect(lines()).toEqual(expected);
      expect(catalogViolations(document.body)).toEqual([]);
      // Every fact is a span; no row holds a control; the only buttons are the sheet's own, under the rows.
      for (const f of document.body.querySelectorAll('[role="dialog"] .fact')) expect(f.tagName).toBe("SPAN");
      for (const row of rows()) expect(row.querySelector("button, .pill-act, .row-act, .btn-sm, .quiet-action")).toBeNull();
      expect(document.body.querySelector('[role="dialog"] .facts')).toBeNull();
    });
  }

  it("a row that has nothing to say is not drawn: Other with its facts kept is a Rule alone", () => {
    sheet(msg({}));
    expect(rows()).toHaveLength(1);
    expect(document.body.querySelectorAll('[role="dialog"] .conn-meta')).toHaveLength(1);
  });

  it("the head names the section, the actions are the sheet's own (Move to Section, Done), and a section dot is the only colour", () => {
    sheet(msg({ from_address: "noreply@billing.coned.com", subject: "Your Con Edison Bill Is Due" }), { overrides: { m1: "lists" } });
    expect(document.body.querySelector('[role="dialog"] .grp .eyebrow')).toHaveTextContent("In Mailing Lists");
    expect([...document.body.querySelectorAll(".action-sheet button")].map((b) => b.textContent)).toEqual(["Move to Section", "Use Its Own Section", "Done"]);
    // The dot on the section the message would be in is the slot colour the Money heading wears; the other facts are white, grey or small caps.
    const without = rows().find((r) => r.querySelector(".conn-name")?.textContent === "Without Your Move")!;
    expect(without.querySelector(".fact.cat .cd")).toHaveClass("cat-bg-teal");
    expect(document.body.querySelector('[role="dialog"] .fact.warn, [role="dialog"] .fact.red, [role="dialog"] .fact.good')).toBeNull();
  });

  it("every explanation string is Title Case with no dot, dash or sentence in it (the copy test above reads these too)", () => {
    const strings = [copy.WHY_SECTION, copy.WHY_ROW_RULE, copy.WHY_ROW_EVIDENCE, copy.WHY_ROW_WITHOUT_MOVE, copy.WHY_SAVED_HERE, copy.WHY_SENT_FOUND, copy.WHY_NO_FACTS, copy.WHY_MONEY_AMBIGUOUS,
      copy.whyIn("Mailing Lists"), ...Object.values(copy.WHY_RULE), ...Object.values(copy.WHY_CAL), ...Object.values(copy.WHY_MONEY_WORD), ...Object.values(copy.WHY_LIST)];
    expect(Object.keys(copy.WHY_RULE).sort()).toEqual(["calendar", "conversation", "list", "money", "moved", "other"]);
    expect(Object.keys(copy.WHY_CAL).sort()).toEqual(["attachment", "content_class", "mime"]);
    expect(Object.keys(copy.WHY_MONEY_WORD).sort()).toEqual(["invoice", "receipt", "statement"]);
    for (const s of strings) {
      expect(isTitleCase(s), s).toBe(true);
      // A middle dot, a bullet, an en dash or an em dash, by code (no such character is written in this file).
      for (const code of [0x00b7, 0x2022, 0x2013, 0x2014]) expect(s.includes(String.fromCharCode(code)), s).toBe(false);
      expect(s, s).not.toMatch(/\. [A-Z]| - /);
    }
  });
});

// ---------------------------------------------------------------------------
// THE USE GROUPED MAIL EXPLAINER (issue 112, item 17): the one-time card at the top of the Grouped list follows the catalog
// ---------------------------------------------------------------------------
import EmailFlow from "./EmailFlow";
import { capsulesInRows, loneActionBoxes, numberCaseViolations } from "../laws/catalogCheck";

describe("The Use Grouped Mail explainer: one grey fact span, Title Case, no dot or dash, a capsule and a Dismiss, Email's own colour", () => {
  const mailbox = account({ id: "a" });
  const message: InboxRow = { ...ROW_, attachment_metadata: [] };
  const answers: Record<string, unknown> = {
    email_accounts: [mailbox], email_inbox: { rows: [message], cached_total: 1, page: 30 }, substrate_readiness: { registered: [] }, candidates_for: [],
  };
  const client: RpcClient = { rpc: async (fn) => ({ data: answers[fn] ?? null, error: null }) };
  const mountHome = async () => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, synced: 0, removed: 0, next_page: null, complete: true, resynced: false }) }) as Response));
    const ui = render(<EmailFlow client={client} token="jwt" userId="u-intro" categories={[]} now={() => NOW} onOpenConnections={noop} />);
    await waitFor(() => expect(ui.container.querySelector(".email-intro .notice-card")).not.toBeNull(), { timeout: 4000 });
    return ui;
  };
  afterEach(() => { vi.unstubAllGlobals(); });

  it("passes the same check every Email screen passes, and nothing else on the screen is a violation", async () => {
    const { container } = await mountHome();
    expect(catalogViolations(container)).toEqual([]);
    expect(numberCaseViolations(container)).toEqual([]);
    expect(capsulesInRows(container)).toEqual([]);
    expect(loneActionBoxes(container)).toEqual([]);
  });

  it("its title is the card's name and its one fact is a span: Title Case, one untoned grey, no dot, dash or sentence, nothing in a row beside it", async () => {
    const { container } = await mountHome();
    const card = container.querySelector(".email-intro .notice-card") as HTMLElement;
    expect(texts(card, ".conn-name")).toEqual([copy.GROUPED_INTRO_TITLE]);
    const facts = [...card.querySelectorAll(".fact")];
    expect(facts.map((f) => f.textContent)).toEqual([copy.GROUPED_INTRO_SUB]);
    expect(facts.every((f) => f.tagName === "SPAN")).toBe(true);
    expect(facts.filter(isGrey)).toHaveLength(1);
    expect(facts.some((f) => TONES.some((t) => f.classList.contains(t)))).toBe(false);
    // Drawn once, by the shared line: a .facts line holding the one fact inside the card's own meta line, not a wrapping line inside a line.
    expect(card.querySelectorAll(".conn-meta")).toHaveLength(1);
    expect(card.querySelectorAll(".conn-meta > .facts > .fact")).toHaveLength(1);
    for (const f of facts) expect(f.textContent).not.toMatch(SEPARATOR);
    // A row with nothing to say shows nothing: there is no third line, no placeholder and no repeat of the title or the action.
    expect([...card.querySelectorAll(".conn-name, .conn-meta, .pill-act")].map((e) => e.textContent)).toEqual([copy.GROUPED_INTRO_TITLE, copy.GROUPED_INTRO_SUB, copy.USE_GROUPED]);
  });

  it("its controls are the shared capsule and the shared 44px Dismiss, the capsule is the only one, and the hidden swipe duplicate of Dismiss is not drawn", async () => {
    const { container } = await mountHome();
    const card = container.querySelector(".email-intro .notice-card") as HTMLElement;
    expect(within(card).getByText(copy.USE_GROUPED)).toHaveClass("pill-act");
    expect(card.querySelectorAll(".pill-act, .row-act, .btn-sm, .quiet-action")).toHaveLength(1);
    // The 44px box is .notice-x's own rule (components.css, pinned by today/NoticeCard.test.tsx); this holds the card to it.
    const x = within(card).getByRole("button", { name: "Dismiss" });
    expect(x).toHaveClass("notice-x");
    expect(card.querySelector(".notice-dismiss")).toBeNull();
    // The Email tab's own capsule home: a notice card, never a list row or a list card's foot.
    expect(card.closest(".list-card-ruled, .email-list")).toBeNull();
    expect(card.querySelector(".row .row-act")).toBeNull();
  });

  it("its type icon wears Email's teal, the colour of the envelope everywhere else, and the card has no colour of its own", async () => {
    const { container } = await mountHome();
    const card = container.querySelector(".email-intro .notice-card") as HTMLElement;
    const disc = card.querySelector(".notice-disc") as HTMLElement;
    expect(disc).toHaveClass("cat-bg-teal");
    expect(disc.querySelector("svg")).not.toBeNull();
    // No inline colour anywhere in it, and no colour class but the one tone.
    expect(card.querySelector("[style*='color'], [style*='background']")).toBeNull();
    expect([...card.querySelectorAll("[class*='cat-']")].map((e) => [...e.classList].filter((c) => /^cat-/.test(c)))).toEqual([["cat-bg-teal"]]);
  });

  it("the three new strings are Title Case with no dot, dash or sentence in them, and the title stays short enough for two lines at 1.4x", () => {
    for (const s of [copy.GROUPED_INTRO_TITLE, copy.GROUPED_INTRO_SUB, copy.USE_GROUPED]) {
      expect(isTitleCase(s), s).toBe(true);
      for (const code of [0x00b7, 0x2022, 0x2013, 0x2014]) expect(s.includes(String.fromCharCode(code)), s).toBe(false);
      expect(s, s).not.toMatch(/\. [A-Z]| - /);
    }
    // The spec's own sentence (66 characters) was drawn through the real card at 390 wide: three lines at the normal text size and four
    // at 1.4x. The title that ships is 23 and takes one line at 1x and two at 1.4x in the widest face tried. A long title comes back as a long card.
    expect(copy.GROUPED_INTRO_TITLE.length).toBeLessThanOrEqual(32);
  });
});

// ---------------------------------------------------------------------------
// THE CONTACT SHEET (issue 112, item 14): the sheet on the sender's circle follows the catalog like every other sheet of the tab
// ---------------------------------------------------------------------------
import ContactSheet from "./ContactSheet";
import type { Resolved } from "./contactResolve";
import type { Person } from "../people/types";

describe("The contact sheet: one grey a row, facts as spans, Title Case, 12-hour time, no pill in a row, its one action in the sheet's own action line", () => {
  const MAYA: Person = { id: "p-maya", data: { name: "Maya Chen", group: "contacts", email: "coach@example.test", categoryIds: ["c1"] } };
  const TWIN: Person = { id: "p-twin", data: { name: "Maya Chen-Ortiz", group: "contacts", email: "coach@example.test" } };
  const AREAS: Category[] = [AREA, { id: "c2", data: { name: "Bridge", color: "sky", order: 1 } } as Category];
  const MAYA2: Person = { ...MAYA, data: { ...MAYA.data, categoryIds: ["c1", "c2"] } };
  const recent: InboxRow[] = [
    { ...ROW_, id: "r1", provider_id: "r1", subject: "Transcript" },
    { ...ROW_, id: "r2", provider_id: "r2", thread_id: "t2", subject: "", internal_date: "2026-10-04T21:05:00" },
  ];
  const draw = (resolved: Resolved, o: Partial<Parameters<typeof ContactSheet>[0]> = {}) =>
    render(<ContactSheet target={{ address: "coach@example.test", name: "Coach Miller" }} resolved={resolved} categories={AREAS} recent={recent} labels={{ "dave@example.test": "work" }} now={NOW}
      onOpenMessage={noop} onOpenContact={noop} onClose={noop} {...o} />);
  const STATES: Array<[string, Resolved]> = [
    ["a saved contact with two groups", { kind: "one", person: MAYA2 }],
    ["a saved contact with one group", { kind: "one", person: MAYA }],
    ["an address that is not saved", { kind: "none" }],
    ["two contacts on one address", { kind: "many", people: [MAYA2, TWIN] }],
    ["the person's own mailbox", { kind: "own" }],
    ["a People store that could not be read", { kind: "unknown" }],
  ];

  for (const [name, resolved] of STATES) {
    it(`${name}: passes the same check every Email screen passes`, () => {
      draw(resolved);
      expect(catalogViolations(document.body)).toEqual([]);
      expect(numberCaseViolations(document.body)).toEqual([]);
      expect(capsulesInRows(document.body)).toEqual([]);
      expect(loneActionBoxes(document.body)).toEqual([]);
      // Every fact is a span, and a row is a plain row: nothing in it to press but the row itself.
      for (const f of document.body.querySelectorAll(".fact")) expect(f.tagName).toBe("SPAN");
      for (const r of document.body.querySelectorAll(".row")) expect(r.querySelector("button, .pill-act, .row-act, .btn-sm, .quiet-action")).toBeNull();
      expect(document.body.querySelector(".facts:empty, .conn-meta:empty")).toBeNull();
    });
  }

  it("the head has one grey, the raw address; the status is a mark or white, never a second grey; the group dots are the Areas' own", () => {
    draw({ kind: "one", person: MAYA2 });
    const head = document.body.querySelector(".email-head")!;
    expect(texts(head, ".fact")).toEqual(["coach@example.test", "Money", "Bridge"]);
    expect([...head.querySelectorAll(".fact")].filter(isGrey).map((f) => f.textContent)).toEqual(["coach@example.test"]);
    expect([...head.querySelectorAll(".fact.cat .cd")].map((d) => d.className)).toEqual(["cd cat-bg-green", "cd cat-bg-sky"]);
    cleanup();
    draw({ kind: "none" });
    const bare = document.body.querySelector(".email-head")!;
    expect(texts(bare, ".fact")).toEqual(["coach@example.test", "Not in Contacts"]);
    expect([...bare.querySelectorAll(".fact")].filter(isGrey).map((f) => f.textContent)).toEqual(["coach@example.test"]);
    expect(bare.querySelector(".fact b")).toHaveTextContent("Not in Contacts");
  });

  it("a Recent Mail row is a subject and its day, time and mailbox as small-caps facts: no grey of its own, no count, no pill", () => {
    draw({ kind: "none" });
    const rows = [...document.body.querySelectorAll(".sh2 + .list-card-ruled .row")];
    expect(rows.map((r) => r.querySelector(".conn-name")!.textContent)).toEqual(["Transcript", "(No Subject)"]);
    expect(rows.map((r) => texts(r, ".fact").map((t) => (t ?? "").replace(/\s/g, " ")))).toEqual([["Today", "9:12 AM", "Work"], ["Yesterday", "9:05 PM", "Work"]]);
    for (const r of rows) {
      expect([...r.querySelectorAll(".fact")].filter(isGrey)).toEqual([]);
      expect(r.querySelector(".chev")).not.toBeNull();
    }
  });

  it("Open Contact is the sheet's own action, beneath the identity and the mail, never a button alone in a box and never in a row", () => {
    draw({ kind: "one", person: MAYA });
    const open = within(document.body).getByRole("button", { name: "Open Contact" });
    expect(open.closest(".action-sheet")).not.toBeNull();
    expect(open.closest(".row, .list-card-ruled")).toBeNull();
    // Its card holds the identity and the mail beside it: it is not a box with only an action in it.
    const card = open.closest(".card")!;
    expect(card.querySelector(".email-head")).not.toBeNull();
    expect(card.querySelector(".list-card-ruled")).not.toBeNull();
    // The Done card is the sheet's second card, like every sheet's Cancel or Done.
    expect([...document.body.querySelectorAll(".sheet-scrim > .card")].map((c) => [...c.querySelectorAll("button")].map((b) => b.textContent))).toEqual([["Open Contact"], ["Done"]]);
  });

  it("the strings it writes are Title Case with no dot, dash or sentence in them, and the spec's own words stand", () => {
    expect(copy.NOT_IN_CONTACTS).toBe("Not in Contacts");
    expect(copy.CHOOSE_CONTACT).toBe("Choose Contact");
    for (const s of [copy.CONTACT_LABEL, copy.NOT_IN_CONTACTS, copy.CHOOSE_CONTACT, copy.RECENT_MAIL, copy.OPEN_CONTACT, copy.YOUR_MAILBOX, copy.contactDoorLabel("Maya Chen")]) {
      expect(isTitleCase(s), s).toBe(true);
      for (const code of [0x00b7, 0x2022, 0x2013, 0x2014]) expect(s.includes(String.fromCharCode(code)), s).toBe(false);
      expect(s, s).not.toMatch(/\. [A-Z]| - /);
    }
  });
});
