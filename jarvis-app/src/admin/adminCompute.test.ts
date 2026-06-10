import { describe, it, expect } from "vitest";
import { mapUsers, usageFromUsers, monthlyRevenue } from "./adminCompute";

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
    expect(u).toEqual({ totalUsers: 2, activeUsers: 1, signups7d: 1, aiCalls30d: 7 });
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
