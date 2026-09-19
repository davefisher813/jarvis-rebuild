// TRACK 3, FROM THE SIGNED-IN SIDE (2026-09-19).
//
// Two endpoints now need the same three things: the Track 3 credentials, proof
// of who the caller is, and the handful of REST verbs against that project.
// This is that floor, lifted out of api/booking-link.ts unchanged rather than
// copied, because the interesting part of it is a security check and a second
// copy of a security check is a second thing to get wrong.
//
// THE BRIDGE, RESTATED. Track 3's policies expect Clerk and Clerk is not
// wired. It does not block anything the one signed-in user does, because the
// SESSION can come from the live project while the STORAGE is Track 3: the
// caller is verified against the live project exactly the way the admin
// endpoints do, and their live user id is then used as `owner_id`, which is a
// bare uuid in this schema with no foreign key behind it. What still needs
// Clerk is what actually needs it, connections and shared projects, where two
// real user ids have to see each other under RLS.

export function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export interface Ctx { t3: string; key: string; owner: string }

/** The caller, proven against the LIVE project, and the Track 3 credentials to
 *  act on their behalf. Fails closed at every step: a missing variable is a
 *  503 and never a fallback to some other project. */
export async function who(req: Request): Promise<{ ok: true; ctx: Ctx } | { ok: false; res: Response }> {
  const t3 = process.env.TRACK3_SUPABASE_URL || "";
  const key = process.env.TRACK3_SUPABASE_SERVICE_ROLE_KEY || "";
  if (!t3 || !key) return { ok: false, res: json({ error: "Booking is not set up" }, 503) };

  const live = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
  if (!live || !anon) return { ok: false, res: json({ error: "Not configured" }, 503) };

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { ok: false, res: json({ error: "Unauthorized" }, 401) };
  const r = await fetch(`${live}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: anon } });
  if (!r.ok) return { ok: false, res: json({ error: "Unauthorized" }, 401) };
  const me = (await r.json()) as { id?: string };
  if (!me.id) return { ok: false, res: json({ error: "Unauthorized" }, 401) };

  return { ok: true, ctx: { t3, key, owner: me.id } };
}

export const hdrs = (c: Ctx, extra: Record<string, string> = {}): Record<string, string> =>
  ({ apikey: c.key, Authorization: `Bearer ${c.key}`, "content-type": "application/json", ...extra });

export async function sel<T>(c: Ctx, path: string): Promise<T[]> {
  const r = await fetch(`${c.t3}/rest/v1/${path}`, { headers: hdrs(c) });
  if (!r.ok) throw new Error(`select ${path}: ${r.status}`);
  return (await r.json()) as T[];
}

export async function ins<T>(c: Ctx, table: string, body: unknown): Promise<T[]> {
  const r = await fetch(`${c.t3}/rest/v1/${table}`, {
    method: "POST", headers: hdrs(c, { Prefer: "return=representation" }), body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`insert ${table}: ${r.status}`);
  return (await r.json()) as T[];
}

export async function patch(c: Ctx, path: string, body: unknown): Promise<void> {
  const r = await fetch(`${c.t3}/rest/v1/${path}`, { method: "PATCH", headers: hdrs(c), body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`patch ${path}: ${r.status}`);
}

export async function del(c: Ctx, path: string): Promise<void> {
  const r = await fetch(`${c.t3}/rest/v1/${path}`, { method: "DELETE", headers: hdrs(c) });
  if (!r.ok) throw new Error(`delete ${path}: ${r.status}`);
}

/** The caller's org, made once. Every Track 3 row hangs off an org, so this is
 *  the root the rest of it needs; a personal one is created the first time
 *  rather than demanded up front. */
export async function orgOf(c: Ctx): Promise<string> {
  const mine = await sel<{ org_id: string }>(c, `org_members?user_id=eq.${c.owner}&select=org_id&limit=1`);
  if (mine[0]) return mine[0].org_id;
  const made = await ins<{ id: string }>(c, "orgs", { name: "Personal", template: "personal" });
  const org = made[0]!.id;
  await ins(c, "org_members", { org_id: org, user_id: c.owner, role: "owner" });
  return org;
}
