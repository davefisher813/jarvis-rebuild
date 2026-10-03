import { describe, it, expect } from "vitest";
import { runOutbox, runOutboxOnce, UNKNOWN_LINE, type ClaimedCommand, type DispatchOutcome, type WorkerDeps } from "./worker";

const at = <T,>(xs: T[], i: number): T => { const x = xs[i]; if (x === undefined) throw new Error(`no item ${i}`); return x; };
const claimed: ClaimedCommand = {
  outbox_id: "ob-1", action_id: "act-1", owner_id: "u-a", kind: "send_email", payload: { to: ["coach@example.test"] }, payload_hash: "h",
  provider_account_id: "acct-1", claim_token: "tok-1", attempt: 1, lease_until: "2026-10-03T12:02:00Z",
};

interface Fake { deps: WorkerDeps; calls: Array<{ fn: string; args: Record<string, unknown> | undefined }>; dispatched: ClaimedCommand[] }

function fake(opts: { claim?: unknown[]; dispatchedOk?: boolean; outcome?: DispatchOutcome | Error } = {}): Fake {
  const calls: Fake["calls"] = [];
  const dispatched: ClaimedCommand[] = [];
  const claims = [...(opts.claim ?? [claimed, null])];
  const deps: WorkerDeps = {
    worker: "test",
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (fn === "outbox_claim") return { data: claims.length ? claims.shift() : null, error: null };
      if (fn === "outbox_dispatched") return { data: opts.dispatchedOk ?? true, error: null };
      if (fn === "outbox_settle") return { data: { outbox_id: "ob-1", state: (args as { p_state: string }).p_state }, error: null };
      return { data: null, error: { message: "unknown fn" } };
    },
    dispatch: async (cmd) => {
      dispatched.push(cmd);
      if (opts.outcome instanceof Error) throw opts.outcome;
      return opts.outcome ?? { kind: "ack", ack: { id: "18f3" }, verb: "Sent reply to coach@example.test" };
    },
  };
  return { deps, calls, dispatched };
}

const settleArgs = (f: Fake) => f.calls.find((c) => c.fn === "outbox_settle")?.args;

describe("the outbox worker", () => {
  it("claim, mark dispatched, call the provider, settle confirmed with the ack", async () => {
    const f = fake();
    const r = await runOutboxOnce(f.deps);
    expect(f.calls.map((c) => c.fn)).toEqual(["outbox_claim", "outbox_dispatched", "outbox_settle"]);
    expect(at(f.calls, 0).args).toEqual({ p_worker: "test", p_lease: "2 Minutes" });
    expect(at(f.calls, 1).args).toEqual({ p_outbox: "ob-1", p_claim_token: "tok-1" });
    expect(settleArgs(f)).toEqual({ p_outbox: "ob-1", p_claim_token: "tok-1", p_state: "confirmed", p_verb: "Sent reply to coach@example.test", p_provider_ack: { id: "18f3" }, p_error: null });
    expect(r).toEqual({ handled: true, outbox_id: "ob-1", action_id: "act-1", state: "confirmed" });
    expect(f.dispatched).toHaveLength(1);
  });

  it("nothing queued: handled false, no provider call", async () => {
    const f = fake({ claim: [null] });
    expect(await runOutboxOnce(f.deps)).toEqual({ handled: false });
    expect(f.dispatched).toHaveLength(0);
  });

  it("a claim the database skipped (expired approval, reauth) is reported, never dispatched", async () => {
    const f = fake({ claim: [{ skipped: "ob-9", reason: "APPROVAL_EXPIRED" }] });
    expect(await runOutboxOnce(f.deps)).toEqual({ handled: true, outbox_id: "ob-9", skipped: "APPROVAL_EXPIRED" });
    expect(f.dispatched).toHaveLength(0);
    expect(f.calls.map((c) => c.fn)).toEqual(["outbox_claim"]);
  });

  it("a lost lease at the one-way step means nothing leaves", async () => {
    const f = fake({ dispatchedOk: false });
    const r = await runOutboxOnce(f.deps);
    expect(r).toEqual({ handled: true, outbox_id: "ob-1", action_id: "act-1", state: "lease_lost" });
    expect(f.dispatched).toHaveLength(0);
    expect(settleArgs(f)).toBeUndefined();
  });

  it("a definitive refusal settles as failed with its code", async () => {
    const f = fake({ outcome: { kind: "refused", code: "GMAIL_400_INVALID_RECIPIENT", verb: "Not Sent · Gmail Refused the Address" } });
    const r = await runOutboxOnce(f.deps);
    expect(r).toMatchObject({ state: "failed" });
    expect(settleArgs(f)).toMatchObject({ p_state: "failed", p_error: "GMAIL_400_INVALID_RECIPIENT", p_provider_ack: null });
  });

  it("a throw after the dispatched mark is OUTCOME UNKNOWN, never failed, never retried here", async () => {
    const f = fake({ outcome: new Error("socket hang up") });
    const r = await runOutboxOnce(f.deps);
    expect(r).toMatchObject({ state: "outcome_unknown" });
    expect(settleArgs(f)).toEqual({ p_outbox: "ob-1", p_claim_token: "tok-1", p_state: "outcome_unknown", p_verb: UNKNOWN_LINE, p_provider_ack: null, p_error: "OUTCOME_UNKNOWN" });
    expect(f.dispatched).toHaveLength(1);
  });

  it("an explicit unknown from the provider call is the same", async () => {
    const f = fake({ outcome: { kind: "unknown" } });
    expect(await runOutboxOnce(f.deps)).toMatchObject({ state: "outcome_unknown" });
    expect(settleArgs(f)).toMatchObject({ p_state: "outcome_unknown" });
  });

  it("runOutbox drains until the queue is empty and stops at the cap", async () => {
    const two = fake({ claim: [claimed, { ...claimed, outbox_id: "ob-2", claim_token: "tok-2" }, null] });
    const rs = await runOutbox(two.deps);
    expect(rs.map((r) => (r.handled ? ("state" in r ? r.state : r.skipped) : "empty"))).toEqual(["confirmed", "confirmed", "empty"]);
    const many = fake({ claim: Array.from({ length: 30 }, () => claimed) });
    expect((await runOutbox(many.deps, 3)).length).toBe(3);
  });
});
