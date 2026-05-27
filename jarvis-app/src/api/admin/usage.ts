import { requireAdmin, svcHeaders, json } from "../_admin";
import { usageFromUsers, type RawUser } from "../../src/admin/adminCompute";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;
  const { ctx } = gate;

  const ur = await fetch(`${ctx.url}/auth/v1/admin/users?per_page=200`, { headers: svcHeaders(ctx) });
  if (!ur.ok) return json({ error: "Could not load usage" }, 502);
  const raw = (((await ur.json()) as { users?: RawUser[] }).users) || [];

  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const cr = await fetch(`${ctx.url}/rest/v1/ai_usage?created_at=gte.${since}&select=id`, {
    headers: { ...svcHeaders(ctx), Prefer: "count=exact", Range: "0-0" },
  });
  const range = cr.headers.get("content-range") || "*/0";
  const aiCalls = parseInt(range.split("/")[1] || "0", 10) || 0;

  return json(usageFromUsers(raw, aiCalls));
}
