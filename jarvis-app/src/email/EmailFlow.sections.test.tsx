// @vitest-environment jsdom
// THE FIVE SECTIONS, POPULATED (issue 112, "Section rendering with real content";
// Email v1 spec 3.1, 3.2; AC02, AC03, AC04, AC11; Trim Decisions 2026-10-08).
// Conversations, Schedule and Money had been verified EMPTY and called passed. This
// mounts the real EmailFlow with 24 realistic messages across all five sections,
// the way Gmail and the sync probe hand them over: a Chase statement, a Con Edison
// bill, an Apple receipt, a Stripe receipt, a Square invoice, a refund with no
// template, Google Calendar invites (timed, all-day, canceled, updated), an .ics
// from a school, a two-message thread, a sender name and a subject far too long
// for the row, a message with no subject and no name, entities and angle brackets
// in the words, a message that matches every rule at once, lookalike senders, and
// two mailboxes. Then it holds, in the DOM, what the spec and the catalog say:
//   - every loaded message is on screen exactly once, in the fixed order, with its count
//     and its colour, and a message that qualifies for several sections is in one;
//   - words alone ("meeting", "invoice", "$") never classify, a lookalike sender is
//     Other, a refund with no template is Other;
//   - a row draws no fact of its own (its words are the mail's); an event card draws its
//     day in the event's own zone and its clock in 12-hour; an amount groups its thousands;
//   - the list proposes no bill, receipt, task or waiting card from a row's words (Dave
//     2026-10-13, hide the old rule candidates), and still proposes events;
//   - the catalog's DOM checks pass on the whole populated home.
// jsdom has no layout, so tap sizes and clipping are the tap sweep's and the bench's.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import EmailFlow from "./EmailFlow";
import type { EmailAccount, InboxRow, RpcClient } from "./emailClient";
import { newestFirst } from "./emailClient";
import { LIST_ROW_KINDS, listReadingKey, readWithRules, readingsOf, type Candidate } from "./candidates";
import { senderOf } from "./format";
import { SECTION_SLOT, recordMove } from "./sections";
import { numberCaseViolations } from "../laws/catalogCheck";
import { resetToasts } from "../shared/toast";

// Each test mounts the whole home with 24 rows and waits for the list's reading to finish: a second or two on a busy machine,
// more while the full suite runs in parallel, so the default five seconds is not the honest limit.
vi.setConfig({ testTimeout: 20000 });

const NOW = new Date("2026-10-03T15:00:00Z");
const USER = "user-1";
const ZONE = "America/New_York";
const DAVE = "dave@example.test";
const WORK = "work@example.test";

const account = (o: Partial<EmailAccount>): EmailAccount => ({ id: "acct-dave", address: DAVE, state: "connected", last_sync_at: "2026-10-03T14:50:00Z", sync_error: null, capabilities: { archive: true, trash: true, read: true }, connected_at: "2026-09-01T00:00:00Z", scopes: [], cached: 4, signature_text: "", signature_revision: 1, ...o });
const BOTH = [account({}), account({ id: "acct-work", address: WORK })];
const JUST_DAVE = [account({})];

let seq = 0;
const row = (id: string, minsAgo: number, o: Partial<InboxRow>): InboxRow => ({
  id: `u-${id}`, account_id: "acct-dave", account: DAVE, provider_id: id, thread_id: `t-${id}`, internal_date: new Date(NOW.getTime() - minsAgo * 60000).toISOString(),
  from_address: "x@example.test", from_name: "X", subject: "S " + id, snippet: "", has_body: false, attachment_metadata: [], provider_labels: ["INBOX"], source_hash: `sh-${id}-${seq++}`, read: true, ...o,
});
const atWork = { account_id: "acct-work", account: WORK } as const;
const LONG_NAME = "Dr. Alexandria Montgomery-Featherstonehaugh III, Esq., Director of Regional Operations";
const LONG_SUBJECT = "Re: Fwd: Fwd: Re: Updated agenda, attendee list, parking instructions and catering selections for the Q4 leadership offsite in Providence";
const GOOGLE = "calendar-notification@google.com";

// Every message the sync could have cached, by the key the assertions use.
const F = {
  // Conversations: this account's thread holds a message Dave sent (own_reply, migration 0067).
  cv1: row("cv1", 10, { own_reply: true, read: false, from_name: "Maya Chen", from_address: "maya@example.test", subject: "Re: Q4 budget walkthrough", snippet: "Thanks, I will send the revised numbers Friday.", thread_id: "tA" }),
  cv2: row("cv2", 20, { own_reply: true, from_name: "Priya Shah", from_address: "priya@example.test", subject: "Re: Q4 budget walkthrough", snippet: "Works for me. Our advisor meeting is on October 8 at 6:00 PM ET for an hour.", thread_id: "tA" }),
  cv3: row("cv3", 30, { ...atWork, own_reply: true, from_name: LONG_NAME, from_address: "alexandria.montgomery@verylongdomainname.example.test", subject: LONG_SUBJECT, snippet: "Please find the updated agenda attached and confirm your catering selections by end of day Thursday so that we can finalize the headcount with the venue.", attachment_metadata: [{ filename: "agenda.pdf", mime: "application/pdf", attachmentId: "a1", size: 1000 }] }),
  cv4: row("cv4", 40, { own_reply: true, from_name: "Tom & Jerry's", from_address: "tj@example.test", subject: 'Re: "Q4" <draft> & more', snippet: 'Tom & Jerry\'s "Q4" <draft> is ready &amp; waiting' }),
  cv5: row("cv5", 50, { own_reply: true, from_name: "", from_address: "noname@example.test", subject: "", snippet: "" }),
  // A message that qualifies for Conversations, Schedule, Money and Mailing Lists at once: it is Conversations, once (AC03).
  all1: row("all1", 60, { own_reply: true, mime_type: "text/calendar", list_id: "<bills.coned.com>", from_address: "noreply@billing.coned.com", from_name: "Con Edison", subject: "Your Con Edison Bill Is Ready", snippet: "Thanks for the reminder, I will pay it today." }),
  // Schedule: calendar structure, never subject words.
  s1: row("s1", 15, { mime_type: "text/calendar", rfc_message_id: "<calendar-0a1b2c3d-1111-2222-3333-444455556666@google.com>", from_name: "Dentist Office", from_address: GOOGLE, subject: "Invitation: Dentist @ Tue Oct 6, 2026 2pm - 3pm (EDT) (dave@example.test)", snippet: "Dentist Tuesday Oct 6, 2026 2pm - 3pm Eastern Time - New York Where 123 Main St, Brooklyn, NY View all guest info", read: false }),
  s2: row("s2", 25, { mime_type: "text/calendar", from_name: "Alex Morgan", from_address: GOOGLE, subject: "Invitation: Columbus Day @ Mon Oct 12, 2026 (All day) (dave@example.test)", snippet: "Columbus Day Monday Oct 12, 2026 (All day)" }),
  s3: row("s3", 35, { mime_type: "text/calendar", from_name: "Sam Lee", from_address: GOOGLE, subject: "Canceled event: Standup @ Wed Oct 7, 2026 10am - 10:30am (EDT) (dave@example.test)", snippet: "This event has been canceled and removed from your calendar." }),
  s4: row("s4", 45, { mime_type: "text/calendar", from_name: "Pat Kim", from_address: GOOGLE, subject: "Updated invitation: Design review @ Thu Oct 8, 2026 9:30am - 10:30am (EDT) (dave@example.test)", snippet: "Design review Thursday Oct 8 9:30am - 10:30am" }),
  s5: row("s5", 55, { attachment_metadata: [{ filename: "invite.ics", mime: "application/ics", attachmentId: "a2", size: 800 }], from_name: "Riverside School", from_address: "office@riverside.example.test", subject: "Parent Teacher Conference Sign-Up", snippet: "Your slot is Tuesday at 3:40 PM. See attached." }),
  // 10:00 PM Eastern is already tomorrow in UTC: the case a day label read off the UTC date got wrong.
  s6: row("s6", 65, { mime_type: "text/calendar", from_name: "Maya Chen", from_address: GOOGLE, subject: "Invitation: Dinner with Maya @ Tue Oct 6, 2026 10pm - 11pm (EDT) (dave@example.test)", snippet: "Dinner with Maya Tuesday Oct 6, 2026 10pm - 11pm Eastern Time - New York" }),
  // Money: an exact registered sender and subject format (moneyRegistry.ts), nothing else.
  m1: row("m1", 12, { from_name: "Con Edison", from_address: "noreply@billing.coned.com", subject: "Your Con Edison Bill Is Due", snippet: "Your bill of $1,284.56 is due on Oct 15, 2026. View your bill", read: false }),
  m2: row("m2", 22, { ...atWork, from_name: "Chase", from_address: "no.reply.alerts@chase.com", subject: "Your latest statement is now available", snippet: "Your statement is ready to view." }),
  m3: row("m3", 32, { from_name: "Apple", from_address: "no_reply@email.apple.com", subject: "Your receipt from Apple.", snippet: "Receipt Order ID: ML7Q Document 12345 Total $9.99" }),
  m4: row("m4", 42, { from_name: "Wells Fargo", from_address: "alerts@notify.wellsfargo.com", subject: "Your statement for credit card account ...5678", snippet: "" }),
  m5: row("m5", 52, { from_name: "Stripe", from_address: "receipts+acct_1AbC@stripe.com", subject: "Your receipt from Example Hosting Ltd #1234-5678", snippet: "Receipt from Example Hosting Ltd $2,400.00 Paid Oct 2, 2026" }),
  m6: row("m6", 62, { from_name: "Square", from_address: "messenger@messaging.squareup.com", subject: "You received a new invoice (#000123-R-0001)", snippet: "Invoice from Example Cafe, due upon receipt. Amount $48.00" }),
  // A mailing list.
  l1: row("l1", 80, { list_id: "<news.x>", from_name: "Newsletter", from_address: "n@news.example.test", subject: "Weekly", snippet: "Hello" }),
  // Other: everything the sections do not name, however much it sounds like one.
  o1: row("o1", 90, { from_name: "Stranger", from_address: "s@example.test", subject: "Hi", snippet: "Hi there" }),
  o2: row("o2", 92, { from_name: "Invoice Desk", from_address: "desk@example.test", subject: "Invoice for the meeting: $40.00 due Friday", snippet: "Please pay by Friday." }),
  m7: row("m7", 72, { from_name: "Visa Refund", from_address: "refunds@somestore.example.test", subject: "Your refund of $25.00 has been issued (credit)", snippet: "Credit of $25.00 to your card" }),
  x1: row("x1", 74, { from_name: "Con Edison Billing Team", from_address: "noreply@billing.coned.com.example.test", subject: "Your Con Edison Bill Is Due", snippet: "Pay now to avoid a late fee." }),
  x2: row("x2", 76, { from_name: "Con Edison", from_address: "noreply@billing.coned.com", subject: "Save energy this summer with Con Edison", snippet: "Tips for a cooler home." }),
} satisfies Record<string, InboxRow>;
type Key = keyof typeof F;
const KEYS = Object.keys(F) as Key[];
const ROWS: InboxRow[] = KEYS.map((k) => F[k]);
const SECTIONS: Array<[string, string, Key[]]> = [
  ["Conversations", "6 Loaded", ["cv1", "cv2", "cv3", "cv4", "cv5", "all1"]],
  ["Schedule", "6 Loaded", ["s1", "s2", "s3", "s4", "s5", "s6"]],
  ["Money", "6 Loaded", ["m1", "m2", "m3", "m4", "m5", "m6"]],
  ["Mailing Lists", "1 Loaded", ["l1"]],
  ["Other", "5 Loaded", ["o1", "o2", "m7", "x1", "x2"]],
];

// A message is the sender and the subject as its row draws them.
const identity = (r: InboxRow): string => `${senderOf(r)}\u0000${r.subject.trim() || "(No Subject)"}`;
const BY_IDENTITY = new Map(KEYS.map((k) => [identity(F[k]), k] as const));

// The cards the server already holds: an event the person's own Add to Schedule or an older read made, a bill an older
// build read from the list. The list proposes none of these now; whatever is already there still draws.
const card = (id: string, key: Key, payload: Record<string, unknown>): Candidate => ({
  id, message_id: F[key].id, account_id: F[key].account_id, kind: payload.kind, origin: "rule", agent_name: null, status: "proposed", revision: 1, payload, payload_hash: "h" + id,
  provenance_by_field: {}, missing_fields: [], fingerprint: "f" + id, source_hash: F[key].source_hash, message_source_hash: F[key].source_hash,
  destination_id: null, action_id: null, proposal_id: null, extractor_version: "v", created_at: "2026-10-03T00:00:00Z", updated_at: "2026-10-03T00:00:00Z", saved_sibling: null,
}) as unknown as Candidate;
const CARDS: Candidate[] = [
  card("c-m1", "m1", { kind: "bill", issuer: "Con Edison", amount: { minor_units: 128456, currency: "USD" }, due_date: "2026-10-15", no_due_date_confirmed: false }),
  card("c-s1", "s1", { kind: "event", title: "Dentist", time: { all_day: false, start_at: "2026-10-06T18:00:00.000Z", end_at: "2026-10-06T19:00:00.000Z", timezone: ZONE, selected_offset: "-04:00" }, location: "123 Main St, Brooklyn, NY", external_uid: null }),
  card("c-s2", "s2", { kind: "event", title: "Columbus Day", time: { all_day: true, start_date: "2026-10-12", end_date: "2026-10-13" }, location: null, external_uid: null }),
  card("c-s6", "s6", { kind: "event", title: "Dinner With Maya", time: { all_day: false, start_at: "2026-10-07T02:00:00.000Z", end_at: "2026-10-07T03:00:00.000Z", timezone: ZONE, selected_offset: "-04:00" }, location: null, external_uid: null }),
];

/** The server's candidate table, as far as the list touches it: what it holds, and what a proposal adds (one card per fingerprint). */
interface Rig { client: RpcClient; calls: Array<{ fn: string; args: Record<string, unknown> }>; stored: Candidate[] }
function rig(o: { rows?: InboxRow[]; accounts?: EmailAccount[]; cards?: Candidate[] } = {}): Rig {
  const all = [...(o.rows ?? ROWS)].sort(newestFirst);
  const calls: Rig["calls"] = [];
  const stored: Candidate[] = [...(o.cards ?? CARDS)];
  const table: Record<string, (a: Record<string, unknown>) => unknown> = {
    email_accounts: () => o.accounts ?? BOTH,
    email_inbox: (a) => ({ rows: all.slice(0, a.p_limit as number), cached_total: all.length, page: a.p_limit }),
    substrate_readiness: () => ({ registered: ["money_bill", "money_receipt", "task", "event", "waiting"] }),
    candidates_for: (a) => stored.filter((c) => (a.p_messages as string[]).includes(c.message_id)),
    candidate_propose: (a) => {
      const msg = all.find((m) => m.id === a.p_message)!;
      const same = stored.find((c) => c.message_id === a.p_message && c.kind === a.p_kind && c.fingerprint === a.p_fingerprint);
      if (same) return { candidate_id: same.id, revision: 1, status: same.status, payload_hash: same.payload_hash, replay: true, stale_marked: 0 };
      const missing = a.p_missing as string[];
      const made = {
        id: `made-${stored.length}`, message_id: msg.id, account_id: msg.account_id, kind: a.p_kind, origin: a.p_origin, agent_name: null, status: missing.length ? "needs_details" : "proposed", revision: 1,
        payload: { ...(a.p_payload as object), kind: a.p_kind }, payload_hash: `h-made-${stored.length}`, provenance_by_field: a.p_provenance, missing_fields: missing, fingerprint: a.p_fingerprint,
        source_hash: msg.source_hash, message_source_hash: msg.source_hash, destination_id: null, action_id: null, proposal_id: null, extractor_version: a.p_extractor_version,
        created_at: NOW.toISOString(), updated_at: NOW.toISOString(), saved_sibling: null,
      } as unknown as Candidate;
      stored.push(made);
      return { candidate_id: made.id, revision: 1, status: made.status, payload_hash: made.payload_hash, replay: false, stale_marked: 0 };
    },
  };
  const client: RpcClient = { rpc: async (fn, args) => { calls.push({ fn, args: (args ?? {}) as Record<string, unknown> }); const f = table[fn]; if (!f) throw new Error("no fake for " + fn); return { data: f((args ?? {}) as Record<string, unknown>), error: null }; } };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const answer = url.endsWith("/api/email/sync") ? { status: 200, body: { ok: true, synced: 0, removed: 0, next_page: null, complete: true, resynced: false } } : { status: 404, body: { code: "NOT_FOUND" } };
    return { ok: answer.status < 300, status: answer.status, json: async () => answer.body } as Response;
  }));
  return { client, calls, stored };
}

/** The cards on screen once the list has read every row: the four the server held, and the one event Priya's reply states outright. */
const CARDS_DRAWN = CARDS.length + 1;

/** Mounted, with every row drawn, every row read once by the list's rules, and every card the server then holds drawn. */
async function mount(r: Rig, o: { rows?: InboxRow[] } = {}) {
  const rows = o.rows ?? ROWS;
  const ui = render(<EmailFlow client={r.client} token="jwt" userId={USER} categories={[]} now={() => NOW} zone={ZONE} onOpenConnections={() => {}} onOpenModule={() => {}} />);
  await waitFor(() => expect(document.querySelectorAll(".erow").length).toBe(rows.length), { timeout: 5000 });
  await waitFor(() => expect(rows.every((x) => readingsOf(USER).has(listReadingKey(x.account_id, x.id, x.source_hash)))).toBe(true), { timeout: 5000 });
  await waitFor(() => expect(document.querySelectorAll("[data-candidate]").length).toBeGreaterThanOrEqual(CARDS_DRAWN), { timeout: 5000 });
  return ui;
}

const rowEls = (): HTMLElement[] => [...document.querySelectorAll(".erow")] as HTMLElement[];
const keyOfRow = (el: Element): Key => {
  const k = BY_IDENTITY.get(`${el.querySelector(".mfrom")!.textContent}\u0000${el.querySelector(".msubj")!.textContent}`);
  if (!k) throw new Error("a row the fixtures do not know: " + el.textContent);
  return k;
};
const rowFor = (k: Key): HTMLElement => { const el = rowEls().find((e) => keyOfRow(e) === k); if (!el) throw new Error("no row drawn for " + k); return el; };
const headEls = (): HTMLElement[] => [...document.querySelectorAll(".sh2")] as HTMLElement[];
const heads = () => headEls().map((h) => [h.querySelector(".t")!.textContent, h.querySelector(".n")!.textContent]);
const keysUnder = (head: HTMLElement): Key[] => [...head.nextElementSibling!.querySelectorAll(".erow")].map(keyOfRow);
const sections = () => headEls().map((h) => [h.querySelector(".t")!.textContent, keysUnder(h)] as const);
/** The cards drawn straight under a row, up to the next row. */
const cardsUnder = (el: Element): HTMLElement[] => {
  const out: HTMLElement[] = [];
  for (let n = el.nextElementSibling; n && !n.classList.contains("erow"); n = n.nextElementSibling) if (n.matches(".email-card, .email-receipt-line")) out.push(n as HTMLElement);
  return out;
};
const texts = (root: ParentNode, sel: string): string[] => [...root.querySelectorAll(sel)].map((f) => (f.textContent ?? "").replace(/\u202f/g, " "));
const proposals = (r: Rig) => r.calls.filter((c) => c.fn === "candidate_propose");

// ---- the catalog's DOM check for a facts line, as emailCatalog.test.tsx runs it (a test file cannot be imported without
// re-running its describes, so the rules are written out here) -------------------------------------------------------
const SEPARATOR = /[·•]| - /;
const SMALL = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "per", "the", "to", "with"]);
const isTitleCase = (text: string): boolean => {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.every((w, i) => {
    if (/[@\d$]/.test(w[0] ?? "") || w.includes("@") || w.includes("/")) return true;
    const bare = w.replace(/^[^A-Za-z]+/, "");
    if (!bare) return true;
    if (SMALL.has(bare.toLowerCase()) && i !== 0 && i !== words.length - 1) return bare === bare.toLowerCase();
    return bare[0] === bare[0]!.toUpperCase();
  });
};
const GREY_ROWS = "dd, .row, .email-card, .email-receipt-line, .email-note, .email-head, .email-fresh, .email-cover, .email-waiting-card";
const isGrey = (f: Element): boolean => {
  if (!(f.textContent ?? "").trim()) return false;
  if (["warn", "red", "good", "date", "est", "cat", "st"].some((c) => f.classList.contains(c))) return false;
  const only = f.firstElementChild;
  return !(only && only.tagName === "B" && only.textContent === f.textContent);
};
function catalogViolations(root: ParentNode): string[] {
  const bad: string[] = [];
  for (const line of root.querySelectorAll(".facts, .conn-meta")) {
    const facts = [...line.querySelectorAll(":scope > .fact")];
    if (facts.length === 0 && line.classList.contains("facts")) bad.push("a facts line with no fact in it");
    const coloured = facts.filter((f) => ["warn", "red", "good"].some((t) => f.classList.contains(t)));
    if (coloured.length > 1) bad.push("two coloured facts on one line: " + coloured.map((f) => f.textContent).join(" | "));
  }
  for (const f of root.querySelectorAll(".fact")) {
    const text = (f.textContent ?? "").replace(/\u202f/g, " ");
    if (SEPARATOR.test(text)) bad.push("a separator baked into a fact: " + JSON.stringify(text));
    if (/\b\d{1,2}:\d{2}\b/.test(text) && !/\b(AM|PM)\b/i.test(text)) bad.push("a 24-hour clock in a fact: " + JSON.stringify(text));
    if (!isTitleCase(text)) bad.push("a fact that is not Title Case: " + JSON.stringify(text));
  }
  const greys = new Map<Element, string[]>();
  for (const f of root.querySelectorAll(".fact")) {
    if (!isGrey(f)) continue;
    const owner = f.closest(GREY_ROWS);
    if (owner) greys.set(owner, [...(greys.get(owner) ?? []), f.textContent ?? ""]);
  }
  for (const [, list] of greys) if (list.length > 1) bad.push("more than one grey run on one row: " + list.join(" | "));
  return bad;
}

beforeEach(() => { localStorage.clear(); resetToasts(); Object.defineProperty(navigator, "onLine", { value: true, configurable: true }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.body.classList.remove("selecting"); });

describe("the fixtures are what they claim", () => {
  it("each message has its own identity, and the rules would have read the bill and the promise out of the list's words (so the proof below is not an empty one)", () => {
    expect(BY_IDENTITY.size).toBe(KEYS.length);
    expect(KEYS.length).toBe(24);
    const kinds = (k: Key) => readWithRules(F[k], ZONE).map((p) => p.kind);
    expect(kinds("m1")).toContain("bill");
    expect(kinds("m3")).toContain("receipt");
    expect(kinds("cv1")).toContain("waiting");
  });
});

describe("the grouped home, populated (spec 3.1, 3.2; AC02, AC03, AC04)", () => {
  it("draws every message once, in Conversations, Schedule, Money, Mailing Lists, Other, each with its count, and the name in the section's colour", async () => {
    await mount(rig());
    expect(heads()).toEqual(SECTIONS.map(([name, n]) => [name, n]));
    for (const [name, , keys] of SECTIONS) expect(sections().find(([n]) => n === name)![1].slice().sort()).toEqual(keys.slice().sort());
    // AC02: 24 messages, 24 rows, no row twice, none missing.
    expect(rowEls().length).toBe(24);
    expect(new Set(rowEls().map(keyOfRow)).size).toBe(24);
    // Newest first inside each section (the order the sync cached them).
    for (const [, keys] of sections()) { const times = keys.map((k) => Date.parse(F[k].internal_date)); expect(times).toEqual(times.slice().sort((a, b) => b - a)); }
    const slot = (name: string) => headEls().find((h) => h.querySelector(".t")!.textContent === name)!.querySelector(".email-sec-name")?.className ?? null;
    expect(slot("Conversations")).toContain("cat-fg-purple");
    expect(slot("Schedule")).toContain("cat-fg-sky");
    expect(slot("Money")).toContain("cat-fg-teal");
    expect(slot("Mailing Lists")).toContain("cat-fg-indigo");
    expect(slot("Other")).toBeNull();
  });

  it("a message that qualifies for four sections is in Conversations once, and the other three do not draw it", async () => {
    await mount(rig());
    expect(rowEls().filter((e) => keyOfRow(e) === "all1")).toHaveLength(1);
    expect(sections().find(([n]) => n === "Conversations")![1]).toContain("all1");
    for (const [name, keys] of sections()) if (name !== "Conversations") expect(keys).not.toContain("all1");
  });

  it("words alone never classify: a meeting-and-invoice subject, a lookalike domain, a registered sender's marketing and a refund with no template are Other, and stay visible", async () => {
    await mount(rig());
    const other = sections().find(([n]) => n === "Other")![1];
    for (const k of ["o2", "x1", "x2", "m7"] as const) expect(other).toContain(k);
    expect(screen.getByText("Invoice for the meeting: $40.00 due Friday")).toBeInTheDocument();
    // No card was proposed or drawn for any of them (AC04: no task card or priority inference).
    for (const k of ["o1", "o2", "x1", "x2", "m7"] as const) expect(cardsUnder(rowFor(k))).toEqual([]);
  });

  it("Schedule is calendar structure only: the invites and the .ics are there, and a subject saying Dentist or Meeting is not enough", async () => {
    await mount(rig());
    const schedule = sections().find(([n]) => n === "Schedule")![1];
    expect(schedule.slice().sort()).toEqual(["s1", "s2", "s3", "s4", "s5", "s6"]);
    expect(schedule).not.toContain("o2");
  });

  it("All by Date draws the same 24 messages under days, and Select puts one Select on each of the five sections", async () => {
    await mount(rig());
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect([...document.querySelectorAll(".email-sec-pick")].map((b) => b.closest(".sh2")!.querySelector(".t")!.textContent)).toEqual(SECTIONS.map(([n]) => n));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("tab", { name: "All by Date" }));
    expect(rowEls().length).toBe(24);
    expect(new Set(rowEls().map(keyOfRow)).size).toBe(24);
    for (const h of headEls()) expect(h.querySelector(".t")!.textContent).toMatch(/^(Today|Yesterday|[A-Z][a-z]{2} \d{1,2})$/);
  });

  it("a section a message was moved to on this device draws it there, in time order, and only it moves", async () => {
    recordMove(USER, F.o1, "money", NOW);
    await mount(rig());
    expect(heads()).toEqual([["Conversations", "6 Loaded"], ["Schedule", "6 Loaded"], ["Money", "7 Loaded"], ["Mailing Lists", "1 Loaded"], ["Other", "4 Loaded"]]);
    expect(sections().find(([n]) => n === "Money")![1]).toEqual(["m1", "m2", "m3", "m4", "m5", "m6", "o1"]);
  });

  it("two mailboxes: every row says whose it is; one mailbox: none does", async () => {
    const first = rig();
    await mount(first);
    expect(rowEls().every((e) => !!e.querySelector(".macct"))).toBe(true);
    expect(texts(rowFor("cv3"), ".macct")).toEqual(["work"]);
    expect(texts(rowFor("cv1"), ".macct")).toEqual(["dave"]);
    cleanup();
    const mine = ROWS.filter((r) => r.account_id === "acct-dave");
    await mount(rig({ rows: mine, accounts: JUST_DAVE, cards: first.stored }), { rows: mine });
    expect(document.querySelectorAll(".erow .macct").length).toBe(0);
  });
});

describe("Conversations, populated", () => {
  it("is message-level: the two messages of one thread are two rows that each say how many, and no other row says it", async () => {
    await mount(rig());
    const threaded = rowEls().filter((e) => e.querySelector(".mthread"));
    expect(threaded.map(keyOfRow).sort()).toEqual(["cv1", "cv2"]);
    for (const e of threaded) expect(texts(e, ".mthread")).toEqual(["2 Messages"]);
    // The Conversations count is the number of rows, not the number of threads (spec 3.1: no silent thread collapsing).
    expect(heads()[0]).toEqual(["Conversations", "6 Loaded"]);
  });

  it("draws a very long sender, subject and snippet whole for the stylesheet to clip, and keeps the time and the attachment mark", async () => {
    await mount(rig());
    const long = rowFor("cv3");
    expect(long.querySelector(".mfrom")).toHaveTextContent(LONG_NAME);
    expect(long.querySelector(".msubj")).toHaveTextContent(LONG_SUBJECT);
    expect(long.querySelector(".mwhen")).toBeTruthy();
    expect(long.querySelector(".mclip")).toBeTruthy();
    expect(long.getAttribute("aria-label")).toContain(LONG_NAME);
  });

  it("says (No Subject) and uses the address when a message has neither, and draws no empty snippet", async () => {
    await mount(rig());
    const bare = rowFor("cv5");
    expect(bare.querySelector(".msubj")).toHaveTextContent("(No Subject)");
    expect(bare.querySelector(".mfrom")).toHaveTextContent("noname@example.test");
    expect(bare.querySelector(".msnip")).toBeNull();
  });

  it("shows entities and angle brackets as the words they are, and injects nothing", async () => {
    await mount(rig());
    const e = rowFor("cv4");
    expect(e.querySelector(".mfrom")).toHaveTextContent("Tom & Jerry's");
    expect(e.querySelector(".msubj")!.textContent).toBe('Re: "Q4" <draft> & more');
    expect(e.querySelector(".msnip")!.textContent).toBe('Tom & Jerry\'s "Q4" <draft> is ready & waiting');
    expect(e.querySelector("draft")).toBeNull();
    expect(e.textContent).not.toContain("&amp;");
  });

  it("marks the unread by weight and a dot at the badge, never by a colour", async () => {
    await mount(rig());
    const unread = rowEls().filter((e) => e.querySelector(".munread"));
    expect(unread.map(keyOfRow).sort()).toEqual(["cv1", "m1", "s1"]);
    for (const e of unread) { expect(e.querySelector(".mfrom")).toHaveClass("strong"); expect(e.getAttribute("aria-label")).toMatch(/ · Unread$/); }
    expect(rowFor("cv2").querySelector(".munread")).toBeNull();
  });
});

describe("Schedule, populated", () => {
  it("draws the event cards the server holds with the day in the event's own zone and the clock in 12-hour, and nothing under the invites that have none", async () => {
    await mount(rig());
    const cardOf = (k: Key) => { const c = cardsUnder(rowFor(k)); expect(c).toHaveLength(1); return c[0]!; };
    expect(texts(cardOf("s1"), ".conn-meta .fact")).toEqual(["Oct 6", "2:00 PM to 3:00 PM", "Eastern"]);
    expect(texts(cardOf("s2"), ".conn-meta .fact")).toEqual(["Oct 12", "All Day"]);
    // 10:00 PM Eastern on Oct 6 is Oct 7 in UTC: the day must still be Oct 6, beside the clock it belongs to.
    expect(texts(cardOf("s6"), ".conn-meta .fact")).toEqual(["Oct 6", "10:00 PM to 11:00 PM", "Eastern"]);
    for (const k of ["s3", "s4", "s5"] as const) expect(cardsUnder(rowFor(k))).toEqual([]);
    // Each card names where it lands and what it will do, and says nothing is saved yet.
    expect(texts(cardOf("s1"), ".email-badge")).toEqual(["Schedule", "Not Saved Yet"]);
    expect(cardOf("s1").querySelector(".pill-act")).toHaveTextContent("Add to Schedule");
  });

  it("a canceled or updated invite looks like any other row: the row never guesses from its subject", async () => {
    await mount(rig());
    for (const k of ["s3", "s4"] as const) {
      const e = rowFor(k);
      expect(e.querySelector(".fact")).toBeNull();
      expect(e.querySelector(".pill-act, .row-act")).toBeNull();
    }
  });
});

describe("Money, populated", () => {
  it("is exactly the registered senders and formats: a statement, a bill, two receipts, an invoice and a second statement", async () => {
    await mount(rig());
    const money = sections().find(([n]) => n === "Money")![1];
    expect(money.slice().sort()).toEqual(["m1", "m2", "m3", "m4", "m5", "m6"]);
    expect(heads()[2]).toEqual(["Money", "6 Loaded"]);
  });

  it("a bill an older build read from the list still draws its card, and its amount groups the thousands like the Money tab", async () => {
    await mount(rig());
    const [bill] = cardsUnder(rowFor("m1"));
    expect(bill!.querySelector(".email-card-value")).toHaveTextContent("$1,284.56");
    expect(bill!.querySelector(".email-card-value")!.textContent).not.toBe("$1284.56");
    expect(texts(bill!, ".conn-meta .fact")).toEqual(["Due Oct 15", "Con Edison"]);
    expect(bill!.querySelector(".pill-act")).toHaveTextContent("Save Bill");
  });

  it("the row draws no amount, due date or fact of its own: those are the mail's words, shown as the mail wrote them", async () => {
    await mount(rig());
    for (const e of rowEls()) expect(e.querySelector(".fact, .facts, .conn-meta")).toBeNull();
    expect(rowFor("m1").querySelector(".msnip")).toHaveTextContent("Your bill of $1,284.56 is due on Oct 15, 2026.");
    // A statement with nothing in its snippet draws no empty line for it.
    expect(rowFor("m4").querySelector(".msnip")).toBeNull();
  });
});

describe("the list proposes no bill, receipt, task or waiting card from a row's words (spec 5.2, AC11; Dave 2026-10-13)", () => {
  it("reads all 24 rows and asks the server for nothing but events", async () => {
    const r = rig();
    await mount(r);
    expect(LIST_ROW_KINDS).toEqual(["event"]);
    const made = proposals(r);
    // Whatever the list proposed, it is an event: the bill in Con Edison's snippet and the promise in Maya's are not read.
    expect(made.filter((c) => c.args.p_kind !== "event")).toEqual([]);
    // An event a row's words state outright (Priya confirming the advisor meeting) is still proposed: the list keeps events.
    expect(made.map((c) => [c.args.p_message, c.args.p_kind])).toContainEqual([F.cv2.id, "event"]);
    for (const c of made) expect(c.args.p_origin).toBe("rule");
    // And the bait is real: read directly, the same rows make those cards.
    expect(readWithRules(F.m1, ZONE).map((p) => p.kind)).toContain("bill");
    expect(readWithRules(F.cv1, ZONE).map((p) => p.kind)).toContain("waiting");
  });

  it("draws no card the list could have made from a bill, a receipt, a promise or a request: the cards are the four the server held and the one event", async () => {
    const r = rig();
    await mount(r);
    expect(document.querySelectorAll("[data-candidate]").length).toBe(CARDS_DRAWN);
    expect([...document.querySelectorAll(".email-card")].map((c) => c.className.replace(/\s+/g, " ").trim()).sort()).toEqual(["email-card bill", "email-card event", "email-card event", "email-card event", "email-card event"]);
    // The server holds no bill, receipt, task or waiting card that this read made.
    expect(r.stored.filter((c) => !CARDS.includes(c)).map((c) => c.kind)).toEqual(["event"]);
    // And the cv2 row is where the event draws.
    expect(cardsUnder(rowFor("cv2")).map((c) => c.className)).toEqual([expect.stringContaining("event")]);
  });

  it("a row is read once per version of the list: a second mount reads nothing again", async () => {
    const first = rig();
    await mount(first);
    cleanup();
    // The server kept what the first read proposed; the same rows, the same versions, are not read again.
    const second = rig({ cards: first.stored });
    await mount(second);
    expect(proposals(second)).toEqual([]);
  });
});

describe("the section names wear their slot's colour in both themes", () => {
  // jsdom has no cascade worth trusting for var() and attribute themes, so the cause is held at its source. In dark, Schedule
  // (sky) and Money (teal) drew the heading's grey while Conversations (purple) and Mailing Lists (indigo) kept their colours: the
  // sky and teal slots have only a base rule in components.css, and email.css's `.email-sec-name { color: inherit }` tied it on
  // specificity and won by loading later. Purple and indigo have [data-theme="dark"] rules, which are more specific, so they won.
  const css = (f: string) => readFileSync(join(process.cwd(), "src/styles", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const bodies = (sheet: string, selector: string) => [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1]!.trim().replace(/\s+/g, " ") === selector).map((m) => m[2]!).join(";");

  it("email.css sets no colour on .email-sec-name, so the slot's own ink is never painted over", () => {
    expect(bodies(css("email.css"), ".email-sec-name")).not.toMatch(/(^|;)\s*color\s*:/);
  });

  it("every slot a section uses has an ink to wear: a base rule in components.css, which is dark's colour for the slots with no dark text rule", () => {
    const components = css("components.css");
    for (const slot of Object.values(SECTION_SLOT)) if (slot) expect(bodies(components, `.cat-fg-${slot}`), `.cat-fg-${slot}`).toMatch(new RegExp(`(^|;)\\s*color\\s*:\\s*var\\(--cat-${slot}\\)`));
  });
});

describe("the catalog, on the whole populated home", () => {
  it("passes the facts check on every card and row, in the DOM", async () => {
    await mount(rig());
    expect(catalogViolations(document.body)).toEqual([]);
  });

  it("every number in front of a word is capitalized, and every heading and count is Title Case", async () => {
    await mount(rig());
    expect(numberCaseViolations(document.body)).toEqual([]);
    for (const h of headEls()) {
      expect(isTitleCase(h.querySelector(".t")!.textContent!)).toBe(true);
      expect(h.querySelector(".n")!.textContent).toMatch(/^\d+ Loaded$/);
    }
    for (const t of texts(document.body, ".mthread")) expect(t).toMatch(/^\d+ Messages$/);
  });

  it("every time on a row is a 12-hour clock, Yesterday or a short date", async () => {
    await mount(rig());
    const whens = texts(document.body, ".mwhen");
    expect(whens.length).toBe(24);
    for (const w of whens) expect(w).toMatch(/^(\d{1,2}:\d{2} [AP]M|Yesterday|[A-Z][a-z]{2} \d{1,2})$/);
  });

  it("the words the app writes on a row carry no middle dot, bullet or spaced hyphen: the stylesheet draws the separator", async () => {
    await mount(rig());
    for (const t of texts(document.body, ".erow .mwhen, .erow .macct, .erow .mthread, .email-card .fact, .email-card .email-badge, .sh2 .t, .sh2 .n")) expect(t).not.toMatch(SEPARATOR);
  });

  it("no capsule sits in a row, and no card holds more than one: a wall of pills is not a section", async () => {
    await mount(rig());
    expect(document.querySelectorAll(".erow .pill-act, .erow .row-act, .erow .btn-sm, .erow .quiet-action").length).toBe(0);
    // The one control a row holds is the sender's circle, the door to the contact sheet (issue 112, item 14; spec 2.3: one tap target
    // for detail plus an avatar target for contact). One per row, a circle and never a pill.
    expect(document.querySelectorAll(".erow button:not(.mav)").length).toBe(0);
    expect(document.querySelectorAll(".erow button.mav").length).toBe(document.querySelectorAll(".erow").length);
    for (const c of document.querySelectorAll(".email-card")) expect(c.querySelectorAll(".pill-act").length).toBeLessThanOrEqual(1);
  });
});
