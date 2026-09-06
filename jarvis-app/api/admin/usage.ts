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

  // UP-PLAT-04 (2026-09-06): the cost ledger for the same window. ai_tokens
  // (migration 0026) has been written on every completed call and read by
  // nothing, so a runaway kind or account was invisible until the invoice.
  // Best effort and bounded: a failed read leaves the counts standing, and
  // the row cap keeps one query from growing without limit. The base select
  // is the pre-0033 column set, so this works either side of that migration.
  const FULL = "user_id,model,input_tokens,output_tokens,cache_read_input_tokens,cache_creation_input_tokens";
  const BASE = "user_id,model,input_tokens,output_tokens";
  let tokenRows: Record<string, unknown>[] = [];
  try {
    const url = (sel: string) => `${ctx.url}/rest/v1/ai_tokens?created_at=gte.${since}&select=${sel}&limit=5000`;
    let tr = await fetch(url(FULL), { headers: svcHeaders(ctx) });
    if (!tr.ok) tr = await fetch(url(BASE), { headers: svcHeaders(ctx) });
    if (tr.ok) tokenRows = (await tr.json()) as Record<string, unknown>[];
  } catch { /* the counts stand on their own */ }

  return json(usageFromUsers(raw, aiCalls, Date.now(), tokenRows));
}
