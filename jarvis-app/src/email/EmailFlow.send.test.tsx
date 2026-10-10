// @vitest-environment jsdom
// COMPOSE, REVIEW AND SEND, END TO END AGAINST A FAKE SESSION
// (docs/jarvis-unified, slice 07; IMPLEMENTATION-SPEC.md 07.3, 08 E16 to E19,
// E22; 09 M5 to M7; 11; prompt 07 "Verify before completing"). The real
// screens render; the database functions and the two routes are recorders
// with the draft table's own rules. What the tests hold: a draft is saved on
// this device and then on the server by revision; a recipient is required and
// checked; the review shows every recipient including Bcc and the warnings;
// an edit after the review kills it; one tap sends once under repeated taps;
// an expired approval is Review Again, not Send; a failure before dispatch
// offers Review Again; an unknown outcome shuts resend and Check Again
// settles only on a found message; offline sends nothing and queues nothing;
// a reload keeps the latest words; two devices get a choice, never a silent
// loss; Reply carries the message's own headers; Discard has an Undo.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import EmailFlow from "./EmailFlow";
import {
  APPROVAL_SCOPE, BAD_ADDRESS, CHECK_AGAIN, DISCARD_DRAFT, DRAFT_DISCARDED, EMPTY_SUBJECT_WARN, KEEP_THIS_DRAFT, NEEDS_RECIPIENT, NOT_SENT_TITLE, OFFLINE_SEND, RESEND_SHUT, REVIEW_AGAIN,
  REVIEW_EXPIRED, REVIEW_SEND, REVIEW_TITLE, SAVED_HERE, SAVED_LINE, SEND_THIS, SENT_LINE, SENT_TITLE, STILL_UNKNOWN, UNDO, UNKNOWN_TITLE, UNKNOWN_WHY, USE_NEWER_DRAFT, DRAFTS_AND_SENT, THIS_DEVICE,
} from "./copy";
import type { EmailAccount, InboxRow, MessageDetail, RpcClient } from "./emailClient";
import { saveLocalDraft, type DraftFields, type DraftRow } from "./drafts";
import { subscribeToast, resetToasts, type ToastState } from "../shared/toast";
import { HELD_TITLE, HOLD_FIRST_USE, HOLD_WINDOW, UNDO_SEND, UNDONE_LINE } from "./copy";

// Email v1: the 30-second hold is behind the email_hold_v1 flag. Off everywhere except the tests below that turn it on.
const holdFlag = vi.hoisted(() => ({ on: false }));
vi.mock("../substrate/flags", async (orig) => {
  const m = await orig<typeof import("../substrate/flags")>();
  return { ...m, flagOn: (f: string, flags?: ReadonlySet<string>) => (f === "email_hold_v1" ? holdFlag.on : m.flagOn(f as never, flags as never)) };
});

const NOW = new Date("2026-10-03T15:00:00Z");
const USER = "user-1";
const DAVE = "dave@example.test";
const account = (o: Partial<EmailAccount> = {}): EmailAccount => ({ id: "acct-dave", address: DAVE, state: "connected", last_sync_at: "2026-10-03T14:50:00Z", sync_error: null, capabilities: { archive: true, trash: true, read: true }, connected_at: "2026-09-01T00:00:00Z", scopes: [], cached: 2, signature_text: "", signature_revision: 1, ...o });
const row = (id: string, iso: string, o: Partial<InboxRow> = {}): InboxRow => ({
  id: `u-${id}`, account_id: "acct-dave", account: DAVE, provider_id: id, thread_id: `thr-${id}`, internal_date: iso, from_address: "coach@example.test", from_name: "Coach Miller",
  subject: "Peña transcript", snippet: "I'll get it over to you.", has_body: true, attachment_metadata: [], provider_labels: ["INBOX"], source_hash: "sh-1", read: true, ...o,
});
const rows: InboxRow[] = [row("m2", "2026-10-03T13:05:00Z"), row("m3", "2026-10-03T08:00:00Z", { from_address: "wei@example.test", from_name: "Wei Chang", subject: "Expenses", snippet: "Attached." })];
const detailOf = (r: InboxRow): MessageDetail => ({
  id: r.id, account_id: r.account_id, account: r.account, provider_id: r.provider_id, thread_id: r.thread_id, internal_date: r.internal_date, from_address: r.from_address, from_name: r.from_name,
  to_addresses: [{ address: DAVE, name: "" }, ...(r.id === "u-m2" ? [{ address: "parent@example.test", name: "" }] : [])], cc_addresses: [], subject: r.subject, snippet: r.snippet, provider_labels: r.provider_labels, read: true, deleted: false, source_hash: r.source_hash,
  attachments: [], has_body: true, text: r.snippet, html: null, reply_headers: { message_id: `<${r.provider_id}@example.test>`, references: ["<m1@example.test>"], reply_to: "" },
});

type Fn = (args: Record<string, unknown>) => unknown;
interface World { drafts: Record<string, DraftRow>; seq: number; reviews: Record<string, { draft: string; revision: number; hash: string; action: string }>; conflictOnce: DraftRow | null }
interface Rig { client: RpcClient; calls: Array<{ fn: string; args: Record<string, unknown> }>; posts: Array<{ path: string; body: Record<string, unknown> }>; world: World }

const fieldsIn = (a: Record<string, unknown>): DraftFields => a.p_fields as DraftFields;
const rowOf = (id: string, accountId: string, f: DraftFields, revision: number, savedAt: string, o: Partial<DraftRow> = {}): DraftRow => ({
  id, account_id: accountId, account: DAVE, thread_id: f.thread_id, to_addresses: f.to_addresses, cc_addresses: f.cc_addresses, bcc_addresses: f.bcc_addresses, subject: f.subject, body_text: f.body_text, attachment_refs: f.attachment_refs, reply_headers: f.reply_headers, signature_revision: f.signature_revision,
  send_state: "draft", saved_at: savedAt, revision, updated_at: savedAt, sent_action_id: null, provider_message_id: null, action_state: null, action_verb: null, outbox_state: null, error_code: null, provider_ack: null, ...o,
});

function rig(o: { rpc?: Partial<Record<string, Fn>>; send?: (body: Record<string, unknown>, w: World) => { status: number; body: unknown }; reconcile?: (body: Record<string, unknown>, w: World) => { status: number; body: unknown }; expiresAt?: string; conflictOnce?: boolean } = {}): Rig {
  const world: World = { drafts: {}, seq: 0, reviews: {}, conflictOnce: null };
  const calls: Rig["calls"] = [];
  const posts: Rig["posts"] = [];
  const table: Record<string, Fn> = {
    email_accounts: () => [account()],
    email_inbox: (a) => ({ rows: rows.slice(0, a.p_limit as number), cached_total: rows.length, page: a.p_limit }),
    email_message_read: (a) => { const r = rows.find((x) => x.id === a.p_message); return r ? detailOf(r) : { error: "NOT_FOUND" }; },
    substrate_readiness: () => ({ registered: ["money_bill", "money_receipt", "task", "event", "waiting"] }),
    candidates_for: () => [],
    candidate_propose: () => ({ candidate_id: "c-x", revision: 1, status: "proposed", payload_hash: "h", replay: false, stale_marked: 0 }),
    draft_save: (a) => {
      const f = fieldsIn(a);
      if (a.p_draft === null) {
        const id = `d-${++world.seq}`;
        world.drafts[id] = rowOf(id, a.p_account as string, f, 1, NOW.toISOString());
        return { draft_id: id, revision: 1, saved_at: NOW.toISOString(), send_state: "draft" };
      }
      const d = world.drafts[a.p_draft as string];
      if (!d) return { error: "NOT_FOUND" };
      if (d.send_state !== "draft" && d.send_state !== "failed") return { error: "DRAFT_SENT", send_state: d.send_state };
      if (o.conflictOnce && !world.conflictOnce) {
        const server = rowOf(d.id, d.account_id, { ...f, body_text: "Newer words from the other phone." }, d.revision + 1, "2026-10-03T15:01:00Z");
        world.drafts[d.id] = server;
        world.conflictOnce = server;
        return { error: "DRAFT_CONFLICT", revision: server.revision, draft: server };
      }
      if (a.p_expected_revision !== null && a.p_expected_revision !== d.revision) return { error: "DRAFT_CONFLICT", revision: d.revision, draft: d };
      const next = rowOf(d.id, a.p_account as string, f, d.revision + 1, NOW.toISOString());
      world.drafts[d.id] = next;
      return { draft_id: d.id, revision: next.revision, saved_at: next.saved_at, send_state: "draft" };
    },
    draft_get: (a) => world.drafts[a.p_draft as string] ?? { error: "NOT_FOUND" },
    draft_list: () => ({ drafts: Object.values(world.drafts).filter((d) => d.send_state === "draft" || d.send_state === "failed"), sent: Object.values(world.drafts).filter((d) => d.send_state !== "draft" && d.send_state !== "failed") }),
    draft_discard: (a) => { const d = world.drafts[a.p_draft as string]; if (!d) return { error: "NOT_FOUND" }; delete world.drafts[d.id]; return { draft_id: d.id, discarded: true, draft: d }; },
    send_review: (a) => {
      const d = world.drafts[a.p_draft as string];
      if (!d) return { error: "NOT_FOUND" };
      if (d.to_addresses.length === 0) return { error: "MISSING_DETAILS", missing: ["to"] };
      const nonce = `n-${++world.seq}`;
      const hash = "h".repeat(64);
      const action = `act-${world.seq}`;
      world.reviews[nonce] = { draft: d.id, revision: d.revision, hash, action };
      const warnings = [...(d.subject.trim() ? [] : ["empty_subject"]), ...(d.body_text.trim() ? [] : ["empty_body"])];
      return {
        review: { action_id: action, review_nonce: nonce, payload_hash: hash, expires_at: o.expiresAt ?? "2026-10-03T15:05:00Z", outbox_id: `ob-${world.seq}` },
        exact: { account_id: d.account_id, from_identity: DAVE, to: d.to_addresses, cc: d.cc_addresses, bcc: d.bcc_addresses, subject: d.subject, body_text: d.body_text, attachments: d.attachment_refs, reply_headers: d.reply_headers, draft_id: d.id, draft_revision: d.revision, client_message_id: `<${d.id}.${d.revision}@jarvis.local>` },
        warnings, verb: `Sent${d.reply_headers.in_reply_to ? " Reply" : ""} to ${d.to_addresses[0]}`, draft_revision: d.revision,
      };
    },
    command_cancel: (a) => ({ action_id: a.p_action, state: "cancelled" }),
    receipt_detail: (a) => ({ action_id: a.p_action, kind: "send_email", surface: "email", state: "confirmed", verb: "Sent Reply to coach@example.test", actor_kind: "user", actor_id: null, actor_display: "You", approved_by_user: true, destination_id: null, provider_account_id: "acct-dave", created_at: NOW.toISOString(), updated_at: NOW.toISOString(), error_code: null, inside_email: false, undoable: false, item_updated_at: null, outbox: null, receipts: [], evidence: [] }),
    ...o.rpc,
  };
  const client: RpcClient = { rpc: async (fn, args) => { calls.push({ fn, args: (args ?? {}) as Record<string, unknown> }); const f = table[fn]; if (!f) throw new Error("no fake for " + fn); return { data: f((args ?? {}) as Record<string, unknown>), error: null }; } };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    posts.push({ path: url, body });
    let answer: { status: number; body: unknown };
    if (url.endsWith("/api/email/send")) {
      answer = o.send ? o.send(body, world) : (() => {
        const rv = world.reviews[String(body.review_nonce)];
        const d = rv ? world.drafts[rv.draft] : undefined;
        if (!rv || !d) return { status: 409, body: { code: "NOT_FOUND", safe_message: "Item Removed" } };
        if (rv.revision !== d.revision) return { status: 409, body: { code: "REVIEW_CHANGED", safe_message: "Message Changed · Review It Again" } };
        const sentRow: DraftRow = { ...d, send_state: "sent", sent_action_id: rv.action, provider_message_id: "gm-77", action_state: "confirmed", action_verb: `Sent${d.reply_headers.in_reply_to ? " Reply" : ""} to ${d.to_addresses[0]}`, outbox_state: "confirmed", provider_ack: { provider: "gmail", message_id: "gm-77", thread_id: d.thread_id } };
        world.drafts[d.id] = sentRow;
        return { status: 200, body: { ok: true, action_id: rv.action, replay: false, outcome: "confirmed", provider_message_id: "gm-77", draft: sentRow } };
      })();
    } else if (url.endsWith("/api/email/reconcile")) {
      answer = o.reconcile ? o.reconcile(body, world) : { status: 200, body: { ok: true, state: "outcome_unknown", found: false } };
    } else if (url.endsWith("/api/email/sync")) answer = { status: 200, body: { ok: true, synced: 0, removed: 0, next_page: null, complete: true, resynced: false } };
    else if (url.endsWith("/api/email/message")) answer = { status: 200, body: { ok: true, message_id: "x", labels: ["INBOX"], read: true, in_inbox: true, in_trash: false, receipt: null, attachments: 0 } };
    else answer = { status: 200, body: { ok: true } };
    return { ok: answer.status < 300, status: answer.status, json: async () => answer.body } as Response;
  }));
  return { client, calls, posts, world };
}

const mount = (r: Rig) => render(<EmailFlow client={r.client} token="jwt" userId={USER} categories={[]} now={() => NOW} zone="America/New_York" onOpenConnections={() => {}} onOpenModule={() => {}} />);
const byRole = (name: string) => screen.getByRole("button", { name });
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const sendsPosted = (r: Rig) => r.posts.filter((p) => p.path.endsWith("/api/email/send"));
const openCompose = async (r: Rig) => {
  mount(r);
  await waitFor(() => expect(byRole("Compose")).toBeInTheDocument());
  fireEvent.click(byRole("Compose"));
  await waitFor(() => expect(screen.getByLabelText("To")).toBeInTheDocument());
};
const writeAndReview = async (r: Rig, o: { to?: string; bcc?: string; subject?: string; body?: string } = {}) => {
  type("To", o.to ?? "Coach@Example.TEST");
  if (o.bcc) { fireEvent.click(screen.getByText("Cc / Bcc")); type("Bcc", o.bcc); }
  type("Subject", o.subject ?? "Re: Transcript");
  type("Message", o.body ?? "On it. Sending tonight.");
  fireEvent.click(byRole(REVIEW_SEND));
  await waitFor(() => expect(screen.getAllByText(REVIEW_TITLE).length).toBeGreaterThan(0), { timeout: 4000 });
  return r.calls.filter((c) => c.fn === "send_review");
};

let toasts: ToastState[] = [];
let unsub = () => {};
beforeEach(() => { localStorage.clear(); resetToasts(); toasts = []; unsub = subscribeToast((t) => { if (t) toasts.push(t); }); Object.defineProperty(navigator, "onLine", { value: true, configurable: true }); });
afterEach(() => { unsub(); cleanup(); vi.unstubAllGlobals(); });

describe("E16: the draft is saved here, then on the server by revision", () => {
  it("typing saves on this device after a pause and on the server after a longer one; the words carry the account", async () => {
    const r = rig();
    await openCompose(r);
    type("To", "coach@example.test");
    type("Subject", "Hello");
    type("Message", "A first line");
    await waitFor(() => expect(screen.getByText(SAVED_HERE)).toBeInTheDocument(), { timeout: 2000 });
    await waitFor(() => expect(r.calls.filter((c) => c.fn === "draft_save").length).toBeGreaterThan(0), { timeout: 3000 });
    const save = r.calls.find((c) => c.fn === "draft_save")!.args;
    expect(save).toMatchObject({ p_draft: null, p_account: "acct-dave" });
    expect(fieldsIn(save)).toMatchObject({ subject: "Hello", body_text: "A first line" });
    await waitFor(() => expect(screen.getByText(SAVED_LINE)).toBeInTheDocument(), { timeout: 2000 });
    expect(sendsPosted(r)).toEqual([]);
    expect(r.calls.filter((c) => c.fn === "send_review")).toEqual([]);
  });

  it("a recipient is required and checked before any review; the server is not asked", async () => {
    const r = rig();
    await openCompose(r);
    type("Subject", "Hi");
    fireEvent.click(byRole(REVIEW_SEND));
    expect(await screen.findByText(NEEDS_RECIPIENT)).toBeInTheDocument();
    type("To", "not an address");
    fireEvent.click(byRole(REVIEW_SEND));
    expect(await screen.findByText(BAD_ADDRESS)).toBeInTheDocument();
    expect(r.calls.filter((c) => c.fn === "send_review")).toEqual([]);
  });

  it("Close keeps an inert draft; Discard Draft removes it with an Undo that saves the same words again", async () => {
    const r = rig();
    await openCompose(r);
    type("To", "coach@example.test");
    type("Subject", "Keep me");
    await waitFor(() => expect(Object.keys(r.world.drafts).length).toBe(1), { timeout: 3000 });
    fireEvent.click(byRole(DISCARD_DRAFT));
    await waitFor(() => expect(Object.keys(r.world.drafts).length).toBe(0));
    const t = toasts.find((x) => x.message === DRAFT_DISCARDED)!;
    expect(t.actionLabel).toBe(UNDO);
    t.onAction!();
    await waitFor(() => expect(Object.values(r.world.drafts).map((d) => d.subject)).toEqual(["Keep me"]));
  });
});

describe("E18: the review binds everything; one tap sends once", () => {
  it("the review shows From, To, Bcc, the subject, the whole body and the scope line; the server was asked with the saved revision", async () => {
    const r = rig();
    await openCompose(r);
    const reviews = await writeAndReview(r, { bcc: "me@example.test" });
    expect(reviews.length).toBe(1);
    const d = Object.values(r.world.drafts)[0]!;
    expect(reviews[0]!.args).toEqual({ p_draft: d.id, p_expected_revision: d.revision });
    expect(screen.getByText("Bcc").nextElementSibling).toHaveTextContent("me@example.test");
    expect(screen.getByText("From").nextElementSibling).toHaveTextContent(DAVE);
    expect(screen.getByText("To").nextElementSibling).toHaveTextContent("Coach@Example.TEST");
    expect(screen.getByText("On it. Sending tonight.")).toBeInTheDocument();
    expect(screen.getByText(APPROVAL_SCOPE)).toBeInTheDocument();
    expect(byRole(SEND_THIS)).toBeEnabled();
    expect(sendsPosted(r)).toEqual([]);
  });

  it("an empty subject is a warning on the review, never filled in", async () => {
    const r = rig();
    await openCompose(r);
    await writeAndReview(r, { subject: "" });
    expect(screen.getByText(EMPTY_SUBJECT_WARN)).toBeInTheDocument();
  });

  it("Send This Message posts the review's nonce and hash with one request id; two fast taps are one post; the outcome is Sent with the receipt's words", async () => {
    const r = rig();
    await openCompose(r);
    await writeAndReview(r);
    const btn = byRole(SEND_THIS);
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getAllByText(SENT_TITLE).length).toBeGreaterThan(0), { timeout: 3000 });
    const posted = sendsPosted(r);
    expect(posted.length).toBe(1);
    const d = Object.values(r.world.drafts)[0]!;
    expect(posted[0]!.body).toMatchObject({ draft_id: d.id, shown_payload_hash: "h".repeat(64) });
    expect(String(posted[0]!.body.review_nonce)).toMatch(/^n-/);
    expect(String(posted[0]!.body.request_id).length).toBeGreaterThan(8);
    // 2026-10-05: SENT_LINE is two facts, the first green, the dot the stylesheet's.
    expect(screen.getByText(SENT_LINE.split(" \u00B7 ")[0]!)).toHaveClass("fact", "good");
    expect(screen.getByText(SENT_LINE.split(" \u00B7 ")[1]!)).toHaveClass("fact");
    expect(toasts.some((t) => t.message === "Sent to Coach@Example.TEST")).toBe(true);
    expect(d.send_state).toBe("sent");
  });

  it("Edit after the review cancels it and the next Review Send is a new review of the new words", async () => {
    const r = rig();
    await openCompose(r);
    await writeAndReview(r);
    fireEvent.click(byRole("Edit Message"));
    await waitFor(() => expect(screen.getByLabelText("Message")).toBeInTheDocument());
    expect(r.calls.filter((c) => c.fn === "command_cancel").length).toBe(1);
    type("Message", "Changed my mind.");
    await waitFor(() => expect(Object.values(r.world.drafts)[0]!.body_text).toBe("Changed my mind."), { timeout: 3000 });
    fireEvent.click(byRole(REVIEW_SEND));
    await waitFor(() => expect(r.calls.filter((c) => c.fn === "send_review").length).toBe(2), { timeout: 3000 });
    expect(screen.getByText("Changed my mind.")).toBeInTheDocument();
  });

  it("an expired approval is Review Again, not Send, and nothing is posted", async () => {
    const r = rig({ expiresAt: "2026-10-03T14:59:00Z" });
    await openCompose(r);
    await writeAndReview(r);
    expect(screen.getByText(REVIEW_EXPIRED)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: SEND_THIS })).toBeNull();
    fireEvent.click(byRole(REVIEW_AGAIN));
    await waitFor(() => expect(screen.getByLabelText("Message")).toBeInTheDocument());
    expect(sendsPosted(r)).toEqual([]);
  });

  it("the server refusing the tap (edited elsewhere after the review) is said on the review with Review Again, and the draft is intact", async () => {
    const r = rig({ send: () => ({ status: 409, body: { code: "REVIEW_CHANGED", safe_message: "Message Changed · Review It Again" } }) });
    await openCompose(r);
    await writeAndReview(r);
    fireEvent.click(byRole(SEND_THIS));
    expect(await screen.findByText("Message Changed · Review It Again")).toBeInTheDocument();
    expect(byRole(REVIEW_AGAIN)).toBeInTheDocument();
    expect(Object.values(r.world.drafts)[0]!.send_state).toBe("draft");
  });
});

describe("M7: the outcomes", () => {
  it("a failure before dispatch is Not Sent with the reason and Review Again, which opens the same draft", async () => {
    const r = rig({ send: (body, w) => { const d = Object.values(w.drafts)[0]!; const failed: DraftRow = { ...d, send_state: "failed", sent_action_id: "act-9", action_state: "failed", action_verb: "Not Sent · Reconnect Gmail", error_code: "PROVIDER_AUTH", outbox_state: "failed" }; w.drafts[d.id] = failed; return { status: 200, body: { ok: true, action_id: "act-9", replay: false, outcome: "failed", provider_message_id: null, draft: failed } }; } });
    await openCompose(r);
    await writeAndReview(r);
    fireEvent.click(byRole(SEND_THIS));
    await waitFor(() => expect(screen.getAllByText(NOT_SENT_TITLE).length).toBeGreaterThan(0), { timeout: 3000 });
    expect(screen.getByText("Not Sent · Reconnect Gmail")).toBeInTheDocument();
    fireEvent.click(byRole(REVIEW_AGAIN));
    await waitFor(() => expect(screen.getByLabelText("Message")).toHaveValue("On it. Sending tonight."));
    expect(sendsPosted(r).length).toBe(1);
  });

  it("an unknown outcome shuts resend; Check Again settles only when Gmail has the message", async () => {
    let found = false;
    const r = rig({
      send: (body, w) => { const d = Object.values(w.drafts)[0]!; const unknown: DraftRow = { ...d, send_state: "unknown", sent_action_id: "act-7", action_state: "outcome_unknown", action_verb: "Sent to Coach@Example.TEST", error_code: "OUTCOME_UNKNOWN", outbox_state: "outcome_unknown" }; w.drafts[d.id] = unknown; return { status: 200, body: { ok: true, action_id: "act-7", replay: false, outcome: "outcome_unknown", provider_message_id: null, draft: unknown } }; },
      reconcile: (body, w) => { if (!found) return { status: 200, body: { ok: true, state: "outcome_unknown", found: false } }; const d = Object.values(w.drafts)[0]!; const sent: DraftRow = { ...d, send_state: "sent", provider_message_id: "gm-91", action_state: "confirmed", outbox_state: "confirmed", provider_ack: { provider: "gmail", message_id: "gm-91" } }; w.drafts[d.id] = sent; return { status: 200, body: { ok: true, state: "confirmed", found: true, provider_message_id: "gm-91", draft: sent } }; },
    });
    await openCompose(r);
    await writeAndReview(r);
    fireEvent.click(byRole(SEND_THIS));
    await waitFor(() => expect(screen.getAllByText(UNKNOWN_TITLE).length).toBeGreaterThan(0), { timeout: 3000 });
    expect(screen.getByText(UNKNOWN_WHY.split(" \u00B7 ")[0]!)).toHaveClass("fact", "warn");
    expect(screen.getByText(UNKNOWN_WHY.split(" \u00B7 ")[1]!)).toHaveClass("fact");
    expect(byRole(RESEND_SHUT)).toBeDisabled();
    expect(screen.queryByRole("button", { name: SEND_THIS })).toBeNull();
    fireEvent.click(byRole(CHECK_AGAIN));
    expect(await screen.findByText(STILL_UNKNOWN)).toBeInTheDocument();
    expect(r.posts.filter((p) => p.path.endsWith("/api/email/reconcile")).length).toBe(1);
    expect(r.posts.filter((p) => p.path.endsWith("/api/email/reconcile"))[0]!.body).toEqual({ action_id: "act-7" });
    found = true;
    fireEvent.click(byRole(CHECK_AGAIN));
    await waitFor(() => expect(screen.getAllByText(SENT_TITLE).length).toBeGreaterThan(0));
    expect(sendsPosted(r).length).toBe(1);
  });
});

describe("E22: offline sends nothing and queues nothing", () => {
  it("Review Send is shut offline with the line, the words stay on this device, and no route is called", async () => {
    const r = rig();
    await openCompose(r);
    type("To", "coach@example.test");
    type("Message", "Written in the air");
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    window.dispatchEvent(new Event("offline"));
    await waitFor(() => expect(byRole(REVIEW_SEND)).toBeDisabled());
    expect(screen.getAllByText(OFFLINE_SEND).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText(SAVED_HERE)).toBeInTheDocument(), { timeout: 2000 });
    expect(sendsPosted(r)).toEqual([]);
    expect(r.calls.filter((c) => c.fn === "send_review")).toEqual([]);
  });
});

describe("E16, 11: a reload keeps the latest words; two devices get a choice", () => {
  it("a draft saved on this device and never on the server is listed under Drafts as On This Device and opens with its words", async () => {
    saveLocalDraft(USER, { key: "local:abc", draft_id: null, account_id: "acct-dave", fields: { thread_id: null, to_addresses: ["coach@example.test"], cc_addresses: [], bcc_addresses: [], subject: "Before the reload", body_text: "Half a sentence", attachment_refs: [], reply_headers: { in_reply_to: null, references: [], thread_id: null }, signature_revision: null }, revision: null, saved_at: "2026-10-03T14:58:00Z", server_saved_at: null });
    const r = rig();
    mount(r);
    await waitFor(() => expect(screen.getByText(/Checked Today/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Checked Today/));
    fireEvent.click(await screen.findByText(DRAFTS_AND_SENT));
    expect(await screen.findByText("Before the reload")).toBeInTheDocument();
    expect(screen.getByText(THIS_DEVICE)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Before the reload"));
    await waitFor(() => expect(screen.getByLabelText("Message")).toHaveValue("Half a sentence"));
  });

  it("a save at a revision that moved on shows both copies; Use Newer Draft takes the server's; Keep This Draft saves this device's at the new revision", async () => {
    const r = rig({ conflictOnce: true });
    await openCompose(r);
    type("To", "coach@example.test");
    type("Subject", "Conflict");
    type("Message", "These words");
    await waitFor(() => expect(Object.keys(r.world.drafts).length).toBe(1), { timeout: 3000 });
    type("Message", "These words, edited here");
    expect(await screen.findByText(USE_NEWER_DRAFT, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText(/Newer words from the other phone/)).toBeInTheDocument();
    expect(screen.getAllByText(/These words, edited here/).length).toBeGreaterThan(0);
    fireEvent.click(byRole(KEEP_THIS_DRAFT));
    await waitFor(() => expect(Object.values(r.world.drafts)[0]!.body_text).toBe("These words, edited here"));
    const keep = r.calls.filter((c) => c.fn === "draft_save").at(-1)!.args;
    expect(keep.p_expected_revision).toBeNull();
    expect(screen.queryByText(USE_NEWER_DRAFT)).toBeNull();
  });
});

describe("E17: Reply carries the message's own headers", () => {
  it("Reply answers the sender with Re:, the thread and the ids; Reply All keeps the other recipient; the review names it a reply", async () => {
    const r = rig();
    mount(r);
    await waitFor(() => expect(screen.getAllByRole("button").some((b) => b.className.includes("mrow"))).toBe(true));
    fireEvent.click(screen.getAllByRole("button").find((b) => b.className.includes("mrow"))!);
    await waitFor(() => expect(byRole("Reply")).toBeInTheDocument());
    expect(byRole("Reply All")).toBeInTheDocument();
    fireEvent.click(byRole("Reply All"));
    await waitFor(() => expect(screen.getByLabelText("To")).toHaveValue("coach@example.test"));
    expect(screen.getByLabelText("Subject")).toHaveValue("Re: Peña transcript");
    expect(screen.getByLabelText("Cc")).toHaveValue("parent@example.test");
    type("Message", "On it.");
    fireEvent.click(byRole(REVIEW_SEND));
    await waitFor(() => expect(screen.getAllByText(REVIEW_TITLE).length).toBeGreaterThan(0), { timeout: 4000 });
    const d = Object.values(r.world.drafts)[0]!;
    expect(d.reply_headers).toEqual({ in_reply_to: "<m2@example.test>", references: ["<m1@example.test>", "<m2@example.test>"], thread_id: "thr-m2" });
    expect(d.thread_id).toBe("thr-m2");
    expect(d.bcc_addresses).toEqual([]);
    expect(within(screen.getByText("Cc").nextElementSibling as HTMLElement).getByText("parent@example.test")).toBeInTheDocument();
  });

  it("a message with nobody else on it offers Reply but not Reply All", async () => {
    const r = rig();
    mount(r);
    await waitFor(() => expect(screen.getAllByRole("button").filter((b) => b.className.includes("mrow")).length).toBe(2));
    fireEvent.click(screen.getAllByRole("button").filter((b) => b.className.includes("mrow"))[1]!);
    await waitFor(() => expect(byRole("Reply")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Reply All" })).toBeNull();
  });
});

describe("Email v1: the 30-second hold (flag on)", () => {
  afterEach(() => { holdFlag.on = false; });
  const heldAnswer = (action: string) => ({ ok: true, held: true, action_id: action, replay: false, hold_until: "2026-10-03T15:00:30.000Z", dispatch_deadline: "2026-10-03T15:01:00.000Z", server_now: "2026-10-03T15:00:00.000Z", outbox_state: "queued", draft: null });

  it("the tap asks for the hold; the answer is Waiting to Send with Not Sent Yet, nothing sent; Undo brings the draft back", async () => {
    holdFlag.on = true;
    let cancelled = false;
    const r = rig({
      send: (body, w) => { const rv = w.reviews[String(body.review_nonce)]!; w.drafts[rv.draft] = { ...w.drafts[rv.draft]!, send_state: "sending", sent_action_id: rv.action }; return { status: 200, body: heldAnswer(rv.action) }; },
      rpc: {
        send_hold_status: (a) => ({ action_id: a.p_action, state: cancelled ? "cancelled" : "queued", error_code: cancelled ? "CANCELLED" : null, hold_until: "2026-10-03T15:00:30.000Z", dispatch_deadline: "2026-10-03T15:01:00.000Z", server_now: "2026-10-03T15:00:00.000Z", draft_id: null, draft_state: cancelled ? "draft" : "sending", provider_message_id: null }),
        command_cancel: (a) => { cancelled = true; for (const d of Object.values(r.world.drafts)) if (d.sent_action_id === a.p_action) Object.assign(d, { send_state: "draft", sent_action_id: null }); return { action_id: a.p_action, state: "cancelled" }; },
      },
    });
    await openCompose(r);
    await writeAndReview(r);
    // The first review says the whole promise.
    expect(screen.getByText(HOLD_FIRST_USE)).toBeInTheDocument();
    fireEvent.click(byRole(SEND_THIS));
    await waitFor(() => expect(screen.getAllByText(HELD_TITLE).length).toBeGreaterThan(0), { timeout: 4000 });
    expect(sendsPosted(r)[0]!.body).toMatchObject({ hold: true });
    expect(screen.getByText("Not Sent Yet")).toBeInTheDocument();
    expect(screen.getByText("30s")).toBeInTheDocument();
    // Nothing came back from Gmail: no outcome screen, no Sent.
    expect(screen.queryByText(SENT_TITLE)).toBeNull();
    fireEvent.click(byRole(UNDO_SEND));
    await waitFor(() => expect(r.calls.some((c) => c.fn === "command_cancel" && c.args.p_action !== undefined)).toBe(true));
    await waitFor(() => expect(screen.getByLabelText("To")).toBeInTheDocument(), { timeout: 4000 });
    expect(toasts.some((t) => t.message === UNDONE_LINE)).toBe(true);
    expect((screen.getByLabelText("Subject") as HTMLInputElement).value).toBe("Re: Transcript");
  });

  it("the reminder after the first time is the short one", async () => {
    holdFlag.on = true;
    localStorage.setItem("jarvis.email.holdSeen", "1");
    const r = rig();
    await openCompose(r);
    await writeAndReview(r);
    expect(screen.getByText(HOLD_WINDOW)).toBeInTheDocument();
    expect(screen.queryByText(HOLD_FIRST_USE)).toBeNull();
  });

  it("with the flag off the tap does not ask for a hold and the review says nothing about one", async () => {
    const r = rig();
    await openCompose(r);
    await writeAndReview(r);
    expect(screen.queryByText(HOLD_FIRST_USE)).toBeNull();
    expect(screen.queryByText(HOLD_WINDOW)).toBeNull();
    fireEvent.click(byRole(SEND_THIS));
    await waitFor(() => expect(screen.getAllByText(SENT_TITLE).length).toBeGreaterThan(0), { timeout: 4000 });
    expect(sendsPosted(r)[0]!.body).not.toHaveProperty("hold");
  });
});
