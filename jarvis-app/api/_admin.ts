// Shared helpers for the /api/admin endpoints.
//
// SECURITY: the caller must be a signed-in user whose id is on the server-side
// allowlist (ADMIN_USER_IDS env var, comma-separated Supabase user ids). The
// old check trusted profile.data.role === "admin", but that field lives in
// client-writable JSONB, so any user could self-promote. Never gate admin on
// anything the client can write.

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

  // Server-only allowlist of admin user ids. If unset, ALL admin access is
  // denied (fail closed), so a missing env var can never open the door.
  const admins = (process.env.ADMIN_USER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (admins.length === 0) return { ok: false, res: json({ error: "Forbidden" }, 403) };

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return { ok: false, res: json({ error: "Unauthorized" }, 401) };

  const who = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: anon } });
  if (!who.ok) return { ok: false, res: json({ error: "Unauthorized" }, 401) };
  const me = (await who.json()) as { id?: string };
  if (!me.id) return { ok: false, res: json({ error: "Unauthorized" }, 401) };

  if (!admins.includes(me.id)) return { ok: false, res: json({ error: "Forbidden" }, 403) };

  return { ok: true, ctx: { url, serviceKey, anon } };
}
