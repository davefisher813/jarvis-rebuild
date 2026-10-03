import { describe, it, expect } from "vitest";
import { approveCapture, dismissCandidate, editCandidate, preparedForServer, restoreCandidate, undoCapture, undoToastOpen, UNDO_TOAST_MS, type CandidateCard } from "./captures";
import type { RpcClient } from "./errors";
import type { BillPayload, ReceiptPayload, TaskPayload } from "../contracts";
import type { PrepareContext } from "../destinations/types";
import { ADAPTERS } from "../destinations/registry";

const at = <T,>(xs: T[], i: number): T => { const x = xs[i]; if (x === undefined) throw new Error(`no item ${i}`); return x; };
const NOW = "2026-10-03T12:00:00.000Z";
const ctx: PrepareContext = { now: () => NOW, today: "2026-10-03", zone: "America/New_York", threadId: "t-a1", account: "a@example.test" };
const BILL: BillPayload = { kind: "bill", issuer: "Con Edison", amount: { minor_units: 14230, currency: "USD" }, due_date: "2026-10-15", no_due_date_confirmed: false };
const TASK: TaskPayload = { kind: "task", title: "Review transcript", due_date: "2026-10-09", notes: "" };
const RECEIPT: ReceiptPayload = { kind: "receipt", merchant: "Delta", amount: { minor_units: 28410, currency: "USD" }, purchase_date: "2026-10-02", transaction_type: "purchase" };

function recorder(data: unknown = {}): { client: RpcClient; calls: Array<{ fn: string; args: Record<string, unknown> | undefined }> } {
  const calls: Array<{ fn: string; args: Record<string, unknown> | undefined }> = [];
  return { calls, client: { rpc: async (fn, args) => { calls.push({ fn, args }); return { data, error: null }; } } };
}

const card = (payload: CandidateCard["payload"], extra: Partial<CandidateCard> = {}): CandidateCard =>
  ({ id: "cand-1", kind: payload.kind, revision: 2, payloadHash: "ph-1", payload, evidenceExcerpt: "Amount due $142.30 by Oct 15", ...extra });

describe("approveCapture: the adapter prepares, the server commits", () => {
  it("sends exactly what capture_approve checks: the card's id, revision and hash, a request id, the module's data", async () => {
    const { client, calls } = recorder({ action_id: "a1", state: "confirmed", destination_id: "i1", receipt_id: "r1", safe_message: "Saved $142.30 Bill to Money", item_updated_at: NOW });
    const r = await approveCapture(client, card(BILL), ctx, { requestId: "req-1" });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const { fn, args } = at(calls, 0);
    expect(fn).toBe("capture_approve");
    expect(args).toMatchObject({ p_candidate: "cand-1", p_expected_revision: 2, p_shown_payload_hash: "ph-1", p_idempotency_key: "req-1" });
    const prepared = args?.p_prepared as { destination_kind: string; data: Record<string, unknown>; exact_effect: string; display_summary: string; module_version: string; evidence_excerpt: string };
    expect(prepared.destination_kind).toBe("money_bill");
    expect(prepared.exact_effect).toBe("Saved $142.30 Bill to Money");
    expect(prepared.display_summary).toBe("Con Edison · $142.30 · Due Oct 15");
    expect(prepared.module_version).toBe(ADAPTERS.bill.moduleVersion);
    expect(prepared.evidence_excerpt).toBe("Amount due $142.30 by Oct 15");
    expect(prepared.data).toMatchObject({ vendor: "Con Edison", amountCents: 14230, currency: "USD", dueDate: "2026-10-15" });
    expect(typeof prepared.data.fingerprint).toBe("string");
    expect(Array.isArray(prepared.data.history)).toBe(true);
  });

  it("the prepared data is byte-for-byte the adapter's own, so the server's second look sees the module's shape", async () => {
    const prep = await ADAPTERS.bill.prepare(BILL, [], ctx);
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;
    expect(preparedForServer(prep, "x")).toEqual({ destination_kind: "money_bill", data: prep.data, exact_effect: prep.exactEffect, display_summary: prep.displaySummary, module_version: prep.moduleVersion, evidence_excerpt: "x" });
    expect(preparedForServer(prep)).not.toHaveProperty("evidence_excerpt");
  });

  it("a task goes to Tasks with no money on it", async () => {
    const { client, calls } = recorder({ action_id: "a2", state: "confirmed" });
    await approveCapture(client, card(TASK), ctx);
    const prepared = at(calls, 0).args?.p_prepared as { destination_kind: string; data: Record<string, unknown> };
    expect(prepared.destination_kind).toBe("task");
    expect(prepared.data).toMatchObject({ text: "Review transcript", due: "2026-10-09" });
    for (const k of ["amount", "amountCents", "vendor", "bill"]) expect(prepared.data).not.toHaveProperty(k);
  });

  it("missing details never reach the server", async () => {
    const { client, calls } = recorder();
    const r = await approveCapture(client, card({ ...BILL, due_date: null }), ctx);
    expect(calls).toHaveLength(0);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe("MISSING_DETAILS"); expect(r.data.missing).toEqual(["due_date"]); }
  });

  it("what the module cannot hold yet stays in Email as UNSUPPORTED", async () => {
    const { client, calls } = recorder();
    const r = await approveCapture(client, card({ ...RECEIPT, transaction_type: "refund" }), ctx);
    expect(calls).toHaveLength(0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("UNSUPPORTED");
  });

  it("a module the screen knows is not ready is refused before any round trip", async () => {
    const { client, calls } = recorder();
    const r = await approveCapture(client, card(BILL), ctx, { ready: (k) => k !== "bill" });
    expect(calls).toHaveLength(0);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe("MODULE_UNAVAILABLE"); expect(r.data.destination).toBe("bill"); }
  });

  it("the server's refusals come back with their owned facts", async () => {
    const { client } = recorder({ error: "SOURCE_CHANGED", revision: 3, payload: { ...BILL, issuer: "ConEd" }, payload_hash: "ph-3" });
    const r = await approveCapture(client, card(BILL), ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe("SOURCE_CHANGED"); expect(r.data.revision).toBe(3); expect(r.data.payload_hash).toBe("ph-3"); }
  });

  it("a replay is a success that says so", async () => {
    const { client } = recorder({ action_id: "a1", state: "confirmed", destination_id: "i1", receipt_id: "r1", safe_message: "Saved $142.30 Bill to Money", replay: true });
    const r = await approveCapture(client, card(BILL), ctx);
    expect(r.ok && r.value.replay).toBe(true);
  });
});

describe("undo, edit, dismiss, restore", () => {
  it("undo presents the item's revision and a request id", async () => {
    const { client, calls } = recorder({ action_id: "u1", state: "confirmed", destination_id: null, receipt_id: "r2", safe_message: "Removed From Money · Con Edison" });
    await undoCapture(client, "a1", "2026-10-03T12:00:00.123456+00:00", "req-u");
    expect(at(calls, 0)).toEqual({ fn: "action_undo", args: { p_action: "a1", p_expected_item_updated_at: "2026-10-03T12:00:00.123456+00:00", p_idempotency_key: "req-u" } });
  });
  it("the undo toast lasts ten seconds", () => {
    expect(UNDO_TOAST_MS).toBe(10_000);
    expect(undoToastOpen(NOW, "2026-10-03T12:00:09.999Z")).toBe(true);
    expect(undoToastOpen(NOW, "2026-10-03T12:00:10.001Z")).toBe(false);
    expect(undoToastOpen(NOW, "2026-10-03T11:59:59.000Z")).toBe(false);
    expect(undoToastOpen("nope", NOW)).toBe(false);
  });
  it("edit sends the full typed payload, the fields the person typed, and the ones still missing", async () => {
    const { client, calls } = recorder({ candidate_id: "cand-1", revision: 3, status: "needs_details", payload_hash: "ph-2" });
    const r = await editCandidate(client, { id: "cand-1", revision: 2 }, { issuer: "Con Edison", amount: { minor_units: 14230, currency: "USD" }, due_date: null, no_due_date_confirmed: false }, ["issuer"], ["due_date"]);
    expect(at(calls, 0).args).toEqual({ p_candidate: "cand-1", p_expected_revision: 2, p_payload: { issuer: "Con Edison", amount: { minor_units: 14230, currency: "USD" }, due_date: null, no_due_date_confirmed: false }, p_user_fields: ["issuer"], p_missing: ["due_date"] });
    expect(r.ok && r.value.revision).toBe(3);
  });
  it("dismiss and restore carry the revision the card was rendered from", async () => {
    const { client, calls } = recorder({ candidate_id: "cand-1", revision: 3, status: "dismissed" });
    await dismissCandidate(client, { id: "cand-1", revision: 2 });
    await restoreCandidate(client, { id: "cand-1", revision: 3 });
    expect(calls.map((c) => [c.fn, c.args])).toEqual([["candidate_dismiss", { p_candidate: "cand-1", p_expected_revision: 2 }], ["candidate_restore", { p_candidate: "cand-1", p_expected_revision: 3 }]]);
  });
});
