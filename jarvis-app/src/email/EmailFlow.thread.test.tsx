// @vitest-environment jsdom
// THE MESSAGE, THE REPLY AND THE LISTS BEHIND THEM (Dave's rulings, 2026-10-12). Against a fake session, through the
// real screens:
//   6  a confirmed booking is a finish card at the top of the message; one tap approves it through capture_approve;
//      a calendar FILE attached to the message is read through the attachment route and makes the same card; nothing
//      is written until the tap, and nothing RSVPs;
//   7  a reply shows "Answered X of Y" from ONE thread reading, never re-read per keystroke; with AI off, nothing;
//   8  Email's review list holds every counted card, not only the loaded pages; Track This lands in Waiting at once;
//      Today's paused card opens the recovery list and each paused send opens its own draft (no Send All).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import EmailFlow from "./EmailFlow";
import ComposeScreen from "./ComposeScreen";
import { PRIMARY, type Candidate } from "./candidates";
import { emptyFields } from "./drafts";
import { REVIEW_LIST_TITLE, PAUSED_TITLE, REVIEW_OPEN } from "./copy";
import type { EmailAccount, InboxRow, MessageDetail, RpcClient } from "./emailClient";
import type { WaitingItem } from "../substrate/waiting/types";
import type { WaitingService } from "../substrate/waiting/WaitingService";
import type { ThreadBriefAI } from "../messages/threadBrief";
import { setAIControl } from "../ai/levelStore";
import { resetInboxRefreshState } from "../messages/inboxRefresh";
import { resetToasts } from "../shared/toast";

const NOW = new Date("2026-10-12T15:00:00Z");
const USER = "user-1";
const DAVE = "dave@example.test";
const account = (): EmailAccount => ({ id: "acct-dave", address: DAVE, state: "connected", last_sync_at: "2026-10-12T14:50:00Z", sync_error: null, capabilities: { archive: true, trash: true, read: true }, connected_at: "2026-09-01T00:00:00Z", scopes: [], cached: 3, signature_text: "", signature_revision: 1 });
const row = (id: string, iso: string, o: Partial<InboxRow> = {}): InboxRow => ({
  id: `u-${id}`, account_id: "acct-dave", account: DAVE, provider_id: id, thread_id: `t-${id}`, internal_date: iso, from_address: "maya@example.test", from_name: "Maya Chen",
  subject: "Friday planning", snippet: "Hi Dave, I have attached the calendar invite.", has_body: true, attachment_metadata: [], provider_labels: ["INBOX"], source_hash: "sh-" + id, read: true, ...o,
});
const ICS = ["BEGIN:VCALENDAR", "METHOD:REQUEST", "BEGIN:VEVENT", "UID:plan-1@example.test", "SUMMARY:Friday planning", "DTSTART;TZID=America/New_York:20261016T100000", "DTEND;TZID=America/New_York:20261016T103000", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
const b64url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const booking = row("m1", "2026-10-12T10:00:00Z", { from_address: "noreply@opentable.test", from_name: "OpenTable", subject: "Your reservation is confirmed", snippet: "Your reservation at Nobu Downtown is confirmed for October 18, 2026 at 7:30 PM ET." });
const invite = row("m2", "2026-10-12T09:00:00Z", { attachment_metadata: [{ filename: "planning.ics", mime: "text/calendar", attachmentId: "att-1", size: 900 }] });
const plain = row("m3", "2026-10-12T08:00:00Z", { from_address: "coach@example.test", from_name: "Coach Miller", subject: "Roster", snippet: "Here is the roster for the fall." });
const older = row("m9", "2026-08-01T08:00:00Z", { from_address: "billing@conedison.test", from_name: "Con Edison", subject: "Your August bill", snippet: "Amount due: USD 98.10. Due date: October 20, 2026." });
const inbox = [booking, invite, plain];
const detailOf = (r: InboxRow): MessageDetail => ({
  id: r.id, account_id: r.account_id, account: r.account, provider_id: r.provider_id, thread_id: r.thread_id, internal_date: r.internal_date, from_address: r.from_address, from_name: r.from_name,
  to_addresses: [{ address: DAVE, name: "" }], cc_addresses: [], subject: r.subject, snippet: r.snippet, provider_labels: r.provider_labels, read: true, deleted: false, source_hash: r.source_hash,
  attachments: r.attachment_metadata, has_body: true, text: r.snippet, html: null,
});

type Fn = (args: Record<string, unknown>) => unknown;
interface Rig { client: RpcClient; calls: Array<{ fn: string; args: Record<string, unknown> }>; cands: Candidate[]; items: Array<{ id: string; kind: string; data: Record<string, unknown> }>; posts: string[] }

function rig(extra: Partial<Record<string, Fn>> = {}): Rig {
  const all = [...inbox, older];
  const cands: Candidate[] = [];
  const items: Rig["items"] = [];
  const calls: Rig["calls"] = [];
  const posts: string[] = [];
  let seq = 0;
  const table: Record<string, Fn> = {
    email_accounts: () => [account()],
    email_inbox: (a) => ({ rows: inbox.slice(0, a.p_limit as number), cached_total: inbox.length, page: a.p_limit }),
    email_message_read: (a) => { const r = all.find((x) => x.id === a.p_message); return r ? detailOf(r) : { error: "NOT_FOUND" }; },
    substrate_readiness: () => ({ registered: ["money_bill", "money_receipt", "task", "event", "waiting"] }),
    candidates_for: (a) => cands.filter((c) => (a.p_messages as string[]).includes(c.message_id) && c.status !== "dismissed"),
    candidate_review_count: () => ({ count: cands.filter((c) => c.status === "proposed" || c.status === "needs_details").length, messages: 0 }),
    candidate_propose: (a) => {
      const msg = all.find((r) => r.id === a.p_message)!;
      const existing = cands.find((c) => c.message_id === a.p_message && c.kind === a.p_kind && c.fingerprint === a.p_fingerprint);
      if (existing) return { candidate_id: existing.id, revision: existing.revision, status: existing.status, payload_hash: existing.payload_hash, replay: true, stale_marked: 0 };
      const missing = a.p_missing as string[];
      const c: Candidate = {
        id: `cand-${++seq}`, message_id: msg.id, account_id: msg.account_id, kind: a.p_kind as Candidate["kind"], origin: (a.p_origin as Candidate["origin"]) ?? "rule", agent_name: null,
        status: missing.length ? "needs_details" : "proposed", revision: 1, payload: { ...(a.p_payload as object), kind: a.p_kind } as Candidate["payload"], payload_hash: "h" + seq, provenance_by_field: {},
        missing_fields: missing, fingerprint: a.p_fingerprint as string, source_hash: msg.source_hash, message_source_hash: msg.source_hash, destination_id: null, action_id: null, proposal_id: null,
        extractor_version: a.p_extractor_version as string, created_at: NOW.toISOString(), updated_at: NOW.toISOString(), saved_sibling: null,
      };
      cands.push(c);
      return { candidate_id: c.id, revision: 1, status: c.status, payload_hash: c.payload_hash, replay: false, stale_marked: 0 };
    },
    candidate_edit: (a) => {
      const c = cands.find((x) => x.id === a.p_candidate)!;
      c.payload = { ...(a.p_payload as object), kind: c.kind } as Candidate["payload"]; c.payload_hash = "h-edit-" + c.revision; c.missing_fields = a.p_missing as string[]; c.status = c.missing_fields.length ? "needs_details" : "proposed"; c.revision += 1;
      return { candidate_id: c.id, revision: c.revision, payload_hash: c.payload_hash, status: c.status };
    },
    capture_approve: (a) => {
      const c = cands.find((x) => x.id === a.p_candidate)!;
      if (c.revision !== a.p_expected_revision || c.payload_hash !== a.p_shown_payload_hash) return { error: "SOURCE_CHANGED" };
      const prepared = a.p_prepared as { destination_kind: string; data: Record<string, unknown>; exact_effect: string };
      const id = `item-${++seq}`;
      items.push({ id, kind: prepared.destination_kind, data: prepared.data });
      c.status = "saved"; c.destination_id = id; c.action_id = `act-${seq}`;
      return { action_id: c.action_id, state: "confirmed", destination_id: id, receipt_id: "r", safe_message: prepared.exact_effect, item_updated_at: NOW.toISOString(), already: false };
    },
    ...extra,
  };
  const client: RpcClient = { rpc: async (fn, args) => { calls.push({ fn, args: (args ?? {}) as Record<string, unknown> }); const f = table[fn]; if (!f) return { data: null, error: { code: "PGRST202", message: "Could not find the function public." + fn } }; return { data: f((args ?? {}) as Record<string, unknown>), error: null }; } };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    posts.push(url);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const answer = url.endsWith("/api/email/sync") ? { ok: true, synced: 0, removed: 0, next_page: null, complete: true, resynced: false }
      : url.endsWith("/api/email/attachment") ? { filename: "planning.ics", mime: "text/calendar", size: ICS.length, data: b64url(ICS) }
        : url.endsWith("/api/email/message") ? { ok: true, message_id: "x", labels: ["INBOX"], read: true, in_inbox: true, in_trash: false, receipt: null, attachments: 0, op: body.op }
          : { ok: true };
    return { ok: true, status: 200, json: async () => answer } as Response;
  }));
  return { client, calls, cands, items, posts };
}

const mount = (r: Rig, o: Partial<Parameters<typeof EmailFlow>[0]> = {}) => render(<EmailFlow client={r.client} token="jwt" userId={USER} categories={[]} now={() => NOW} zone="America/New_York" onOpenConnections={() => {}} onOpenModule={() => {}} briefAI={null} {...o} />);
const openRow = async (name: RegExp) => {
  const b = await waitFor(() => { const x = screen.getAllByRole("button").find((e) => e.className.includes("mrow") && name.test(e.getAttribute("aria-label") ?? "")); expect(x).toBeTruthy(); return x!; });
  fireEvent.click(b);
};
const sheet = () => document.querySelector(".sheet-scrim > .card") as HTMLElement;

beforeEach(() => { localStorage.clear(); resetToasts(); resetInboxRefreshState(); setAIControl(undefined); Object.defineProperty(navigator, "onLine", { value: true, configurable: true }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setAIControl(undefined); });

describe("ruling 6: a confirmed booking is a one-tap finish card", () => {
  it("draws at the top of the message, above the body, and one tap approves exactly that card once", async () => {
    const r = rig();
    mount(r);
    await openRow(/OpenTable/);
    const finish = await waitFor(() => { const f = sheet().querySelector("[data-finish]") as HTMLElement; expect(f).toBeTruthy(); return f; });
    expect(finish).toHaveTextContent("Reservation at Nobu Downtown");
    const body = sheet().querySelector(".email-body")!;
    expect(finish.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Reading made the card; nothing is on the calendar yet.
    expect(r.items).toEqual([]);
    fireEvent.click(within(finish).getByRole("button", { name: PRIMARY.event }));
    await waitFor(() => expect(r.items).toHaveLength(1));
    expect(r.items[0]).toMatchObject({ kind: "event", data: expect.objectContaining({ title: "Reservation at Nobu Downtown" }) });
    expect(r.calls.filter((c) => c.fn === "capture_approve")).toHaveLength(1);
    // The card does not also draw under the message.
    expect(sheet().querySelectorAll(".email-card.event:not([data-finish])").length).toBe(0);
  });

  it("a calendar file attached to the message is fetched through the attachment route and read for its event; nothing RSVPs", async () => {
    const r = rig();
    mount(r);
    await openRow(/Maya Chen/);
    await waitFor(() => expect(r.posts.some((p) => p.endsWith("/api/email/attachment"))).toBe(true));
    const finish = await waitFor(() => { const f = sheet().querySelector("[data-finish]") as HTMLElement; expect(f).toBeTruthy(); return f; });
    expect(finish).toHaveTextContent("Friday Planning");
    const proposed = r.calls.filter((c) => c.fn === "candidate_propose" && c.args.p_kind === "event" && c.args.p_message === invite.id);
    expect(proposed).toHaveLength(1);
    expect((proposed[0]!.args.p_payload as { external_uid: string }).external_uid).toBe("plan-1@example.test");
    // Nothing was written and no provider call but the read and the download happened.
    expect(r.items).toEqual([]);
    expect(r.posts.filter((p) => !/\/api\/(email\/(sync|message|attachment)|connections\/status)$/.test(p))).toEqual([]);
  });
});

describe("ruling 8: Track This lands in Waiting", () => {
  it("the saved record shows in Waiting at once, even while the list's cached copy has not caught up", async () => {
    const r = rig();
    const saved: Record<string, WaitingItem> = {};
    // The production list answers from the device cache first: it does not have the new record yet.
    const waiting = { list: async () => [], get: async (id: string) => saved[id] ?? null } as unknown as WaitingService;
    const items = r.items;
    const origPush = items.push.bind(items);
    items.push = (...xs) => { for (const x of xs) if (x.kind === "waiting") saved[x.id] = { id: x.id, data: x.data as unknown as WaitingItem["data"] }; return origPush(...xs); };
    mount(r, { waiting });
    await openRow(/Coach Miller/);
    const track = await waitFor(() => { const t = within(sheet()).getAllByText(PRIMARY.waiting)[0]!; return t; });
    fireEvent.click(track);
    const title = await screen.findByLabelText("Title");
    fireEvent.change(title, { target: { value: "Fall Roster" } });
    fireEvent.change(screen.getByLabelText("Waiting For"), { target: { value: "the signed roster" } });
    const save = await waitFor(() => { const b = document.querySelector(".sheet-bar-save") as HTMLElement; expect(b).toHaveTextContent(PRIMARY.waiting); expect(b).not.toHaveClass("dim"); return b; });
    fireEvent.click(save);
    await waitFor(() => expect(r.items.filter((i) => i.kind === "waiting")).toHaveLength(1));
    // Close the message and look at Waiting.
    fireEvent.click(document.querySelector(".sheet-scrim") as HTMLElement);
    fireEvent.click(screen.getByRole("tab", { name: "Waiting" }));
    await waitFor(() => expect(screen.getByText("Fall Roster")).toBeInTheDocument());
    expect(document.querySelector(".email-waiting-chips .chip.active .email-chip-n")).toHaveTextContent("1");
  });
});

describe("ruling 8: the review list in Email holds every counted card", () => {
  it("Today's focus opens the list with the card on mail older than the loaded pages, and the inbox line is its door", async () => {
    const oldCard = { id: "cand-old", message_id: older.id, account_id: "acct-dave", kind: "bill", origin: "rule", agent_name: null, status: "proposed", revision: 1, payload: { kind: "bill", issuer: "Con Edison", amount: { minor_units: 9810, currency: "USD" }, due_date: "2026-10-20", no_due_date_confirmed: false }, payload_hash: "h-old", provenance_by_field: {}, missing_fields: [], fingerprint: "fp-old", source_hash: older.source_hash, message_source_hash: older.source_hash, destination_id: null, action_id: null, proposal_id: null, extractor_version: "x", created_at: NOW.toISOString(), updated_at: NOW.toISOString(), saved_sibling: null } as Candidate;
    const r = rig({ candidates_to_review: () => ({ count: 1, rows: [older], candidates: [oldCard] }) });
    r.cands.push(oldCard);
    const view = mount(r);
    // The count is on the Email surface, with its door.
    const line = await waitFor(() => { const l = document.querySelector("[data-review-count]") as HTMLElement; expect(l).toBeTruthy(); return l; });
    fireEvent.click(within(line).getByRole("button", { name: REVIEW_OPEN }));
    await waitFor(() => expect(screen.getAllByText(REVIEW_LIST_TITLE).length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getAllByRole("button").some((b) => b.className.includes("mrow") && /Con Edison/.test(b.getAttribute("aria-label") ?? ""))).toBe(true));
    expect(document.querySelector('[data-candidate="cand-old"]')).toBeTruthy();
    expect(r.calls.some((c) => c.fn === "candidates_to_review")).toBe(true);
    view.unmount();
    // And the same list from a focus (the Hub, a receipt).
    mount(r, { focus: { kind: "candidates" }, focusNonce: 1 });
    await waitFor(() => expect(document.querySelector('[data-candidate="cand-old"]')).toBeTruthy());
  });
});

describe("V10: Today's paused card opens the recovery list", () => {
  it("lists each paused send with why it stopped, and a tap opens that draft for its own review; there is no Send All", async () => {
    const draft = { ...emptyFields(), id: "d-1", account_id: "acct-dave", account: DAVE, to_addresses: ["coach@example.test"], subject: "Re: Roster", body_text: "Tuesday works.", send_state: "draft", saved_at: NOW.toISOString(), revision: 3, updated_at: NOW.toISOString(), sent_action_id: null, provider_message_id: null, action_state: null, action_verb: null, outbox_state: null, error_code: null, provider_ack: null, paused_reason: "HOLD_EXPIRED", is_reply: true };
    const r = rig({ paused_sends: () => ({ count: 1, replies: 1, drafts: [draft] }) });
    mount(r, { focus: { kind: "paused" }, focusNonce: 1 });
    await waitFor(() => expect(screen.getAllByText(PAUSED_TITLE).length).toBeGreaterThan(0));
    const item = await waitFor(() => { const x = document.querySelector('[data-paused="d-1"]') as HTMLElement; expect(x).toBeTruthy(); return x; });
    expect(item).toHaveTextContent("Held Too Long");
    expect(screen.queryByRole("button", { name: /Send All/i })).toBeNull();
    fireEvent.click(item);
    await waitFor(() => expect(screen.getByLabelText("Subject")).toHaveValue("Re: Roster"));
    expect(r.posts.some((p) => /send/.test(p))).toBe(false);
  });

  it("a send stopped before Gmail but still marked sending (migration 0069): opening releases it, the words are editable, and Review Send reviews it fresh", async () => {
    const base = { ...emptyFields(), id: "d-2", account_id: "acct-dave", account: DAVE, to_addresses: ["coach@example.test"], subject: "Re: Bus", body_text: "Leaving at 7.", saved_at: NOW.toISOString(), revision: 4, updated_at: NOW.toISOString(), sent_action_id: "act-old", provider_message_id: null, action_state: "approved", action_verb: "Sent Reply to coach@example.test", outbox_state: "failed", error_code: "PROVIDER_AUTH", provider_ack: null };
    const stuck = { ...base, send_state: "sending", paused_reason: "PROVIDER_AUTH", is_reply: true };
    const released = { ...base, send_state: "failed", released: true, editable: true };
    const exact = { account_id: "acct-dave", from_identity: DAVE, to: ["coach@example.test"], cc: [], bcc: [], subject: "Re: Bus", body_text: "Leaving at 7.", attachments: [], reply_headers: { in_reply_to: null, references: [], thread_id: null }, draft_id: "d-2", draft_revision: 4, client_message_id: "<d-2.4@jarvis.local>" };
    const r = rig({
      paused_sends: () => ({ count: 1, replies: 1, drafts: [stuck] }),
      draft_reopen: () => released,
      send_review: () => ({ review: { action_id: "act-new", review_nonce: "ab".repeat(32), payload_hash: "cd".repeat(32), expires_at: new Date(NOW.getTime() + 300000).toISOString(), outbox_id: "ob-new" }, exact, warnings: [], verb: "Sent Reply to coach@example.test", draft_revision: 4 }),
    });
    mount(r, { focus: { kind: "paused" }, focusNonce: 1 });
    const item = await waitFor(() => { const x = document.querySelector('[data-paused="d-2"]') as HTMLElement; expect(x).toBeTruthy(); return x; });
    fireEvent.click(item);
    await waitFor(() => expect(screen.getByLabelText("Subject")).toHaveValue("Re: Bus"));
    expect(r.calls.find((c) => c.fn === "draft_reopen")?.args).toEqual({ p_draft: "d-2" });
    expect(screen.queryByText("Already Sent · Nothing Left to Change")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review Send" }));
    await waitFor(() => expect(r.calls.some((c) => c.fn === "send_review")).toBe(true));
    expect(r.calls.find((c) => c.fn === "send_review")?.args).toEqual({ p_draft: "d-2", p_expected_revision: 4 });
    // Nothing was sent: reviewing is not sending; the new hold comes only from its own approval.
    expect(r.posts.some((p) => /send/.test(p))).toBe(false);
  });
});

describe("ruling 7: Answered X of Y in the reply composer", () => {
  const replyStart = () => ({ localKey: "k1", draftId: null, accountId: "acct-dave", revision: null, replyingTo: "Coach Miller",
    fields: { ...emptyFields(), to_addresses: ["coach@example.test"], subject: "Re: Practice", thread_id: "t-p", reply_headers: { in_reply_to: "<p2@example.test>", references: [], thread_id: "t-p" } } });
  const threadClient = (calls: string[]): RpcClient => ({ rpc: async (fn, args) => {
    calls.push(fn);
    if (fn === "thread_messages") return { data: [
      { id: "u-p1", account_id: "acct-dave", account: DAVE, provider_id: "p1", thread_id: "t-p", internal_date: "2026-10-11T10:00:00Z", from_address: DAVE, from_name: "Dave", to_addresses: [], cc_addresses: [], subject: "Practice", snippet: "Hi coach", has_body: true, deleted: false, source_hash: "a", reply_to: "", message_id_header: "<p1@example.test>", references: [] },
      { id: "u-p2", account_id: "acct-dave", account: DAVE, provider_id: "p2", thread_id: "t-p", internal_date: "2026-10-11T12:00:00Z", from_address: "coach@example.test", from_name: "Coach Miller", to_addresses: [], cc_addresses: [], subject: "Re: Practice", snippet: "Which day works, Tuesday or Thursday?", has_body: true, deleted: false, source_hash: "b", reply_to: "", message_id_header: "<p2@example.test>", references: [] },
    ], error: null };
    if (fn === "email_message_read") { const id = (args as { p_message: string }).p_message; return { data: { id, text: id === "u-p2" ? "Which day works, Tuesday or Thursday?" : "Hi coach", snippet: "", html: null, has_body: true }, error: null }; }
    if (fn === "draft_save") return { data: { draft_id: "d-k1", revision: 1, saved_at: NOW.toISOString(), send_state: "draft" }, error: null };
    return { data: null, error: { code: "PGRST202", message: "missing" } };
  } });
  const fakeAI = () => {
    const complete = vi.fn(async () => JSON.stringify({
      summary: "Coach asks which day", replies: ["Tuesday", "Thursday", "Either"],
      replyRequirements: [{ messageId: "u-p2", quote: "Which day works, Tuesday or Thursday?", kind: "question", label: "Which day", match: { kind: "choice", topicTerms: ["day"], choices: ["Tuesday", "Thursday"] } }],
    }));
    return { ai: { available: true, complete } as ThreadBriefAI, complete };
  };
  const compose = (client: RpcClient, ai: ThreadBriefAI | null) => render(
    <ComposeScreen client={client} userId={USER} accounts={[account()]} offline={false} fileStore={null} now={() => NOW} start={replyStart()} onBack={() => {}} onReview={() => {}} onDiscarded={() => {}} briefAI={ai} />,
  );

  it("reads the thread once, then follows the words locally: typing never reads it again, and the line never blocks Review Send", async () => {
    const calls: string[] = [];
    const { ai, complete } = fakeAI();
    compose(threadClient(calls), ai);
    const line = await waitFor(() => { const l = document.querySelector("[data-coverage] .cov-quiet-row") as HTMLElement; expect(l).toBeTruthy(); return l; });
    expect(line).toHaveTextContent("Answered 0 of 1");
    const body = screen.getByLabelText("Message");
    for (const t of ["T", "Tu", "Tuesday", "Tuesday works", "Tuesday works for us."]) fireEvent.change(body, { target: { value: t } });
    await waitFor(() => expect(document.querySelector("[data-coverage] .cov-quiet-row")).toHaveTextContent("Answered 1 of 1"));
    expect(complete).toHaveBeenCalledTimes(1);
    expect(calls.filter((c) => c === "thread_messages")).toHaveLength(1);
    // Quiet: one grey fact, no card and no capsule; the checklist opens under it.
    expect(line.querySelectorAll(".fact").length).toBe(1);
    expect(line.querySelector(".fact")!.className).toBe("fact");
    fireEvent.click(line);
    expect((await screen.findAllByText(/Which day/i)).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Review Send" })).toBeEnabled();
  });

  it("asks for the requirements alone, so a long thread's answer fits; the prompt carries no summary or replies (Alfred, 2026-10-12)", async () => {
    const calls: string[] = [];
    const { ai, complete } = fakeAI();
    compose(threadClient(calls), ai);
    await waitFor(() => expect(document.querySelector("[data-coverage] .cov-quiet-row")).toHaveTextContent("Answered 0 of 1"));
    const prompt = String((complete.mock.calls[0] as unknown as [{ content: string }[]])[0][0]!.content);
    expect(prompt).toContain('{"replyRequirements":[...]}');
    expect(prompt).not.toMatch(/"summary"|"replies"|meetingCandidates/);
  });

  it("a thread with nothing left to answer says so in one quiet line, instead of showing nothing", async () => {
    const calls: string[] = [];
    const complete = vi.fn(async () => JSON.stringify({ replyRequirements: [] }));
    compose(threadClient(calls), { available: true, complete } as ThreadBriefAI);
    await waitFor(() => expect(document.querySelector("[data-coverage] .cov-quiet-row")).toHaveTextContent("Nothing Left to Answer"));
  });

  it("a cut-off answer shows nothing and is not cached, so the next open reads again", async () => {
    const calls: string[] = [];
    const complete = vi.fn(async () => '{"replyRequirements":[{"messageId":"u-p2","quote":"Which day');
    compose(threadClient(calls), { available: true, complete } as ThreadBriefAI);
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    await new Promise((res) => setTimeout(res, 50));
    expect(document.querySelector("[data-coverage] .cov-quiet-row")).toBeNull();
    expect(localStorage.getItem("jarvis.mail.replyneeds.v1") ?? "{}").toBe("{}");
  });

  it("with AI off it shows nothing, says nothing and reads nothing", async () => {
    setAIControl({ level: "off" });
    const calls: string[] = [];
    const { ai, complete } = fakeAI();
    compose(threadClient(calls), ai);
    await new Promise((res) => setTimeout(res, 50));
    expect(document.querySelector("[data-coverage]")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Answered|AI/);
    expect(complete).not.toHaveBeenCalled();
    expect(calls).not.toContain("thread_messages");
  });
});
