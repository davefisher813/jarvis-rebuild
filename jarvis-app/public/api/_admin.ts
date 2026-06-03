// Shared helpers for the /api/admin endpoints. Verifies the caller is a signed-in
// admin (profile.role === "admin") using the Supabase service role, which bypasses
// RLS. The service-role key is server-only (SUPABASE_SERVICE_ROLE_KEY in Vercel).

export interface AdminCtx { url: string; serviceKey: string; anon: string }

export function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

export function svcHeaders(ctx: AdminCtx): Record<string, string> {
  return { apikey: ctx.serviceKey, Authorization: `Bearer ${ctx.serviceKey}` };
}

export async function requireAdmin(
  req: Request,
): Promise<{ ok: true; ctx: AdminCtx } | { ok: false; res: Response }> {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !anon || !serviceKey) return { ok: false, res: json({ error: "Admin not configured" }, 500) };

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return { ok: false, res: json({ error: "Unauthorized" }, 401) };

  const who = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: anon } });
  if (!who.ok) return { ok: false, res: json({ error: "Unauthorized" }, 401) };
  const me = (await who.json()) as { id?: string };
  if (!me.id) return { ok: false, res: json({ error: "Unauthorized" }, 401) };

  const ctx: AdminCtx = { url, serviceKey, anon };
  const prof = await fetch(
    `${url}/rest/v1/item?owner_id=eq.${me.id}&entity_type=eq.profile&select=data`,
    { headers: svcHeaders(ctx) });
  const rows = prof.ok ? ((await prof.json()) as { data?: { role?: string } }[]) : [];
  if (!rows.some((r) => r.data?.role === "admin")) return { ok: false, res: json({ error: "Forbidden" }, 403) };
  return { ok: true, ctx };
}
