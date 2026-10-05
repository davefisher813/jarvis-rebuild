// @vitest-environment jsdom
// WAITING, END TO END AGAINST A FAKE SESSION AND THE REAL STORE
// (docs/jarvis-unified, slice 08; IMPLEMENTATION-SPEC.md 08 E12 to E14, 09 M4,
// 12, 13; prompt 08 "Verify before completing"). The real screens render;
// the Waiting records live in the core Store (in memory); the database
// functions are recorders with 0051's own rules. What the tests hold: Track
// then Waiting then Resolve then Reopen, each one record and one receipt,
// nothing sent; a follow-up date creates no task and no event; deleted
// evidence keeps its excerpt and says so; an incoming reply is New Reply and
// never a closure; Draft Follow-Up opens the composer to the thread's real
// address, threaded, or asks which; the Today focus lands on the right place.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Store, InMemoryAdapter, type ItemData } from "@core";
import EmailFlow from "./EmailFlow";
import { WaitingService } from "../substrate/waiting/WaitingService";
import { TasksService } from "../tasks/TasksService";
import { ScheduleService } from "../schedule/ScheduleService";
import { CLEAR_DATE, DRAFT_FOLLOW_UP, FOLLOW_UP_DATE, NEW_REPLY, PICK_RECIPIENT, REOPEN, RESOLVE, REVIEW_FILTER, REVIEW_REPLY, SHOW_ALL_ROWS, SOURCE_DELETED } from "./copy";
import type { EmailAccount, InboxRow, MessageDetail, RpcClient } from "./emailClient";
import type { WaitingData } from "../substrate/waiting/types";
import { subscribeToast, resetToasts, type ToastState } from "../shared/toast";

const NOW = new Date("2026-10-03T15:00:00Z");
const USER = "user-1";
const DAVE = "dave@example.test";
const account = (): EmailAccount => ({ id: "acct-dave", address: DAVE, state: "connected", last_sync_at: "2026-10-03T14:50:00Z", sync_error: null, capabilities: { archive: true, trash: true, read: true }, connected_at: "2026-09-01T00:00:00Z", scopes: [], cached: 2 });
const row = (id: string, iso: string, o: Partial<InboxRow> = {}): InboxRow => ({
  id: `u-${id}`, account_id: "acct-dave", account: DAVE, provider_id: id, thread_id: "t-a2", internal_date: iso, from_address: "coach@example.test", from_name: "Coach Miller",
  subject: "Re: Peña transcript", snippet: "I'll get Peña's transcript over to you once the school sends it to me.", has_body: true, attachment_metadata: [], provider_labels: ["INBOX"], source_hash: "sh-1", read: true, ...o,
});
const rows: InboxRow[] = [row("m2", "2026-10-02T15:05:00Z")];
const detailOf = (r: InboxRow): MessageDetail => ({
  id: r.id, account_id: r.account_id, account: r.account, provider_id: r.provider_id, thread_id: r.thread_id, internal_date: r.internal_date, from_address: r.from_address, from_name: r.from_name,
  to_addresses: [{ address: DAVE, name: "" }], cc_addresses: [], subject: r.subject, snippet: r.snippet, provider_labels: r.provider_labels, read: true, deleted: false, source_hash: r.source_hash,
  attachments: [], has_body: true, text: r.snippet, html: null, reply_headers: { message_id: "<m2@example.test>", references: [], reply_to: "" },
});

type Fn = (args: Record<string, unknown>) => unknown;
interface World { store: Store; waiting: WaitingService; tasks: TasksService; schedule: ScheduleService; actions: Array<{ kind: string; item: string; verb: string }>; threads: Record<string, Array<Record<string, unknown>>>; evidence: Record<string, Record<string, unknown>> }
interface Rig { client: RpcClient; calls: Array<{ fn: string; args: Record<string, unknown> }>; world: World; posts: string[] }

const openItem = (o: Partial<WaitingData> = {}): WaitingData => ({ title: "Peña's Transcript", waitingFor: "the transcript", counterpartyDisplay: "Coach Miller", status: "open", startedAt: "2026-10-02T15:10:00Z", threadId: "t-a2", account: DAVE, sourceEvidenceId: "ev-1", ...o });

function rig(o: { reply?: boolean; evidenceDeleted?: boolean; secondSender?: boolean } = {}): Rig {
  const store = new Store(new InMemoryAdapter());
  const world: World = {
    store, waiting: new WaitingService(store, USER), tasks: new TasksService(store, USER), schedule: new ScheduleService(store, USER), actions: [],
    threads: { "t-a2": [
      ...(o.reply ? [{ id: "u-m9", account_id: "acct-dave", account: DAVE, provider_id: "m9", thread_id: "t-a2", internal_date: "2026-10-03T14:00:00Z", from_address: "coach@example.test", from_name: "Coach Miller", to_addresses: [], cc_addresses: [], subject: "Re: Peña transcript", snippet: "Sent it this morning.", has_body: true, deleted: false, source_hash: "sh-9", reply_to: "", message_id_header: "<m9@example.test>", references: ["<m2@example.test>"] }] : []),
      ...(o.secondSender ? [{ id: "u-m8", account_id: "acct-dave", account: DAVE, provider_id: "m8", thread_id: "t-a2", internal_date: "2026-10-02T18:00:00Z", from_address: "registrar@school.test", from_name: "Registrar", to_addresses: [], cc_addresses: [], subject: "Re: Peña transcript", snippet: "Looping in.", has_body: true, deleted: false, source_hash: "sh-8", reply_to: "", message_id_header: "<m8@example.test>", references: [] }] : []),
      { id: "u-m2", account_id: "acct-dave", account: DAVE, provider_id: "m2", thread_id: "t-a2", internal_date: "2026-10-02T15:05:00Z", from_address: "coach@example.test", from_name: "Coach Miller", to_addresses: [], cc_addresses: [], subject: "Re: Peña transcript", snippet: "I'll get it over.", has_body: true, deleted: !!o.evidenceDeleted, source_hash: "sh-1", reply_to: "", message_id_header: "<m2@example.test>", references: [] },
    ] },
    evidence: { "ev-1": { id: "ev-1", type: "email", account_id: "acct-dave", message_id: "u-m2", provider_message_id: "m2", thread_id: "t-a2", excerpt: "I'll get Peña's transcript over to you once the school sends it to me.", captured_at: "2026-10-02T15:10:00Z", source_timezone: null, availability: o.evidenceDeleted ? "deleted" : "available" } },
  };
  const calls: Rig["calls"] = [];
  const posts: string[] = [];
  const written = async (id: string, patch: Partial<WaitingData>, drop: (keyof WaitingData)[], kind: string, verb: string) => {
    const cur = await world.waiting.get(id);
    if (!cur) return { error: "NOT_FOUND" };
    const data: WaitingData = { ...cur.data, ...patch };
    for (const k of drop) delete data[k];
    await store.update(USER, id, data as unknown as ItemData);
    world.actions.push({ kind, item: id, verb });
    return { action_id: `act-${world.actions.length}`, receipt_id: `r-${world.actions.length}`, item_id: id, item_updated_at: NOW.toISOString(), data, state: "confirmed", safe_message: verb };
  };
  const table: Record<string, Fn> = {
    email_accounts: () => [account()],
    email_inbox: (a) => ({ rows: rows.slice(0, a.p_limit as number), cached_total: rows.length, page: a.p_limit }),
    email_message_read: (a) => { const r = rows.find((x) => x.id === a.p_message); return r ? detailOf(r) : { error: "NOT_FOUND" }; },
    substrate_readiness: () => ({ registered: ["money_bill", "money_receipt", "task", "event", "waiting"] }),
    candidates_for: () => [],
    candidate_propose: () => ({ candidate_id: "c-x", revision: 1, status: "proposed", payload_hash: "h", replay: false, stale_marked: 0 }),
    waiting_resolve: (a) => written(a.p_item as string, { status: "resolved", resolvedAt: NOW.toISOString(), ...(a.p_note ? { resolutionNote: String(a.p_note) } : {}) }, [], "waiting_resolve", "Resolved · Peña's Transcript"),
    waiting_reopen: (a) => written(a.p_item as string, { status: "open" }, ["resolvedAt", "resolutionNote"], "waiting_reopen", "Reopened · Peña's Transcript"),
    waiting_follow_up: (a) => a.p_date ? written(a.p_item as string, { followUpOn: String(a.p_date) }, [], "waiting_follow_up", `Follow Up ${a.p_date} · Peña's Transcript`) : written(a.p_item as string, {}, ["followUpOn"], "waiting_follow_up", "Follow Up Cleared · Peña's Transcript"),
    thread_messages: (a) => world.threads[a.p_thread as string] ?? [],
    threads_latest: (a) => Object.fromEntries((a.p_threads as string[]).flatMap((t) => { const m = (world.threads[t] ?? []).filter((x) => !x.deleted)[0]; return m ? [[t, { message_id: m.id, internal_date: m.internal_date, from_address: m.from_address, from_name: m.from_name, subject: m.subject, account_id: m.account_id }]] : []; })),
    evidence_read: (a) => world.evidence[a.p_evidence as string] ?? { error: "NOT_FOUND" },
    candidate_review_count: () => ({ count: 0, messages: 0 }),
    draft_save: (a) => ({ draft_id: "d-1", revision: 1, saved_at: NOW.toISOString(), send_state: "draft", fields: a.p_fields }),
  };
  const client: RpcClient = { rpc: async (fn, args) => { calls.push({ fn, args: (args ?? {}) as Record<string, unknown> }); const f = table[fn]; if (!f) throw new Error("no fake for " + fn); return { data: await f((args ?? {}) as Record<string, unknown>), error: null }; } };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => { posts.push(url); const answer = url.endsWith("/api/email/sync") ? { ok: true, synced: 0, removed: 0, next_page: null, complete: true, resynced: false } : { ok: true, message_id: "x", labels: ["INBOX"], read: true, in_inbox: true, in_trash: false, receipt: null, attachments: 0 }; return { ok: true, status: 200, json: async () => answer } as Response; }));
  return { client, calls, world, posts };
}

const mount = (r: Rig, extra: Partial<Parameters<typeof EmailFlow>[0]> = {}) => render(<EmailFlow client={r.client} token="jwt" userId={USER} categories={[]} now={() => NOW} zone="America/New_York" onOpenConnections={() => {}} onOpenModule={() => {}} waiting={r.world.waiting} {...extra} />);
const goWaiting = async () => { fireEvent.click(screen.getByRole("tab", { name: "Waiting" })); await waitFor(() => expect(document.querySelector("[data-waiting]")).toBeTruthy()); };
const itemCount = async (r: Rig) => (await r.world.store.listForUser(USER)).length;

let toasts: ToastState[] = [];
let unsub = () => {};
beforeEach(() => { localStorage.clear(); resetToasts(); toasts = []; unsub = subscribeToast((t) => { if (t) toasts.push(t); }); Object.defineProperty(navigator, "onLine", { value: true, configurable: true }); });
afterEach(() => { unsub(); cleanup(); vi.unstubAllGlobals(); });

describe("E12, E13: Track, then Waiting, then Resolve and Reopen", () => {
  it("a tracked record is listed under Open with who, how long and nothing red; Resolve is one call with a receipt's verb, the record moves to Resolved; Reopen reverses it; nothing is sent", async () => {
    const r = rig();
    const id = await r.world.waiting.create(openItem());
    mount(r);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Waiting" })).toBeInTheDocument());
    await goWaiting();
    const rowEl = document.querySelector(`[data-waiting='${id}']`) as HTMLElement;
    expect(rowEl).toHaveTextContent("Peña's Transcript");
    expect(rowEl).toHaveTextContent("Waiting On Coach Miller");
    expect(rowEl).toHaveTextContent("Yesterday");
    expect(rowEl.querySelector(".fact.warn")).toBeNull();
    fireEvent.click(rowEl);
    await waitFor(() => expect(screen.getByRole("button", { name: RESOLVE })).toBeInTheDocument());
    expect(screen.getByText("Since").nextElementSibling).toHaveTextContent("Oct 2");
    fireEvent.click(screen.getByRole("button", { name: RESOLVE }));
    await waitFor(() => expect(screen.getByRole("button", { name: REOPEN })).toBeInTheDocument());
    const resolve = r.calls.find((c) => c.fn === "waiting_resolve")!;
    expect(resolve.args).toMatchObject({ p_item: id, p_note: null });
    expect(String(resolve.args.p_idempotency_key).length).toBeGreaterThan(8);
    expect((await r.world.waiting.get(id))!.data.status).toBe("resolved");
    expect(toasts.some((t) => t.message === "Resolved · Peña's Transcript")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: REOPEN }));
    await waitFor(() => expect(screen.getByRole("button", { name: RESOLVE })).toBeInTheDocument());
    expect((await r.world.waiting.get(id))!.data.status).toBe("open");
    expect(r.world.actions.map((a) => a.kind)).toEqual(["waiting_resolve", "waiting_reopen"]);
    expect(r.posts.filter((u) => u.includes("/api/email/send"))).toEqual([]);
    expect(r.calls.filter((c) => c.fn === "send_review" || c.fn === "send_approve")).toEqual([]);
    expect(await itemCount(r)).toBe(1);
  });

  it("a resolution note rides on the record, optional", async () => {
    const r = rig();
    const id = await r.world.waiting.create(openItem());
    mount(r);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Waiting" })).toBeInTheDocument());
    await goWaiting();
    fireEvent.click(document.querySelector(`[data-waiting='${id}']`) as HTMLElement);
    fireEvent.click(await screen.findByText("Add a Note (Optional)"));
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Arrived by post" } });
    fireEvent.click(screen.getByRole("button", { name: RESOLVE }));
    await waitFor(() => expect(r.calls.find((c) => c.fn === "waiting_resolve")).toBeTruthy());
    expect(r.calls.find((c) => c.fn === "waiting_resolve")!.args.p_note).toBe("Arrived by post");
    await waitFor(() => expect(screen.getByText(/Arrived by post/)).toBeInTheDocument());
  });
});

describe("12: a follow-up date is tracker metadata", () => {
  it("setting a date writes the record and no task or event; the list shows it in warning only when due; Clear Date removes it", async () => {
    const r = rig();
    const id = await r.world.waiting.create(openItem());
    mount(r);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Waiting" })).toBeInTheDocument());
    await goWaiting();
    fireEvent.click(document.querySelector(`[data-waiting='${id}']`) as HTMLElement);
    fireEvent.change(await screen.findByLabelText(FOLLOW_UP_DATE), { target: { value: "2026-10-03" } });
    await waitFor(() => expect(r.calls.find((c) => c.fn === "waiting_follow_up")).toBeTruthy());
    expect(r.calls.find((c) => c.fn === "waiting_follow_up")!.args).toMatchObject({ p_item: id, p_date: "2026-10-03" });
    expect((await r.world.waiting.get(id))!.data.followUpOn).toBe("2026-10-03");
    expect(await r.world.tasks.listTasks()).toEqual([]);
    expect(await r.world.schedule.listEvents()).toEqual([]);
    expect(await itemCount(r)).toBe(1);
    await waitFor(() => expect(screen.getAllByText("Follow Up Today").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "Email" }));
    await waitFor(() => expect(document.querySelector(`[data-waiting='${id}']`)).toBeTruthy());
    expect(document.querySelector(`[data-waiting='${id}'] .fact.warn`)).toHaveTextContent("Follow Up Today");
    fireEvent.click(document.querySelector(`[data-waiting='${id}']`) as HTMLElement);
    fireEvent.click(await screen.findByRole("button", { name: CLEAR_DATE }));
    await waitFor(() => expect((r.calls.filter((c) => c.fn === "waiting_follow_up").at(-1)!.args).p_date).toBeNull());
    // 2026-10-05: no date says nothing. "No Follow-Up Date" was a placeholder under an empty date field.
    await waitFor(() => expect(screen.queryByRole("button", { name: CLEAR_DATE })).toBeNull());
    expect(screen.queryByText("No Follow-Up Date")).toBeNull();
  });
});

describe("E12, 13: the source and the reply", () => {
  it("deleted evidence keeps its excerpt and says so; no Open Source Message door for a message that is gone", async () => {
    const r = rig({ evidenceDeleted: true });
    const id = await r.world.waiting.create(openItem());
    mount(r);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Waiting" })).toBeInTheDocument());
    await goWaiting();
    fireEvent.click(document.querySelector(`[data-waiting='${id}']`) as HTMLElement);
    expect(await screen.findByText(SOURCE_DELETED)).toBeInTheDocument();
    expect(screen.getByText(/I'll get Peña's transcript over to you/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Source Message" })).toBeNull();
  });

  it("an incoming reply is New Reply on the row and the record, with Review Reply opening the message, and the record stays open", async () => {
    const r = rig({ reply: true });
    const id = await r.world.waiting.create(openItem());
    mount(r);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Waiting" })).toBeInTheDocument());
    await goWaiting();
    await waitFor(() => expect(document.querySelector(`[data-waiting='${id}']`)).toHaveTextContent(NEW_REPLY));
    fireEvent.click(document.querySelector(`[data-waiting='${id}']`) as HTMLElement);
    expect(await screen.findByRole("button", { name: REVIEW_REPLY })).toBeInTheDocument();
    expect((await r.world.waiting.get(id))!.data.status).toBe("open");
    expect(r.calls.filter((c) => c.fn === "waiting_resolve")).toEqual([]);
    expect(screen.getByRole("button", { name: RESOLVE })).toBeInTheDocument();
  });
});

describe("E14: Draft Follow-Up", () => {
  it("opens the composer to the thread's real address, threaded under its newest message, and sends nothing", async () => {
    const r = rig({ reply: true });
    const id = await r.world.waiting.create(openItem());
    mount(r);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Waiting" })).toBeInTheDocument());
    await goWaiting();
    fireEvent.click(document.querySelector(`[data-waiting='${id}']`) as HTMLElement);
    const btn = await screen.findByRole("button", { name: DRAFT_FOLLOW_UP });
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByLabelText("To")).toHaveValue("coach@example.test"));
    expect(screen.getByLabelText("Subject")).toHaveValue("Re: Peña transcript");
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Any news?" } });
    await waitFor(() => expect(r.calls.find((c) => c.fn === "draft_save")).toBeTruthy(), { timeout: 3000 });
    const f = r.calls.find((c) => c.fn === "draft_save")!.args.p_fields as Record<string, unknown>;
    expect(f.thread_id).toBe("t-a2");
    expect(f.reply_headers).toEqual({ in_reply_to: "<m9@example.test>", references: ["<m2@example.test>", "<m9@example.test>"], thread_id: "t-a2" });
    expect(r.posts.filter((u) => u.includes("/api/email/send"))).toEqual([]);
  });

  it("two senders in the thread: the person picks, nothing is guessed", async () => {
    const r = rig({ secondSender: true });
    const id = await r.world.waiting.create(openItem());
    mount(r);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Waiting" })).toBeInTheDocument());
    await goWaiting();
    fireEvent.click(document.querySelector(`[data-waiting='${id}']`) as HTMLElement);
    const btn = await screen.findByRole("button", { name: DRAFT_FOLLOW_UP });
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);
    expect(await screen.findByText(PICK_RECIPIENT)).toBeInTheDocument();
    fireEvent.click(screen.getByText("registrar@school.test"));
    await waitFor(() => expect(screen.getByLabelText("To")).toHaveValue("registrar@school.test"));
  });
});

describe("T1: a focus from Today", () => {
  it("the review focus narrows the inbox to rows with cards and offers Show All; a waiting focus opens the record", async () => {
    const r = rig();
    const id = await r.world.waiting.create(openItem());
    const view = mount(r, { focus: { kind: "candidates" }, focusNonce: 1 });
    await waitFor(() => expect(screen.getByText(new RegExp(REVIEW_FILTER))).toBeInTheDocument());
    expect(screen.getAllByRole("button").filter((b) => b.className.includes("mrow")).length).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: SHOW_ALL_ROWS }));
    await waitFor(() => expect(screen.getAllByRole("button").filter((b) => b.className.includes("mrow")).length).toBe(1));
    view.rerender(<EmailFlow client={r.client} token="jwt" userId={USER} categories={[]} now={() => NOW} zone="America/New_York" onOpenConnections={() => {}} onOpenModule={() => {}} waiting={r.world.waiting} focus={{ kind: "waiting", id }} focusNonce={2} />);
    await waitFor(() => expect(screen.getByRole("button", { name: RESOLVE })).toBeInTheDocument());
    expect(within(document.body).getByText("Peña's Transcript")).toBeInTheDocument();
  });
});
