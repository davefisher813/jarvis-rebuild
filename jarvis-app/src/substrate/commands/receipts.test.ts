import { describe, it, expect } from "vitest";
import { activityFeed, actorLine, assuranceLine, eraseReceipt, exportReceipt, receiptDetail, reviewCountLine, statusLine, ERASE_NOTE, type ReceiptDetail } from "./receipts";
import type { RpcClient } from "./errors";
const at = <T,>(xs: T[], i: number): T => { const x = xs[i]; if (x === undefined) throw new Error(`no item ${i}`); return x; };


function recorder(data: unknown = {}): { client: RpcClient; calls: Array<{ fn: string; args: Record<string, unknown> | undefined }> } {
  const calls: Array<{ fn: string; args: Record<string, unknown> | undefined }> = [];
  return { calls, client: { rpc: async (fn: string, args?: Record<string, unknown>) => { calls.push({ fn, args }); return { data, error: null }; } } };
}

const detail: ReceiptDetail = {
  action_id: "act-1", kind: "capture_bill", surface: "email", state: "confirmed", verb: "Saved $142.30 Bill to Money",
  actor_kind: "agent", actor_id: "conn-1", actor_display: "Claude", approved_by_user: true, destination_id: "item-1", provider_account_id: null,
  created_at: "2026-10-03T12:00:00Z", updated_at: "2026-10-03T12:00:00Z", error_code: null, inside_email: false, undoable: true, item_updated_at: "2026-10-03T12:00:00.123456Z",
  outbox: null,
  receipts: [{
    receipt_id: "r1", sequence: 1, state: "confirmed", exact_verb: "Saved $142.30 Bill to Money", occurred_at: "2026-10-03T12:00:00Z", actor_kind: "agent", actor_id: "conn-1", actor_display: "Claude",
    scope_summary: "Con Edison · $142.30 · Due Oct 15", before_ref: null, after_ref: "item-1", diff: [{ field: "issuer", before: null, after: "Con Edison" }], evidence_refs: ["ev-1"],
    provider_ack: null, error_code: null, reversal_action_id: null, assurance: "verified_jarvis", erased_at: null,
  }],
  evidence: [{ id: "ev-1", type: "email", message_id: "m1", provider_message_id: "p1", thread_id: "t1", excerpt: "Amount due $142.30 by Oct 15", captured_at: "2026-10-03T12:00:00Z", availability: "available" }],
};

describe("receipts: the calls", () => {
  it("the feed asks for a scope, a page size and a cursor", async () => {
    const { client, calls } = recorder({ rows: [], email_review_count: 2, scope: "global" });
    const r = await activityFeed(client, "global", { limit: 20, before: "2026-10-03T00:00:00Z" });
    expect(calls).toEqual([{ fn: "activity_feed", args: { p_limit: 20, p_before: "2026-10-03T00:00:00Z", p_scope: "global" } }]);
    expect(r.ok && r.value.email_review_count).toBe(2);
  });
  it("defaults: global, 50, no cursor", async () => {
    const { client, calls } = recorder({ rows: [], email_review_count: 0, scope: "global" });
    await activityFeed(client);
    expect(at(calls, 0).args).toEqual({ p_limit: 50, p_before: null, p_scope: "global" });
  });
  it("detail and erase name the action", async () => {
    const { client, calls } = recorder(detail);
    await receiptDetail(client, "act-1");
    await eraseReceipt(client, "act-1");
    expect(calls.map((c) => [c.fn, c.args])).toEqual([["receipt_detail", { p_action: "act-1" }], ["receipt_erase", { p_action: "act-1" }]]);
  });
});

describe("receipts: the lines", () => {
  it("the actor line names who suggested and who approved (07.4)", () => {
    expect(actorLine({ actor_kind: "agent", actor_display: "Claude", approved_by_user: true })).toBe("Suggested by Claude · Approved by You");
    expect(actorLine({ actor_kind: "agent", actor_display: "Claude", approved_by_user: false })).toBe("Suggested by Claude");
    expect(actorLine({ actor_kind: "rule", actor_display: "Rule", approved_by_user: true })).toBe("Suggested by a Rule · Approved by You");
    expect(actorLine({ actor_kind: "user", actor_display: "You", approved_by_user: true })).toBe("You");
  });
  it("a reported outside action is never shown as verified", () => {
    expect(actorLine({ actor_kind: "agent", actor_display: "Claude", approved_by_user: false, assurance: "reported_external" })).toBe("Reported by Claude · Not Verified by JARVIS");
    expect(assuranceLine("reported_external")).toBe("Reported by Assistant · Not Verified");
    expect(assuranceLine("provider_ack")).toBe("Accepted by Gmail");
    expect(assuranceLine("verified_jarvis")).toBe("Verified by JARVIS");
  });
  it("the status pill never says Done for anything but confirmed", () => {
    expect(statusLine("confirmed")).toBe("Done");
    expect(statusLine("outcome_unknown")).toBe("Unknown");
    expect(statusLine("failed")).toBe("Not Done");
    expect(statusLine("cancellation_requested")).toBe("Cancel Requested");
    expect(statusLine("running")).toBe("Working");
  });
  it("the review count is the only Email fact that leaves Email", () => {
    expect(reviewCountLine(0)).toBe("");
    expect(reviewCountLine(1)).toBe("1 To Review in Email");
    expect(reviewCountLine(3)).toBe("3 To Review in Email");
  });
  it("the erase note says what erasure is not", () => {
    expect(ERASE_NOTE).toBe("Deleting This Receipt Does Not Undo the Action");
  });
});

describe("receipts: export", () => {
  it("carries the facts and nothing secret", () => {
    const text = exportReceipt(detail);
    const parsed = JSON.parse(text);
    expect(parsed.exact_effect).toBe("Saved $142.30 Bill to Money");
    expect(parsed.actor).toBe("Suggested by Claude · Approved by You");
    expect(parsed.state).toBe("Done");
    expect(parsed.receipts[0].diff).toEqual([{ field: "issuer", before: null, after: "Con Edison" }]);
    expect(parsed.evidence[0].excerpt).toBe("Amount due $142.30 by Oct 15");
    expect(parsed.provider_ack).toBeNull();
    expect(text).not.toMatch(/payload_hash|idempotency|token|nonce/);
  });
  it("an erased receipt exports no diff; a send exports the provider's ids only", () => {
    const erased: ReceiptDetail = { ...detail, receipts: [{ ...at(detail.receipts, 0), erased_at: "2026-10-04T00:00:00Z", exact_verb: "Erased", diff: [] }] };
    expect(JSON.parse(exportReceipt(erased)).receipts[0].diff).toBeUndefined();
    const sent: ReceiptDetail = { ...detail, kind: "send_email", verb: "Sent reply to coach@example.test", outbox: { state: "confirmed", attempt: 1, error_code: null, dispatched_at: "x", provider_ack: { id: "18f3", threadId: "t-a2", labelIds: ["SENT"] } } };
    expect(JSON.parse(exportReceipt(sent)).provider_ack).toEqual({ id: "18f3", thread_id: "t-a2" });
  });
});
