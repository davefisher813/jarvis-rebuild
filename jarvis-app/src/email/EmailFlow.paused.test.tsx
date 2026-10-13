// @vitest-environment jsdom
// THE PAUSED SEND, RESAVED (issue 107, X1; Email Build Spec sections 7 and 9.1, L2, L3, AC17 to AC19, AC25, AC26, AC31, AC32).
// A send that stopped before Gmail (a mailbox that needed reconnecting, a dispatch window that closed) waits on the paused list.
// Opening a row is the way back to its words: released on the server (migration 0069), an editable composer, a FRESH review of the
// exact message, Dave's own tap on Send This Message, and a NEW 30-second hold. Asking him to review and sign again is the
// specified behaviour, not a defect. What these tests hold, against the real screens and the CURRENT composer (the Close and
// Discard work of issue 103 included):
//   - the list is one row per message and has no Send All, and nothing on it sends;
//   - opening a row reopens it on the server, puts its words in the composer byte for byte (the signature once), saves nothing
//     and sends nothing (the composer's refs start trusted, so a reopen is not an edit);
//   - Review Send is a review: it makes the review and posts NOTHING; the one post is Dave's tap on Send This Message, bound to
//     that review's token, asking for a hold, and the screen then says Waiting to Send and Not Sent Yet, never Sent;
//   - an edit after reopening saves at the revision the release left, with the signature still once;
//   - a row that is still the send's (held, sending, sent, unknown) opens its outcome, never a composer that could send twice;
//   - a server without the reopen door still opens the composer and still only ever reviews;
//   - backing out, or discarding, a row you opened sends nothing (the old draft_discard, which cannot release a stopped send,
//     works here because the open already released it).
// NOTHING REAL IS SENT: the database is a recorder that applies the release rule of migration 0069 as written, and fetch is a
// stub that records every call. The send route in it answers like the held route and writes to nothing.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import EmailFlow from "./EmailFlow";
import { CLOSE_DRAFT, DISCARD_DRAFT, HELD_TITLE, NOT_SENT_YET, PAUSED_TITLE, REVIEW_SEND, REVIEW_TITLE, SEND_THIS, SENT_TITLE } from "./copy";
import type { EmailAccount, RpcClient } from "./emailClient";
import type { DraftFields, DraftRow } from "./drafts";
import { subscribeToast, resetToasts } from "../shared/toast";

// The whole Email tab mounts in each case; a loaded machine (the full suite, several runs at once) needs more than the defaults.
vi.setConfig({ testTimeout: 20000 });
const LONG = { timeout: 4000 };

const NOW = new Date("2026-10-13T15:00:00Z");
const DAVE = "dave@example.test";
const SIG = "Dave Fisher\nCoach";
const BODY = "Tuesday works.\n\n-- \n" + SIG;
const account = (o: Partial<EmailAccount> = {}): EmailAccount => ({ id: "acct-dave", address: DAVE, state: "connected", last_sync_at: "2026-10-13T14:50:00Z", sync_error: null, capabilities: { archive: true, trash: true, read: true }, connected_at: "2026-09-01T00:00:00Z", scopes: [], cached: 0, signature_text: SIG, signature_revision: 1, ...o });

type Fn = (a: Record<string, unknown>) => unknown;
interface Opts {
  /** What draft_reopen answers: editable (the default for a stopped send) or not (still the send's). */
  reopenEditable?: boolean;
  /** draft_reopen failing outright (a server that has not got it). */
  reopenError?: string;
  /** The send_state the row is in when the list loads. */
  state?: DraftRow["send_state"];
  /** The account's saved signature when the list loads, when it is not the one the message was written with (it was changed since). */
  savedSignature?: { text: string; revision: number };
}

function rig(o: Opts = {}) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  let seq = 0;
  const paused: DraftRow = {
    id: "d-p", account_id: "acct-dave", account: DAVE, thread_id: "thr-1", to_addresses: ["coach@example.test"], cc_addresses: [], bcc_addresses: [], subject: "Re: Roster", body_text: BODY, attachment_refs: [],
    reply_headers: { in_reply_to: "<m1@example.test>", references: ["<m1@example.test>"], thread_id: "thr-1" }, signature_revision: 1,
    send_state: o.state ?? "sending", saved_at: "2026-10-13T14:00:00Z", revision: 4, updated_at: "2026-10-13T14:30:00Z", sent_action_id: "act-old", provider_message_id: null,
    action_state: "failed", action_verb: "Not Sent · Reconnect Gmail", outbox_state: "failed", error_code: "PROVIDER_AUTH", provider_ack: null,
  };
  const world = { d: paused, reviews: {} as Record<string, { rev: number; action: string }>, discarded: false };
  // Migration 0069's jarvis_draft_release_paused: a 'sending' draft whose outbox row failed or was cancelled, and which never dispatched, is the person's again.
  const release = () => { if (world.d.send_state === "sending" && (world.d.outbox_state === "failed" || world.d.outbox_state === "cancelled")) { world.d = { ...world.d, send_state: "failed" }; return true; } return false; };
  const table: Record<string, Fn> = {
    email_accounts: () => [account(o.savedSignature ? { signature_text: o.savedSignature.text, signature_revision: o.savedSignature.revision } : {})],
    email_inbox: () => ({ rows: [], cached_total: 0, page: 30 }),
    substrate_readiness: () => ({ registered: ["money_bill", "money_receipt", "task", "event", "waiting"] }),
    candidates_for: () => [],
    draft_list: () => ({ drafts: [], sent: [] }),
    // Migration 0068: a send stopped before dispatch, listed while it is 'failed' or still shows as 'sending' with a failed outbox row.
    paused_sends: () => (!world.discarded && (["failed", "sending"].includes(world.d.send_state) || o.reopenEditable === false) ? { count: 1, replies: 1, drafts: [{ ...world.d, paused_reason: "PROVIDER_AUTH", is_reply: true }] } : { count: 0, replies: 0, drafts: [] }),
    draft_reopen: () => {
      if (o.reopenError) return { error: o.reopenError };
      const released = release();
      return { ...world.d, released, editable: o.reopenEditable ?? ["draft", "failed"].includes(world.d.send_state) };
    },
    draft_get: () => world.d,
    draft_save: (a) => {
      release();
      const f = a.p_fields as DraftFields;
      if (["sending", "sent", "unknown"].includes(world.d.send_state)) return { error: "DRAFT_SENT", send_state: world.d.send_state };
      world.d = { ...world.d, ...f, send_state: "draft", sent_action_id: null, revision: world.d.revision + 1 };
      return { draft_id: world.d.id, revision: world.d.revision, saved_at: NOW.toISOString(), send_state: "draft" };
    },
    // The production draft_discard has not got the release step yet (issue 107, comment): it refuses a draft that still reads 'sending'.
    draft_discard: () => {
      if (["sending", "sent", "unknown"].includes(world.d.send_state)) return { error: "DRAFT_SENT", send_state: world.d.send_state };
      world.discarded = true;
      return { draft_id: world.d.id, discarded: true, draft: world.d };
    },
    send_review: () => {
      release();
      if (["sending", "sent"].includes(world.d.send_state)) return { error: "DRAFT_SENT", send_state: world.d.send_state };
      const nonce = `n-${++seq}`; const action = `act-new-${seq}`;
      world.reviews[nonce] = { rev: world.d.revision, action };
      const d = world.d;
      return {
        review: { action_id: action, review_nonce: nonce, payload_hash: "h".repeat(64), expires_at: "2026-10-13T15:05:00Z", outbox_id: "ob-1" },
        exact: { account_id: d.account_id, from_identity: DAVE, to: d.to_addresses, cc: [], bcc: [], subject: d.subject, body_text: d.body_text, attachments: [], reply_headers: d.reply_headers, draft_id: d.id, draft_revision: d.revision, client_message_id: "<x@jarvis.local>" },
        warnings: [], verb: "Sent Reply to coach@example.test", draft_revision: d.revision,
      };
    },
    command_cancel: (a) => ({ action_id: a.p_action, state: "cancelled" }),
    send_hold_status: (a) => ({ action_id: a.p_action, state: "queued", error_code: null, hold_until: "2026-10-13T15:00:30.000Z", dispatch_deadline: "2026-10-13T15:01:00.000Z", server_now: "2026-10-13T15:00:00.000Z", draft_id: null, draft_state: "sending", provider_message_id: null }),
  };
  const client: RpcClient = {
    rpc: async (fn, args) => {
      calls.push({ fn, args: (args ?? {}) as Record<string, unknown> });
      const f = table[fn];
      if (!f) throw new Error("no fake for " + fn);
      return { data: f((args ?? {}) as Record<string, unknown>), error: null };
    },
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    posts.push({ path: url, body });
    if (url.endsWith("/api/email/send")) {
      const rv = world.reviews[String(body.review_nonce)];
      world.d = { ...world.d, send_state: "sending", sent_action_id: rv?.action ?? null, outbox_state: "queued" };
      return { ok: true, status: 200, json: async () => ({ ok: true, held: true, action_id: rv?.action, replay: false, hold_until: "2026-10-13T15:00:30.000Z", dispatch_deadline: "2026-10-13T15:01:00.000Z", server_now: "2026-10-13T15:00:00.000Z", outbox_state: "queued", draft: null }) } as Response;
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
  }));
  return { client, calls, posts, world };
}
type Rig = ReturnType<typeof rig>;
/** Every call to the send route. The only thing in this file that could put mail on the wire is one of these, and each test says how many it expects. */
const sends = (r: Rig) => r.posts.filter((p) => p.path.endsWith("/api/email/send"));
const mount = (r: Rig) => render(<EmailFlow client={r.client} token="jwt" userId="user-1" categories={[]} now={() => NOW} zone="America/New_York" focus={{ kind: "paused" }} focusNonce={1} onOpenConnections={() => {}} onOpenModule={() => {}} />);
const pausedRow = () => document.querySelector('[data-paused="d-p"]') as HTMLElement | null;
const openPaused = async (r: Rig) => {
  mount(r);
  await waitFor(() => expect(pausedRow()).toBeTruthy(), LONG);
  fireEvent.click(pausedRow()!);
};
const composerBody = () => screen.getByLabelText("Message") as HTMLTextAreaElement;
const count = (s: string, sub: string) => s.split(sub).length - 1;

beforeEach(() => {
  localStorage.clear();
  resetToasts();
  subscribeToast(() => {});
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("X1: the paused send, resaved", () => {
  it("the list is one row per message, there is no Send All, and nothing on it posts to the send route", async () => {
    const r = rig();
    mount(r);
    await waitFor(() => expect(pausedRow()).toBeTruthy(), LONG);
    expect(screen.getAllByText(PAUSED_TITLE).length).toBeGreaterThan(0);
    expect(document.querySelectorAll("[data-paused]").length).toBe(1);
    expect(screen.queryByText(/send all/i)).toBeNull();
    expect(sends(r).length).toBe(0);
  });

  it("opening a row reopens it on the server and lands in an editable composer with the words byte for byte, the signature once, and nothing saved or sent", async () => {
    const r = rig();
    await openPaused(r);
    await waitFor(() => expect(screen.getByLabelText("Message")).toBeInTheDocument(), LONG);
    expect(r.calls.filter((c) => c.fn === "draft_reopen").map((c) => c.args.p_draft)).toEqual(["d-p"]);
    const body = composerBody().value;
    expect(body).toBe(BODY);
    expect(count(body, SIG)).toBe(1);
    // AC19: an existing draft is never rewritten, and a signature already in it is not offered again.
    expect(screen.queryByText(/Use Saved Signature/i)).toBeNull();
    expect(r.calls.some((c) => c.fn === "draft_save")).toBe(false);
    expect(sends(r).length).toBe(0);
  });

  it("Review Send is a fresh review of the exact body, approving is Dave's separate tap, the hold is new, and exactly one post is made", async () => {
    const r = rig();
    await openPaused(r);
    await waitFor(() => expect(screen.getByLabelText("Message")).toBeInTheDocument(), LONG);
    fireEvent.click(screen.getByRole("button", { name: REVIEW_SEND }));
    await waitFor(() => expect(screen.getAllByText(REVIEW_TITLE).length).toBeGreaterThan(0), LONG);
    // The words were not edited, so the review is made on the released draft as it stands: no save in between.
    expect(r.calls.filter((c) => c.fn === "send_review").map((c) => c.args)).toEqual([{ p_draft: "d-p", p_expected_revision: 4 }]);
    expect(r.calls.some((c) => c.fn === "draft_save")).toBe(false);
    // The review shows the whole body, signature included, once (L3).
    const review = document.querySelector(".email-review-body") as HTMLElement;
    expect(review.textContent).toBe(BODY);
    expect(count(review.textContent ?? "", SIG)).toBe(1);
    // AC26: reviewing sends nothing, and nothing has been approved yet.
    expect(sends(r).length).toBe(0);
    expect(screen.getByRole("button", { name: SEND_THIS })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: SEND_THIS }));
    await waitFor(() => expect(screen.getAllByText(HELD_TITLE).length).toBeGreaterThan(0), LONG);
    // One post: this review's own token (a fresh one, not the paused attempt's act-old), asking for the 30-second hold (L4).
    expect(sends(r).length).toBe(1);
    expect(sends(r)[0]!.body).toMatchObject({ draft_id: "d-p", review_nonce: "n-1", shown_payload_hash: "h".repeat(64), hold: true });
    expect(sends(r)[0]!.body.request_id).toEqual(expect.any(String));
    // The screen says what is true: held on the server's clock, Not Sent Yet, never Sent.
    expect(screen.getByText(NOT_SENT_YET)).toBeInTheDocument();
    const facts = [...screen.getByRole("timer").querySelectorAll(".fact")].map((f) => f.textContent ?? "");
    expect(facts[0]).toBe(NOT_SENT_YET);
    expect(facts[1]).toMatch(/^(29|30)s$/);
    expect(screen.queryByText(SENT_TITLE)).toBeNull();
    // The signature is still once in the draft the server holds.
    expect(count(r.world.d.body_text, SIG)).toBe(1);
  });

  it("a signature saved since the message was paused does not rewrite it: the words reopen and review as they were, the old signature once (AC18)", async () => {
    const NEW_SIG = "Dave F.\nHead Coach";
    const r = rig({ savedSignature: { text: NEW_SIG, revision: 2 } });
    await openPaused(r);
    await waitFor(() => expect(screen.getByLabelText("Message")).toBeInTheDocument(), LONG);
    const body = composerBody().value;
    expect(body).toBe(BODY);
    expect(body).not.toContain(NEW_SIG);
    expect(count(body, SIG)).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: REVIEW_SEND }));
    await waitFor(() => expect(screen.getAllByText(REVIEW_TITLE).length).toBeGreaterThan(0), LONG);
    expect(document.querySelector(".email-review-body")!.textContent).toBe(BODY);
    expect(r.calls.some((c) => c.fn === "draft_save")).toBe(false);
    expect(sends(r).length).toBe(0);
  });

  it("editing after the reopen saves at the revision the release left and keeps the signature once", async () => {
    const r = rig();
    await openPaused(r);
    await waitFor(() => expect(screen.getByLabelText("Message")).toBeInTheDocument(), LONG);
    fireEvent.change(composerBody(), { target: { value: "Wednesday works.\n\n-- \n" + SIG } });
    fireEvent.click(screen.getByRole("button", { name: REVIEW_SEND }));
    await waitFor(() => expect(screen.getAllByText(REVIEW_TITLE).length).toBeGreaterThan(0), LONG);
    const saves = r.calls.filter((c) => c.fn === "draft_save");
    expect(saves.length).toBe(1);
    expect(saves[0]!.args).toMatchObject({ p_draft: "d-p", p_expected_revision: 4 });
    expect(count((saves[0]!.args.p_fields as DraftFields).body_text, SIG)).toBe(1);
    // The review is made on the revision the save left (5), after it, and nothing was sent by either.
    expect(r.calls.filter((c) => c.fn === "send_review").map((c) => c.args)).toEqual([{ p_draft: "d-p", p_expected_revision: 5 }]);
    expect(r.calls.map((c) => c.fn).indexOf("draft_save")).toBeLessThan(r.calls.map((c) => c.fn).indexOf("send_review"));
    expect(document.querySelector(".email-review-body")!.textContent).toBe("Wednesday works.\n\n-- \n" + SIG);
    expect(sends(r).length).toBe(0);
  });

  it("a row that is still the send's (not editable) opens its outcome, never a composer that could send twice", async () => {
    const r = rig({ reopenEditable: false, state: "unknown" });
    await openPaused(r);
    await waitFor(() => expect(screen.queryByLabelText("Message")).toBeNull(), LONG);
    expect(r.calls.some((c) => c.fn === "draft_reopen")).toBe(true);
    expect(screen.queryByRole("button", { name: REVIEW_SEND })).toBeNull();
    expect(r.calls.some((c) => c.fn === "send_review" || c.fn === "draft_save")).toBe(false);
    expect(sends(r).length).toBe(0);
  });

  it("if the server has no draft_reopen the composer still opens with the listed row, and Review Send only ever reviews", async () => {
    const r = rig({ reopenError: "UNAVAILABLE" });
    await openPaused(r);
    await waitFor(() => expect(screen.getByLabelText("Message")).toBeInTheDocument(), LONG);
    expect(composerBody().value).toBe(BODY);
    fireEvent.click(screen.getByRole("button", { name: REVIEW_SEND }));
    await waitFor(() => expect(r.calls.some((c) => c.fn === "send_review")).toBe(true), LONG);
    await waitFor(() => expect(screen.getAllByText(REVIEW_TITLE).length).toBeGreaterThan(0), LONG);
    expect(sends(r).length).toBe(0);
  });

  // Spec section 7 also names Keep as Draft as an exit for a paused row. It is not built (issue 107, left to Dave's word), so today a
  // row leaves the list by a review that is approved, by an edit that saves, or by Discard; backing out of it untouched leaves it there.
  it("backing out of an opened row without an edit saves nothing, sends nothing, and leaves it on the paused list", async () => {
    const r = rig();
    await openPaused(r);
    await waitFor(() => expect(screen.getByLabelText("Message")).toBeInTheDocument(), LONG);
    fireEvent.click(screen.getByRole("button", { name: CLOSE_DRAFT }));
    await waitFor(() => expect(screen.queryByLabelText("Message")).toBeNull(), LONG);
    await waitFor(() => expect(pausedRow()).toBeTruthy(), LONG);
    expect(r.calls.some((c) => c.fn === "draft_save" || c.fn === "send_review")).toBe(false);
    expect(sends(r).length).toBe(0);
  });

  it("discarding an opened row works (the open already released it) and sends nothing", async () => {
    const r = rig();
    await openPaused(r);
    await waitFor(() => expect(screen.getByLabelText("Message")).toBeInTheDocument(), LONG);
    fireEvent.click(screen.getByRole("button", { name: DISCARD_DRAFT }));
    // The confirm is a sheet whose one action is Discard Draft too.
    const confirm = await screen.findAllByRole("button", { name: DISCARD_DRAFT }, LONG);
    fireEvent.click(confirm[confirm.length - 1]!);
    await waitFor(() => expect(r.calls.some((c) => c.fn === "draft_discard")).toBe(true), LONG);
    expect(r.calls.filter((c) => c.fn === "draft_discard").map((c) => c.args.p_draft)).toEqual(["d-p"]);
    expect(r.world.discarded).toBe(true);
    expect(sends(r).length).toBe(0);
  });
});
