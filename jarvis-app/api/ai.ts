// Vercel Edge function: the ONLY place that calls Anthropic. The API key stays
// server-side (set ANTHROPIC_API_KEY in Vercel). Requires a signed-in user (the
// caller's Supabase access token), caps output size, and forwards the request.
// Real per-user rate limiting (a Supabase-backed counter) is a later add; this
// already gates to authenticated users and bounds cost per call.
export const config = { runtime: "edge" };

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.AI_MODEL || "claude-sonnet-4-6";
const MAX_TOKENS = 1024;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json({ error: "AI not configured on the server" }, 500);

  // Require a Supabase session token, and verify it against Supabase.
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

  // Per-user rate limit. Active once SUPABASE_SERVICE_ROLE_KEY is set (same key
  // the admin endpoints use). Counts this user's AI calls in the last hour from
  // the ai_usage log and rejects over the cap, bounding cost as users scale.
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const cap = parseInt(process.env.AI_RATE_PER_HOUR || "120", 10);
  if (serviceKey && me.id && cap > 0) {
    const since = new Date(Date.now() - 3600000).toISOString();
    const cr = await fetch(
      `${supaUrl}/rest/v1/ai_usage?user_id=eq.${me.id}&created_at=gte.${since}&select=id`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Prefer: "count=exact", Range: "0-0" } });
    const used = parseInt((cr.headers.get("content-range") || "*/0").split("/")[1] || "0", 10) || 0;
    if (used >= cap) return json({ error: "Rate limit reached. Try again shortly." }, 429);
  }

  let body: { messages?: unknown; system?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) return json({ error: "No messages" }, 400);

  const upstream = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      ...(typeof body.system === "string" ? { system: body.system } : {}),
      messages,
    }),
  });
  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    return json({ error: "Upstream error", detail }, 502);
  }
  const data = (await upstream.json()) as { content?: { type: string; text?: string }[] };
  const text = (data.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");

  // Best-effort usage log for admin analytics (user_id defaults to auth.uid()).
  try {
    await fetch(`${supaUrl}/rest/v1/ai_usage`, {
      method: "POST",
      headers: { apikey: supaAnon, Authorization: `Bearer ${token}`, "content-type": "application/json", Prefer: "return=minimal" },
      body: "{}",
    });
  } catch { /* analytics is best-effort; never block the reply */ }

  return json({ text });
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
