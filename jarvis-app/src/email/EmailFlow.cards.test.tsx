// @vitest-environment jsdom
// CARDS, END TO END AGAINST A FAKE SESSION (docs/jarvis-unified, slice 06;
// IMPLEMENTATION-SPEC.md 08 E07 to E11, E24, E25; 09 M1, M3, H7; 10; 13;
// prompt 06 "Verify before completing"). The real screens render; the
// database functions are a recorder with the candidate table's own rules
// (dedupe by fingerprint, dismissed stays dismissed, the atomic save marks
// the card saved and answers once). What the tests hold: the rules read the
// loaded rows and make cards only where the catalog says; one tap saves
// exactly the shown card once with no second popup and leaves a receipt
// line; Undo is a compensating action; two cards under one mail stay
// independent; dismiss removes the card and only the card; a changed email
// says so instead of saving; a module that is not ready shuts only its own
// door; manual capture needs no model and no network beyond the save; no
// item exists until the tap.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import EmailFlow from "./EmailFlow";
import { EMAIL_CHANGED, REVIEW_LATEST, SHOW_DISMISSED, RESTORE, UNDO, CAPTURE_TITLE, CAPTURE_KIND, VIEW_RECEIPT } from "./copy";
import type { EmailAccount, InboxRow, MessageDetail, RpcClient } from "./emailClient";
import { EXTRACTOR_VERSION } from "../substrate/extract";
import type { Candidate } from "./candidates";
import { subscribeToast, resetToasts, type ToastState } from "../shared/toast";

const NOW = new Date("2026-10-03T15:00:00Z");
const USER = "user-1";
const DAVE = "dave@example.test";
const account = (o: Partial<EmailAccount> = {}): EmailAccount => ({ id: "acct-dave", address: DAVE, state: "connected", last_sync_at: "2026-10-03T14:50:00Z", sync_error: null, capabilities: { archive: true, trash: true, read: true }, connected_at: "2026-09-01T00:00:00Z", scopes: [], cached: 4, ...o });

const row = (id: string, iso: string, o: Partial<InboxRow> = {}): InboxRow => ({
  id: `u-${id}`, account_id: "acct-dave", account: DAVE, provider_id: id, thread_id: `18f2a9c4e1b7d3a${id.slice(-1)}`, internal_date: iso, from_address: "billing@conedison.test", from_name: "Con Edison",
  subject: "Your October bill is ready", snippet: "Your statement is ready. Amount due: USD 142.30. Due date: October 15, 2026.", has_body: true, attachment_metadata: [], provider_labels: ["INBOX"], source_hash: "sh-1", read: true, ...o,
});
const rows: InboxRow[] = [
  row("m1", "2026-10-03T10:00:00Z"),
  row("m2", "2026-10-03T09:00:00Z", { from_address: "coach@example.test", from_name: "Coach Miller", subject: "Re: Peña transcript", snippet: "I'll get Peña's transcript over to you once the school sends it to me." }),
  row("m3", "2026-10-03T08:00:00Z", { from_address: "wei@example.test", from_name: "Wei Chang", subject: "September expense summary", snippet: "The updated September expense summary is attached for your review." }),
  row("m4", "2026-10-03T07:00:00Z", { from_address: "promos@dicks.test", from_name: "Dick's Sporting Goods", subject: "A fresh start for your season", snippet: "Explore this week's gear and team equipment." }),
];
const detailOf = (r: InboxRow): MessageDetail => ({
  id: r.id, account_id: r.account_id, account: r.account, provider_id: r.provider_id, thread_id: r.thread_id, internal_date: r.internal_date, from_address: r.from_address, from_name: r.from_name,
  to_addresses: [{ address: DAVE, name: "" }], cc_addresses: [], subject: r.subject, snippet: r.snippet, provider_labels: r.provider_labels, read: true, deleted: false, source_hash: r.source_hash,
  attachments: [], has_body: true, text: r.snippet, html: null,
});

type Fn = (args: Record<string, unknown>) => unknown;
interface World { cands: Candidate[]; items: Array<{ id: string; entity_type: string; data: Record<string, unknown> }>; actions: Record<string, { candidate: string; payload_hash: string; item: string }>; registered: string[] }
interface Rig { client: RpcClient; calls: Array<{ fn: string; args: Record<string, unknown> }>; world: World; posts: string[] }

function rig(o: { rows?: InboxRow[]; registered?: string[]; cands?: Candidate[]; rpc?: Partial<Record<string, Fn>> } = {}): Rig {
  const all = o.rows ?? rows;
  const world: World = { cands: o.cands ?? [], items: [], actions: {}, registered: o.registered ?? ["money_bill", "money_receipt", "task", "event", "waiting"] };
  const calls: Rig["calls"] = [];
  const posts: string[] = [];
  let seq = 0;
  const hashOf = (p: unknown) => "h" + JSON.stringify(p).length.toString(36) + (JSON.stringify(p).split("").reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7).toString(36));
  const table: Record<string, Fn> = {
    email_accounts: () => [account()],
    email_inbox: (a) => ({ rows: all.slice(0, a.p_limit as number), cached_total: all.length, page: a.p_limit }),
    email_message_read: (a) => { const r = all.find((x) => x.id === a.p_message); return r ? detailOf(r) : { error: "NOT_FOUND" }; },
    substrate_readiness: () => ({ registered: world.registered }),
    candidates_for: (a) => world.cands.filter((c) => (a.p_messages as string[]).includes(c.message_id) && (a.p_include_dismissed || c.status !== "dismissed")).map((c) => ({ ...c, message_source_hash: all.find((r) => r.id === c.message_id)?.source_hash ?? c.source_hash })),
    candidate_propose: (a) => {
      const msg = all.find((r) => r.id === a.p_message)!;
      if (a.p_source_hash !== msg.source_hash) return { error: "SOURCE_CHANGED", source_hash: msg.source_hash };
      const existing = world.cands.find((c) => c.message_id === a.p_message && c.kind === a.p_kind && c.fingerprint === a.p_fingerprint);
      const payload = { ...(a.p_payload as Record<string, unknown>), kind: a.p_kind };
      const h = hashOf(payload);
      if (existing) return { candidate_id: existing.id, revision: existing.revision, status: existing.status, payload_hash: existing.payload_hash, replay: true, stale_marked: 0 };
      const missing = a.p_missing as string[];
      const c: Candidate = {
        id: `cand-${++seq}`, message_id: a.p_message as string, account_id: msg.account_id, kind: a.p_kind as Candidate["kind"], origin: (a.p_origin as Candidate["origin"]) ?? "rule", agent_name: null,
        status: missing.length ? "needs_details" : "proposed", revision: 1, payload: payload as Candidate["payload"], payload_hash: h, provenance_by_field: (a.p_provenance as Candidate["provenance_by_field"]) ?? {},
        missing_fields: missing, fingerprint: a.p_fingerprint as string, source_hash: msg.source_hash, message_source_hash: msg.source_hash, destination_id: null, action_id: null, proposal_id: null,
        extractor_version: a.p_extractor_version as string, created_at: NOW.toISOString(), updated_at: NOW.toISOString(), saved_sibling: null,
      };
      world.cands.push(c);
      return { candidate_id: c.id, revision: 1, status: c.status, payload_hash: h, replay: false, stale_marked: 0 };
    },
    candidate_edit: (a) => {
      const c = world.cands.find((x) => x.id === a.p_candidate)!;
      if (c.revision !== a.p_expected_revision) return { error: "SOURCE_CHANGED", revision: c.revision };
      c.payload = { ...(a.p_payload as Record<string, unknown>), kind: c.kind } as Candidate["payload"]; c.payload_hash = hashOf(c.payload); c.missing_fields = a.p_missing as string[]; c.status = c.missing_fields.length ? "needs_details" : "proposed"; c.revision += 1;
      return { candidate_id: c.id, revision: c.revision, payload_hash: c.payload_hash, status: c.status };
    },
    candidate_dismiss: (a) => { const c = world.cands.find((x) => x.id === a.p_candidate)!; c.status = "dismissed"; c.revision += 1; return { candidate_id: c.id, revision: c.revision, status: "dismissed" }; },
    candidate_restore: (a) => { const c = world.cands.find((x) => x.id === a.p_candidate)!; c.status = c.missing_fields.length ? "needs_details" : "proposed"; c.revision += 1; return { candidate_id: c.id, revision: c.revision, status: c.status }; },
    capture_approve: (a) => {
      const c = world.cands.find((x) => x.id === a.p_candidate)!;
      if (c.status === "saved") { const act = Object.entries(world.actions).find(([, v]) => v.candidate === c.id)!; return { action_id: act[0], state: "confirmed", destination_id: act[1].item, receipt_id: "r-" + act[0], safe_message: "replayed", replay: true }; }
      if (c.revision !== a.p_expected_revision || c.payload_hash !== a.p_shown_payload_hash) return { error: "SOURCE_CHANGED", revision: c.revision };
      if (c.missing_fields.length) return { error: "MISSING_DETAILS", missing: c.missing_fields };
      const prepared = a.p_prepared as { destination_kind: string; data: Record<string, unknown>; exact_effect: string };
      if (!world.registered.includes(prepared.destination_kind)) return { error: "MODULE_UNAVAILABLE", destination: prepared.destination_kind };
      const item = `item-${++seq}`;
      world.items.push({ id: item, entity_type: prepared.destination_kind, data: prepared.data });
      const action = `act-${seq}`;
      world.actions[action] = { candidate: c.id, payload_hash: c.payload_hash, item };
      c.status = "saved"; c.destination_id = item; c.action_id = action;
      return { action_id: action, state: "confirmed", destination_id: item, receipt_id: "r-" + action, safe_message: prepared.exact_effect, item_updated_at: "2026-10-03T15:00:00.000000+00:00", already: false };
    },
    action_undo: (a) => {
      const act = world.actions[a.p_action as string]!;
      world.items = world.items.filter((i) => i.id !== act.item);
      const c = world.cands.find((x) => x.id === act.candidate)!; c.status = "proposed"; c.destination_id = null; c.action_id = null;
      return { action_id: "undo-" + a.p_action, state: "confirmed", destination_id: null, receipt_id: "r-undo", safe_message: "Removed From Money · Con Edison", undone_action_id: a.p_action };
    },
    receipt_detail: (a) => {
      const act = world.actions[a.p_action as string];
      return { action_id: a.p_action, kind: "capture_bill", surface: "email", state: "confirmed", verb: "Saved $142.30 Bill to Money", actor_kind: "rule", actor_id: null, actor_display: "Rule", approved_by_user: true, destination_id: act?.item ?? null, provider_account_id: null, created_at: NOW.toISOString(), updated_at: NOW.toISOString(), error_code: null, inside_email: false, undoable: true, item_updated_at: "2026-10-03T15:00:00.000000+00:00", outbox: null, receipts: [], evidence: [] };
    },
    ...o.rpc,
  };
  const client: RpcClient = { rpc: async (fn, args) => { calls.push({ fn, args: (args ?? {}) as Record<string, unknown> }); const f = table[fn]; if (!f) throw new Error("no fake for " + fn); return { data: f((args ?? {}) as Record<string, unknown>), error: null }; } };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    posts.push(url);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const answer = url.endsWith("/api/email/sync") ? { ok: true, synced: 0, removed: 0, next_page: null, complete: true, resynced: false }
      : url.endsWith("/api/email/message") ? { ok: true, message_id: "x", labels: ["INBOX"], read: true, in_inbox: true, in_trash: false, receipt: null, attachments: 0, op: body.op }
        : { ok: true };
    return { ok: true, status: 200, json: async () => answer } as Response;
  }));
  return { client, calls, world, posts };
}

const mount = (r: Rig) => render(<EmailFlow client={r.client} token="jwt" userId={USER} categories={[]} now={() => NOW} zone="America/New_York" onOpenConnections={() => {}} onOpenModule={() => {}} />);
const cardEls = () => [...document.querySelectorAll("[data-candidate]")] as HTMLElement[];
const cardFor = (kind: string) => document.querySelector(`.email-card.${kind}`) as HTMLElement | null;
const rowLabels = () => screen.getAllByRole("button").filter((b) => b.className.includes("mrow")).map((b) => b.getAttribute("aria-label")!);

let toasts: ToastState[] = [];
let unsub = () => {};
beforeEach(() => { localStorage.clear(); resetToasts(); toasts = []; unsub = subscribeToast((t) => { if (t) toasts.push(t); }); Object.defineProperty(navigator, "onLine", { value: true, configurable: true }); });
afterEach(() => { unsub(); cleanup(); vi.unstubAllGlobals(); });

describe("E07: the rules read the loaded rows", () => {
  it("Con Edison gets a bill card and Coach Miller a waiting card; Wei and the promo get none; each proposal carries its fingerprint, provenance and version", async () => {
    const r = rig();
    mount(r);
    await waitFor(() => expect(cardFor("bill")).toBeTruthy());
    await waitFor(() => expect(cardFor("waiting")).toBeTruthy());
    expect(cardEls().length).toBe(2);
    const bill = cardFor("bill")!;
    expect(bill).toHaveTextContent("$142.30");
    // 2026-10-05: the facts are separate spans, the dot is the stylesheet's; a later due date is a neutral small-caps fact, the issuer the one grey.
    expect([...bill.querySelectorAll(".conn-meta .fact")].map((f) => f.textContent)).toEqual(["Due Oct 15", "Con Edison"]);
    expect(bill.querySelector(".fact.date")).toHaveTextContent("Due Oct 15");
    expect(within(bill).getByText("Save Bill")).toBeEnabled();
    expect(within(bill).getByText("Money")).toBeInTheDocument();
    expect(cardFor("waiting")).toHaveTextContent("Peña's Transcript");
    expect(within(cardFor("waiting")!).getByText("Track This")).toBeInTheDocument();
    // The card sits under its own row, and the row is still the row.
    expect(rowLabels().length).toBe(4);
    const proposals = r.calls.filter((c) => c.fn === "candidate_propose");
    expect(proposals.length).toBe(2);
    expect(proposals[0]!.args).toMatchObject({ p_message: "u-m1", p_kind: "bill", p_origin: "rule", p_extractor_version: EXTRACTOR_VERSION, p_source_hash: "sh-1", p_missing: [] });
    expect(String(proposals[0]!.args.p_fingerprint)).toMatch(/^fp1:/);
    expect((proposals[0]!.args.p_provenance as Record<string, { source: string }>).amount!.source).toBe("email");
    // No item exists: a card is not a record.
    expect(r.world.items).toEqual([]);
    // Opening the tab again reads nothing twice: the same message, the same version, one reading.
    cleanup();
    const r2 = rig({ cands: r.world.cands });
    mount(r2);
    await waitFor(() => expect(cardFor("bill")).toBeTruthy());
    expect(r2.calls.filter((c) => c.fn === "candidate_propose")).toEqual([]);
  });
});

describe("E09, E11: one tap, one record, one receipt, and Undo", () => {
  it("Save Bill commits exactly the shown card once through the atomic door, leaves a receipt line, and the toast's Undo is a compensating action", async () => {
    const r = rig();
    mount(r);
    await waitFor(() => expect(cardFor("bill")).toBeTruthy());
    const cand = r.world.cands.find((c) => c.kind === "bill")!;
    fireEvent.click(within(cardFor("bill")!).getByText("Save Bill"));
    await waitFor(() => expect(document.querySelector(".email-receipt-line")).toBeTruthy());
    const approve = r.calls.filter((c) => c.fn === "capture_approve");
    expect(approve.length).toBe(1);
    expect(approve[0]!.args).toMatchObject({ p_candidate: cand.id, p_expected_revision: 1, p_shown_payload_hash: cand.payload_hash });
    const prepared = approve[0]!.args.p_prepared as { destination_kind: string; data: Record<string, unknown>; exact_effect: string; display_summary: string };
    expect(prepared.destination_kind).toBe("money_bill");
    expect(prepared.data).toMatchObject({ vendor: "Con Edison", amountCents: 14230, currency: "USD", dueDate: "2026-10-15" });
    expect(prepared.exact_effect).toBe("Saved $142.30 Bill to Money");
    expect(prepared.display_summary).toBe("Con Edison · $142.30 · Due Oct 15");
    // The record exists now, in Money's shape, and only now.
    expect(r.world.items).toEqual([{ id: expect.any(String), entity_type: "money_bill", data: prepared.data }]);
    expect([...document.querySelectorAll(".email-receipt-line .fact")].map((f) => f.textContent)).toEqual(["\u2713 Saved Bill", "$142.30"]);
    expect(document.querySelector(".email-receipt-line .fact.good")).toHaveTextContent("Saved Bill");
    expect(within(document.querySelector(".email-receipt-line") as HTMLElement).getByText(VIEW_RECEIPT)).toBeInTheDocument();
    expect(cardFor("bill")).toBeNull();
    expect(document.querySelectorAll(".sheet-scrim").length).toBe(0);
    const t = toasts.find((x) => x.message === "Saved $142.30 Bill to Money")!;
    expect(t.actionLabel).toBe(UNDO);
    await act(async () => { t.onAction!(); });
    await waitFor(() => expect(cardFor("bill")).toBeTruthy());
    expect(r.calls.find((c) => c.fn === "action_undo")!.args).toMatchObject({ p_action: approve[0]!.args.p_candidate ? Object.keys(r.world.actions)[0] : "", p_expected_item_updated_at: "2026-10-03T15:00:00.000000+00:00" });
    expect(r.world.items).toEqual([]);
  });

  it("View opens the receipt with its exact verb, and back returns to the inbox", async () => {
    const r = rig();
    mount(r);
    await waitFor(() => expect(cardFor("bill")).toBeTruthy());
    fireEvent.click(within(cardFor("bill")!).getByText("Save Bill"));
    await waitFor(() => expect(document.querySelector(".email-receipt-line")).toBeTruthy());
    fireEvent.click(within(document.querySelector(".email-receipt-line") as HTMLElement).getByText(VIEW_RECEIPT));
    await waitFor(() => expect(screen.getAllByText("Saved $142.30 Bill to Money").length).toBeGreaterThan(0));
    expect(r.calls.find((c) => c.fn === "receipt_detail")).toBeTruthy();
    fireEvent.click(screen.getByText("Email"));
    await waitFor(() => expect(rowLabels().length).toBe(4));
  });
});

describe("two cards, dismiss, a changed email, a shut module", () => {
  it("two cards under one mail are independent: saving the bill leaves the task's Add Task standing", async () => {
    const two = [row("m9", "2026-10-03T11:00:00Z", { snippet: "Amount due: USD 142.30 by October 15, 2026. Can you update your mailing address by October 30?" })];
    const r = rig({ rows: two });
    mount(r);
    await waitFor(() => expect(cardFor("task")).toBeTruthy());
    expect(cardFor("bill")).toBeTruthy();
    expect(cardFor("task")).toHaveTextContent("Update Your Mailing Address");
    fireEvent.click(within(cardFor("bill")!).getByText("Save Bill"));
    await waitFor(() => expect(document.querySelector(".email-receipt-line")).toBeTruthy());
    expect(cardFor("task")).toBeTruthy();
    expect(within(cardFor("task")!).getByText("Add Task")).toBeEnabled();
    expect(r.world.items.map((i) => i.entity_type)).toEqual(["money_bill"]);
  });

  it("Dismiss removes only the card; the row stays; Show Dismissed Suggestions brings it back with Restore; the rules proposing it again leave it dismissed", async () => {
    const r = rig();
    mount(r);
    await waitFor(() => expect(cardFor("bill")).toBeTruthy());
    fireEvent.click(within(cardFor("bill")!).getByRole("button", { name: /^Dismiss/ }));
    await waitFor(() => expect(cardFor("bill")).toBeNull());
    expect(rowLabels()[0]).toMatch(/Con Edison/);
    expect(r.world.cands.find((c) => c.kind === "bill")!.status).toBe("dismissed");
    // Read again: the same fingerprint is the dismissed card, not a new one.
    const again = await r.client.rpc("candidate_propose", { p_message: "u-m1", p_kind: "bill", p_payload: r.world.cands[0]!.payload, p_provenance: {}, p_missing: [], p_fingerprint: r.world.cands[0]!.fingerprint, p_extractor_version: EXTRACTOR_VERSION, p_source_hash: "sh-1", p_origin: "rule" });
    expect(again.data).toMatchObject({ status: "dismissed", replay: true });
    fireEvent.click(screen.getAllByRole("button").find((b) => b.className.includes("mrow"))!);
    await waitFor(() => expect(screen.getByRole("button", { name: "More" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByText(SHOW_DISMISSED));
    await waitFor(() => expect(document.querySelector(".email-card.dismissed")).toBeTruthy());
    fireEvent.click(screen.getByText(RESTORE));
    await waitFor(() => expect(cardFor("bill")).toBeTruthy());
    expect(within(cardFor("bill")!).getByText("Save Bill")).toBeInTheDocument();
  });

  it("a card read from an older copy of the email says Email Changed and offers Review Latest Details, never Save", async () => {
    const stale: Candidate = {
      id: "cand-old", message_id: "u-m1", account_id: "acct-dave", kind: "bill", origin: "rule", agent_name: null, status: "proposed", revision: 1,
      payload: { kind: "bill", issuer: "Con Edison", amount: { minor_units: 13000, currency: "USD" }, due_date: "2026-10-15", no_due_date_confirmed: false }, payload_hash: "h-old",
      provenance_by_field: {}, missing_fields: [], fingerprint: "fp1:old", source_hash: "sh-0", message_source_hash: "sh-1", destination_id: null, action_id: null, proposal_id: null,
      extractor_version: EXTRACTOR_VERSION, created_at: NOW.toISOString(), updated_at: NOW.toISOString(), saved_sibling: null,
    };
    const r = rig({ cands: [stale] });
    mount(r);
    await waitFor(() => expect(document.querySelector("[data-candidate='cand-old']")).toBeTruthy());
    const card = document.querySelector("[data-candidate='cand-old']") as HTMLElement;
    expect(card).toHaveTextContent(EMAIL_CHANGED);
    expect(within(card).getByText(REVIEW_LATEST)).toBeInTheDocument();
    expect(within(card).queryByText("Save Bill")).toBeNull();
    expect(r.world.items).toEqual([]);
  });

  it("Money not ready: the bill's door is shut with the module's own line and the card stays; the task's door is open", async () => {
    const two = [row("m9", "2026-10-03T11:00:00Z", { snippet: "Amount due: USD 142.30 by October 15, 2026. Can you update your mailing address by October 30?" })];
    const r = rig({ rows: two, registered: ["task", "event", "waiting"] });
    mount(r);
    await waitFor(() => expect(cardFor("task")).toBeTruthy());
    const bill = cardFor("bill")!;
    expect([...bill.querySelectorAll(".conn-meta")].map((l) => [...l.querySelectorAll(".fact")].map((f) => f.textContent))).toEqual([["Due Oct 15", "Con Edison"], ["Money Isn't Ready"]]);
    expect(bill.querySelector(".fact.warn")).toHaveTextContent("Money Isn't Ready");
    expect(within(bill).getByText("Save Bill")).toBeDisabled();
    expect(within(cardFor("task")!).getByText("Add Task")).toBeEnabled();
    expect(r.calls.filter((c) => c.fn === "capture_approve")).toEqual([]);
  });
});

describe("E24: manual capture, with every AI off", () => {
  it("Capture a Task from the message opens the sheet empty, the typed title makes it saveable, and the save goes through the same door with no model call", async () => {
    const r = rig({ rows: [rows[2]!] });
    mount(r);
    await waitFor(() => expect(rowLabels().length).toBe(1));
    fireEvent.click(screen.getAllByRole("button").find((b) => b.className.includes("mrow"))!);
    await waitFor(() => expect(screen.getByRole("button", { name: "More" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByText(CAPTURE_TITLE));
    fireEvent.click(screen.getByText(CAPTURE_KIND.task!));
    await waitFor(() => expect(screen.getAllByText("Task · Not Saved Yet").length).toBeGreaterThan(0));
    const manual = r.world.cands.find((c) => c.origin === "manual")!;
    expect(manual).toMatchObject({ kind: "task", status: "needs_details", missing_fields: ["title"] });
    const saveBar = () => document.querySelector(".sheet-bar-save") as HTMLButtonElement;
    expect(saveBar()).toHaveTextContent("Add Task");
    expect(saveBar().className).toContain("dim");
    expect(screen.getByText(/Needs Title/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Review the expense summary" } });
    await waitFor(() => expect(screen.queryByText(/Needs Title/)).toBeNull());
    expect(saveBar().className).not.toContain("dim");
    fireEvent.click(saveBar());
    await waitFor(() => expect(r.world.items.length).toBe(1));
    expect(r.calls.find((c) => c.fn === "candidate_edit")!.args).toMatchObject({ p_candidate: manual.id, p_user_fields: ["title"], p_missing: [] });
    expect(r.world.items[0]).toMatchObject({ entity_type: "task", data: { text: "Review the expense summary", done: false } });
    expect(toasts.some((t) => t.message === "Added to Tasks · Review the expense summary")).toBe(true);
    // No model, no network beyond the email routes. The connection status read (Foundation Fix Spec 1) is the one other door
    // the Email tab opens: read-only, no body, no mail, and it carries no model.
    expect(r.posts.every((u) => u.includes("/api/email/") || u.includes("/api/connections/status"))).toBe(true);
    expect(r.posts.some((u) => u.includes("/api/ai"))).toBe(false);
  });

  it("the sheet's Save Changes edits the card and writes nothing anywhere else", async () => {
    const r = rig();
    mount(r);
    await waitFor(() => expect(cardFor("bill")).toBeTruthy());
    fireEvent.click(within(cardFor("bill")!).getByText("Details"));
    await waitFor(() => expect(screen.getAllByText("Bill · Not Saved Yet").length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("Issuer"), { target: { value: "Con Edison NY" } });
    fireEvent.click(screen.getByText("Save Changes"));
    await waitFor(() => expect(r.calls.find((c) => c.fn === "candidate_edit")).toBeTruthy());
    expect(r.calls.find((c) => c.fn === "candidate_edit")!.args).toMatchObject({ p_user_fields: ["issuer"] });
    expect(r.calls.filter((c) => c.fn === "capture_approve")).toEqual([]);
    expect(r.world.items).toEqual([]);
    await waitFor(() => expect(cardFor("bill")).toHaveTextContent("Con Edison NY"));
    expect(cardFor("bill")).toHaveTextContent("Not Saved Yet");
  });
});
