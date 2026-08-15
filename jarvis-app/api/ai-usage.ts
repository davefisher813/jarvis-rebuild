// Vercel Edge function: What Ran (AI Control, addendum item 20). Returns the
// caller's OWN AI usage for today: a flat count and a plain list of
// {at, kind}. ai_usage is service-role only (0019/0021), so the app cannot
// read it directly; this endpoint verifies the caller and reads their rows
// with the service key. Nothing here is editable: the call count is a fact.
export const config = { runtime: "edge" };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const supaUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supaAnon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!token || !supaUrl || !supaAnon) return json({ error: "Unauthorized" }, 401);
  const who = await fetch(`${supaUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: supaAnon },
  });
  if (!who.ok) return json({ error: "Unauthorized" }, 401);
  const me = (await who.json()) as { id?: string };
  if (!me.id) return json({ error: "Unauthorized" }, 401);

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Without the service key there is no usage log at all (the proxy shouts
  // about that state on every call). Honest null, not a fake zero.
  if (!serviceKey) return json({ count: null, calls: [] });

  // "Today" is the last 24 hours, matching the global cap's window, so the
  // number the user sees moves the same way the limit does.
  const since = new Date(Date.now() - 86400000).toISOString();
  const r = await fetch(
    `${supaUrl}/rest/v1/ai_usage?user_id=eq.${me.id}&created_at=gte.${since}&select=created_at,kind&order=created_at.desc&limit=200`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
  );
  if (!r.ok) return json({ count: null, calls: [] });
  const rows = (await r.json()) as { created_at: string; kind?: string }[];
  return json({
    count: rows.length,
    calls: rows.map((x) => ({ at: x.created_at, kind: x.kind || "" })),
  });
}
