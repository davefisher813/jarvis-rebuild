import { describe, it, expect } from "vitest";
import { mapUsers, usageFromUsers, monthlyRevenue, spendByUser } from "./adminCompute";

const NOW = new Date("2026-05-26T00:00:00Z").getTime();

describe("adminCompute", () => {
  it("maps users with role, plan, and ban status", () => {
    const out = mapUsers(
      [{ id: "a", email: "a@x.com", created_at: "2026-05-01T00:00:00Z", banned_until: "2099-01-01T00:00:00Z" },
       { id: "b", email: "b@x.com", created_at: "2026-05-20T00:00:00Z" }],
      [{ owner_id: "a", data: { role: "admin", plan: "Pro" } }], NOW);
    expect(out[0]).toMatchObject({ email: "a@x.com", role: "admin", plan: "Pro", status: "disabled" });
    expect(out[1]).toMatchObject({ role: "user", plan: "Free", status: "active" });
  });
  it("computes usage windows", () => {
    const u = usageFromUsers(
      [{ id: "a", created_at: "2026-05-24T00:00:00Z", last_sign_in_at: "2026-05-25T00:00:00Z" },
       { id: "b", created_at: "2026-01-01T00:00:00Z", last_sign_in_at: "2026-01-02T00:00:00Z" }], 7, NOW);
    expect(u).toMatchObject({ totalUsers: 2, activeUsers: 1, signups7d: 1, aiCalls30d: 7 });
    // UP-PLAT-04 (2026-09-06): with no cost ledger read, the cost is null and
    // the spend list is empty. Not a zero: nothing was measured.
    expect(u.aiCost30d).toBeNull();
    expect(u.spend).toEqual([]);
  });
  it("normalizes Stripe subscriptions to monthly revenue", () => {
    const b = monthlyRevenue([
      { status: "active", items: { data: [{ price: { unit_amount: 1200, recurring: { interval: "month" } } }] } },
      { status: "active", items: { data: [{ price: { unit_amount: 12000, recurring: { interval: "year" } } }] } },
      { status: "trialing", items: { data: [{ price: { unit_amount: 1200, recurring: { interval: "month" } } }] } },
    ]);
    expect(b).toEqual({ mrr: 22, activeSubs: 2, trialing: 1, currency: "USD" });
  });
});

// UP-PLAT-04 (2026-09-06): "a runaway kind is visible the day it starts."
// ai_tokens had been written on every call since migration 0026 and read by
// nothing, so one account burning the bill looked like a quiet month until the
// invoice arrived.
describe("AI spend per account (UP-PLAT-04)", () => {
  const users = [
    { id: "a", email: "a@x.com", created_at: "2026-05-24T00:00:00Z" },
    { id: "b", email: "b@x.com", created_at: "2026-05-24T00:00:00Z" },
  ];

  it("ranks accounts by spend, biggest first", () => {
    const spend = spendByUser(users, [
      { user_id: "a", model: "claude-sonnet-4-6", input_tokens: 1000, output_tokens: 100 },
      { user_id: "b", model: "claude-sonnet-4-6", input_tokens: 1_000_000, output_tokens: 100_000 },
      { user_id: "b", model: "claude-sonnet-4-6", input_tokens: 1000, output_tokens: 0 },
    ]);
    expect(spend.map((s) => s.email)).toEqual(["b@x.com", "a@x.com"]);
    expect(spend[0]!.calls).toBe(2);
    expect(spend[0]!.usd!).toBeGreaterThan(spend[1]!.usd!);
  });

  it("an account that ran nothing has no row, rather than a row of zeros", () => {
    const spend = spendByUser(users, [{ user_id: "a", model: "claude-sonnet-4-6", input_tokens: 10, output_tokens: 1 }]);
    expect(spend).toHaveLength(1);
    expect(spend[0]!.id).toBe("a");
  });

  it("a model this build cannot price shows tokens with a null cost, never a zero", () => {
    const spend = spendByUser(users, [{ user_id: "a", model: "something-new", input_tokens: 90_000, output_tokens: 900 }]);
    expect(spend[0]!.usd).toBeNull();
    expect(spend[0]!.calls).toBe(1);
  });

  it("spend logged by an account that no longer exists is still spend", () => {
    const spend = spendByUser(users, [{ user_id: "gone", model: "claude-sonnet-4-6", input_tokens: 10, output_tokens: 1 }]);
    expect(spend[0]!.email).toBe("(deleted account)");
  });
});
