import { requireAdmin, json } from "../_admin";
import { monthlyRevenue, type StripeSub } from "../../src/admin/adminCompute";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return json({ mrr: 0, activeSubs: 0, trialing: 0, currency: "USD" });

  const sr = await fetch("https://api.stripe.com/v1/subscriptions?status=all&limit=100", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!sr.ok) return json({ mrr: 0, activeSubs: 0, trialing: 0, currency: "USD" });
  const subs = (((await sr.json()) as { data?: StripeSub[] }).data) || [];
  return json(monthlyRevenue(subs));
}
