import { describe, it, expect } from "vitest";
import { approveCommand, cancelCommand, reviewCommand, reviewExpired, REVIEW_TTL_MS } from "./sends";
import type { RpcClient } from "./errors";
const at = <T,>(xs: T[], i: number): T => { const x = xs[i]; if (x === undefined) throw new Error(`no item ${i}`); return x; };

function recorder(data: unknown = {}): { client: RpcClient; calls: Array<{ fn: string; args: Record<string, unknown> | undefined }> } {
  const calls: Array<{ fn: string; args: Record<string, unknown> | undefined }> = [];
  return { calls, client: { rpc: async (fn, args) => { calls.push({ fn, args }); return { data, error: null }; } } };
}

describe("sends: review, tap, cancel", () => {
  it("the review sends the exact snapshot, the account, the verb and the draft revision; the hash comes back from the server", async () => {
    const { client, calls } = recorder({ action_id: "a", review_nonce: "n", payload_hash: "h", expires_at: "2026-10-03T12:05:00Z", outbox_id: "o" });
    const payload = { to: ["coach@example.test"], subject: "Re: Transcript", body_text: "On it." };
    const r = await reviewCommand(client, "send_email", payload, "acct-1", "Sent reply to coach@example.test", 3);
    expect(calls).toEqual([{ fn: "command_review", args: { p_kind: "send_email", p_payload: payload, p_provider_account: "acct-1", p_verb: "Sent reply to coach@example.test", p_expected_revision: 3 } }]);
    expect(r.ok && r.value.payload_hash).toBe("h");
  });
  it("the tap shows the hash back under the nonce, with its own request id", async () => {
    const { client, calls } = recorder({ action_id: "a", state: "approved", receipt_id: "r", safe_message: "Sent reply", destination_id: null });
    await approveCommand(client, "n", "h", "req-1");
    expect(at(calls, 0)).toEqual({ fn: "command_approve", args: { p_review_nonce: "n", p_shown_payload_hash: "h", p_idempotency_key: "req-1" } });
    await approveCommand(client, "n", "h");
    expect(typeof at(calls, 1).args?.p_idempotency_key).toBe("string");
  });
  it("a changed snapshot is REVIEW_CHANGED and keeps nothing of the old approval", async () => {
    const { client } = recorder({ error: "REVIEW_CHANGED" });
    const r = await approveCommand(client, "n", "other");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("REVIEW_CHANGED");
  });
  it("cancel names the action", async () => {
    const { client, calls } = recorder({ action_id: "a", state: "cancellation_requested" });
    const r = await cancelCommand(client, "a");
    expect(at(calls, 0)).toEqual({ fn: "command_cancel", args: { p_action: "a" } });
    expect(r.ok && r.value.state).toBe("cancellation_requested");
  });
  it("a review nonce lives five minutes", () => {
    expect(REVIEW_TTL_MS).toBe(300_000);
    expect(reviewExpired("2026-10-03T12:05:00Z", "2026-10-03T12:04:59Z")).toBe(false);
    expect(reviewExpired("2026-10-03T12:05:00Z", "2026-10-03T12:05:00Z")).toBe(true);
    expect(reviewExpired("garbage", "2026-10-03T12:05:00Z")).toBe(true);
  });
});
