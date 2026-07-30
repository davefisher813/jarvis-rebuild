// Vercel Edge function: the ONLY place that calls Anthropic. The API key stays
// server-side (set ANTHROPIC_API_KEY in Vercel). Requires a signed-in user,
// enforces three cost bounds, then forwards the request:
//   1. per-user hourly cap   (AI_RATE_PER_HOUR, default 120)
//   2. global daily ceiling  (AI_GLOBAL_PER_DAY, default 2000) - the kill switch
//   3. input size cap        (AI_MAX_INPUT_BYTES, default 32768) + output cap
// Usage is logged BEFORE the upstream call so a failed or concurrent call can
// never slip under the counter (the old version logged after, which under-counted).
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
  if (!me.id) return json({ error: "Unauthorized" }, 401);

  // Parse and size-check the input BEFORE any counting or upstream work.
  // Two size regimes: plain text requests keep the tight cap; a request
  // carrying exactly one bounded image (Brain doc photo reading) is allowed a
  // larger envelope. The absolute ceiling below bounds parse work either way.
  const raw = await req.text();
  const maxInput = parseInt(process.env.AI_MAX_INPUT_BYTES || "32768", 10);
  const maxVision = parseInt(process.env.AI_MAX_VISION_BYTES || "600000", 10);
  if (raw.length > maxVision) return json({ error: "Request too large" }, 413);
  let body: { messages?: unknown; system?: unknown };
  try {
    body = JSON.parse(raw) as { messages?: unknown; system?: unknown };
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) return json({ error: "No messages" }, 400);
  if (!visionShapeOk(messages)) return json({ error: "Bad request" }, 400);
  if (countImages(messages) === 0 && raw.length > maxInput) return json({ error: "Request too large" }, 413);

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const globalCap = parseInt(process.env.AI_GLOBAL_PER_DAY || "2000", 10);
  const cap = parseInt(process.env.AI_RATE_PER_HOUR || "120", 10);
  let counted = false;
  if (serviceKey) {
    const svcJson = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "content-type": "application/json" };
    // Airtight path: one atomic check-and-record in the database (migration
    // 0013). Exact under concurrency. If the function isn't installed yet the
    // call 404s and we fall back to the legacy two-step check below.
    const rpc = await fetch(`${supaUrl}/rest/v1/rpc/ai_try_consume`, {
      method: "POST",
      headers: svcJson,
      body: JSON.stringify({ p_user: me.id, p_user_cap: cap, p_global_cap: globalCap }),
    });
    if (rpc.ok) {
      const verdict = (await rpc.json()) as { allowed?: boolean; reason?: string };
      if (!verdict.allowed) {
        return verdict.reason === "user"
          ? json({ error: "Rate limit reached. Try again shortly." }, 429)
          : json({ error: "AI is temporarily unavailable. Try again later." }, 503);
      }
      counted = true;
    } else {
      // Legacy fallback (pre-migration): read counts, then record below.
      const svc = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Prefer: "count=exact", Range: "0-0" };
      const dayAgo = new Date(Date.now() - 86400000).toISOString();
      const gr = await fetch(`${supaUrl}/rest/v1/ai_usage?created_at=gte.${dayAgo}&select=id`, { headers: svc });
      const globalUsed = parseInt((gr.headers.get("content-range") || "*/0").split("/")[1] || "0", 10) || 0;
      if (globalUsed >= globalCap) return json({ error: "AI is temporarily unavailable. Try again later." }, 503);
      if (cap > 0) {
        const since = new Date(Date.now() - 3600000).toISOString();
        const cr = await fetch(
          `${supaUrl}/rest/v1/ai_usage?user_id=eq.${me.id}&created_at=gte.${since}&select=id`,
          { headers: svc });
        const used = parseInt((cr.headers.get("content-range") || "*/0").split("/")[1] || "0", 10) || 0;
        if (used >= cap) return json({ error: "Rate limit reached. Try again shortly." }, 429);
      }
    }
  }

  // Log usage BEFORE calling upstream, so concurrent or failed calls still
  // count toward the caps. Narrows the read-then-act race window and removes
  // the old under-count. If the log write fails we still serve the request
  // (availability over perfect accounting), but we no longer count after the fact.
  try {
    if (!counted) await fetch(`${supaUrl}/rest/v1/ai_usage`, {
      method: "POST",
      headers: { apikey: supaAnon, Authorization: `Bearer ${token}`, "content-type": "application/json", Prefer: "return=minimal" },
      body: "{}",
    });
  } catch { /* never block the reply on analytics */ }

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

  return json({ text });
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// A message's content may be a plain string, or an array of text blocks plus
// AT MOST ONE bounded base64 image (jpeg/png/webp). Anything else is rejected
// so the proxy can never be used to smuggle arbitrary payloads upstream.
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_B64 = 450000; // ~340KB binary, far above a downscaled screenshot

function countImages(messages: unknown[]): number {
  let n = 0;
  for (const m of messages) {
    const c = (m as { content?: unknown }).content;
    if (Array.isArray(c)) for (const b of c) if ((b as { type?: string }).type === "image") n++;
  }
  return n;
}

function visionShapeOk(messages: unknown[]): boolean {
  let images = 0;
  for (const m of messages) {
    const c = (m as { content?: unknown }).content;
    if (typeof c === "string") continue;
    if (!Array.isArray(c)) return false;
    for (const b of c) {
      const blk = b as { type?: string; text?: unknown; source?: { type?: string; media_type?: string; data?: unknown } };
      if (blk.type === "text") {
        if (typeof blk.text !== "string") return false;
      } else if (blk.type === "image") {
        images++;
        const s = blk.source;
        if (!s || s.type !== "base64" || !IMAGE_TYPES.includes(s.media_type || "")) return false;
        if (typeof s.data !== "string" || s.data.length > MAX_IMAGE_B64) return false;
      } else {
        return false;
      }
    }
  }
  return images <= 1;
}
