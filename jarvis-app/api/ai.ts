// Vercel Edge function: the ONLY place that calls Anthropic. The API key stays
// server-side (set ANTHROPIC_API_KEY in Vercel). Requires a signed-in user,
// enforces the cost bounds below, then forwards the request.
//
// READ THIS BEFORE TRUSTING THE CAPS: bounds 1 and 2 are enforced only when
// SUPABASE_SERVICE_ROLE_KEY is set. Without it the whole rate-limit block is
// skipped and this endpoint serves an authenticated user an UNLIMITED number
// of Anthropic calls. The size caps still apply, so a request cannot be large,
// but nothing stops it being frequent. That is a config gap, not a code one,
// and it used to fail silently; it now shouts into the Vercel logs on every
// request. Deliberately not a hard failure: taking AI offline across the whole
// app because one env var is missing is worse than serving uncapped while the
// logs are screaming. Revisit that tradeoff before public launch, when the
// blast radius stops being one person.
//
// The bounds:
//   1. per-user hourly cap   (AI_RATE_PER_HOUR, default 120)
//   2. global daily ceiling  (AI_GLOBAL_PER_DAY, default 2000) - the kill switch
//   3. input size cap        (AI_MAX_INPUT_BYTES, default 32768) + output cap
// Usage is logged BEFORE the upstream call so a failed or concurrent call can
// never slip under the counter (the old version logged after, which under-counted).
export const config = { runtime: "edge" };

import { aiCallAllowed, normalizeLevel, refusalMessage, DEFAULT_AI_LEVEL } from "../src/ai/aiGate";
import { schemaOk, toolPayload, extractText } from "../src/ai/structured";
import { tokenRow } from "../src/ai/tokenLog";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.AI_MODEL || "claude-sonnet-4-6";
// Routing (Email 2): words that go out in the USER'S voice earn the strongest
// model; classification and extraction stay on the default. Unset, both tiers
// are the same model, so this costs nothing until AI_MODEL_WRITE is set.
const WRITE_MODEL = process.env.AI_MODEL_WRITE || MODEL;
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
  let body: { messages?: unknown; system?: unknown; tier?: unknown; kind?: unknown; background?: unknown; schema?: unknown };
  try {
    body = JSON.parse(raw) as { messages?: unknown; system?: unknown; tier?: unknown; kind?: unknown; background?: unknown; schema?: unknown };
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  // Structured outputs (item 12): a caller-supplied JSON schema turns the
  // upstream request into a forced tool call, so the reply is valid JSON by
  // construction. A malformed schema is a client bug and gets a loud 400, not
  // a silent fall back to prose the caller will then fail to parse.
  if (body.schema !== undefined && !schemaOk(body.schema)) {
    return json({ error: "Bad schema" }, 400);
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) return json({ error: "No messages" }, 400);
  if (!visionShapeOk(messages)) return json({ error: "Bad request" }, 400);
  if (countImages(messages) === 0 && raw.length > maxInput) return json({ error: "Request too large" }, 413);
  // What the call says it is. kind feeds What Ran (a short slug, bounded and
  // cleaned here because clients lie); background marks anything the user did
  // not just ask for, which is what AI Control gates hardest.
  const kind = typeof body.kind === "string" ? body.kind.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32) : "";
  const background = body.background === true;

  // AI CONTROL, SERVER SIDE (addendum item 21). The stored profile is the
  // authority, read with the CALLER'S token under RLS, so this works with or
  // without a service key and can only ever see the caller's own record. A
  // client bug (or a hostile client) cannot spend AI the user turned off,
  // because the refusal happens here, before admission and before counting.
  // If the profile cannot be read the default level applies (draft): taking
  // AI down on a transient read failure would hurt more than it protects,
  // and Off is enforced the moment the read succeeds again.
  let aiLevel = DEFAULT_AI_LEVEL;
  try {
    const pr = await fetch(
      `${supaUrl}/rest/v1/item?entity_type=eq.profile&select=data&order=updated_at.desc&limit=1`,
      { headers: { apikey: supaAnon, Authorization: `Bearer ${token}` } },
    );
    if (pr.ok) {
      const rows = (await pr.json()) as { data?: { ai?: { level?: unknown } } }[];
      aiLevel = normalizeLevel(rows[0]?.data?.ai?.level);
    }
  } catch { /* default level applies; see above */ }
  if (!aiCallAllowed(aiLevel, background)) {
    return json({ error: refusalMessage(aiLevel, background) }, 403);
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const globalCap = parseInt(process.env.AI_GLOBAL_PER_DAY || "2000", 10);
  const cap = parseInt(process.env.AI_RATE_PER_HOUR || "120", 10);
  let counted = false;
  if (!serviceKey) {
    // The one path where this endpoint has no frequency limit at all. Silence
    // here is how an uncapped proxy stays uncapped for months.
    console.error(
      "[ai] SUPABASE_SERVICE_ROLE_KEY is not set: per-user and global AI rate limits are NOT being enforced. Serving uncapped.",
    );
    // The launch lever (audit 2026-08-07): with AI_REQUIRE_LIMITS=1 set, a
    // missing service key fails CLOSED instead of serving uncapped. Off by
    // default on purpose: while the blast radius is one person, taking AI
    // down app-wide over an env var is the worse failure. Flip it on before
    // Track 3, when "uncapped" means every user at once, and the flip is a
    // dashboard toggle instead of a code change.
    if (process.env.AI_REQUIRE_LIMITS === "1") {
      return json({ error: "AI is temporarily unavailable. Try again later." }, 503);
    }
  }
  if (serviceKey) {
    const svcJson = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "content-type": "application/json" };
    // Airtight path: one atomic check-and-record in the database (migration
    // 0013). Exact under concurrency. If the function isn't installed yet the
    // call 404s and we fall back to the legacy two-step check below.
    const rpc = await fetch(`${supaUrl}/rest/v1/rpc/ai_try_consume`, {
      method: "POST",
      headers: svcJson,
      body: JSON.stringify({ p_user: me.id, p_user_cap: cap, p_global_cap: globalCap, p_kind: kind }),
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
  //
  // Since migration 0019 the table is service-role only (no user policies),
  // so this legacy fallback writes with the service key. Without a service
  // key nothing can record usage; the uncapped-proxy console.error above has
  // already shouted about that state.
  try {
    if (!counted && serviceKey) await fetch(`${supaUrl}/rest/v1/ai_usage`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "content-type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ user_id: me.id, kind }),
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
      model: body.tier === "write" ? WRITE_MODEL : MODEL,
      max_tokens: MAX_TOKENS,
      ...(typeof body.system === "string" ? { system: body.system } : {}),
      ...(schemaOk(body.schema) ? toolPayload(body.schema) : {}),
      messages,
    }),
  });
  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    return json({ error: "Upstream error", detail }, 502);
  }
  const data = (await upstream.json()) as {
    content?: { type: string; text?: string; name?: string; input?: unknown }[];
    usage?: { input_tokens?: unknown; output_tokens?: unknown };
  };

  // Token accounting (item 12): record what this call actually cost, into
  // ai_tokens (migration 0026), service-role only, best effort. A failed or
  // impossible accounting write never blocks a served reply; until 0026 runs
  // this insert 404s quietly and the app behaves exactly as before.
  try {
    const model = body.tier === "write" ? WRITE_MODEL : MODEL;
    const row = tokenRow(me.id, kind, model, data.usage);
    if (row && serviceKey) {
      await fetch(`${supaUrl}/rest/v1/ai_tokens`, {
        method: "POST",
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "content-type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(row),
      });
    }
  } catch { /* accounting must never break the reply */ }

  // extractText returns the forced tool call's input stringified when a
  // schema rode along, and the joined text blocks otherwise: the { text }
  // envelope every existing client parses stays exactly the same shape.
  return json({ text: extractText(data.content) });
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
