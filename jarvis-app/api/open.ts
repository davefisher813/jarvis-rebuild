// Email open tracking endpoint (Email 3). Three jobs, one tiny function:
//
//   GET /api/open?t=<uuid>          the pixel. Returns a 1x1 gif to whoever
//                                   loads it (the recipient's mail client) and
//                                   records the open. NO auth: mail clients
//                                   cannot authenticate. Track ids are
//                                   unguessable uuids; an unknown id records
//                                   nothing.
//   POST /api/open {t}              authed. Registers a just-sent tracked
//                                   email for the signed-in user.
//   POST /api/open {check: [ids]}   authed. Returns first-open times for the
//                                   caller's OWN tracks only.
//
// Honesty limits (surfaced in the UI copy, never overstated): image-blocking
// clients never fire the pixel (real opens missed), and privacy proxies may
// prefetch it (opens recorded early). "Opened" means the pixel loaded, no
// more. The table stores no recipient, subject, or content.
export const config = { runtime: "edge" };

// A transparent 1x1 gif, the classic 43 bytes.
const GIF = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (c) => c.charCodeAt(0));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Best-effort per-IP throttle on the unauthenticated pixel (audit 2026-08-07).
// The pixel MUST stay auth-free (mail clients cannot sign in), so someone who
// holds a valid track id can inflate its open_count; this bounds how fast, and
// stops an id-guessing loop from turning every miss into two DB round-trips.
// Per-isolate memory, so it is a damper rather than a wall: an edge isolate
// that never saw you cannot count you. That is fine, because the endpoint's
// worst case was already bounded work; this just makes hammering it boring.
// The ceiling is deliberately high (120/min) because Gmail's image proxy
// funnels MANY real recipients through FEW IPs; a tight cap here would eat
// real opens, which is worse than admitting a few extra.
const PIXEL_PER_MIN = 120;
const hits = new Map<string, { n: number; t: number }>();
function pixelAllowed(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.t > 60_000) {
    if (hits.size > 5000) hits.clear(); // bound the map; resets are harmless
    hits.set(ip, { n: 1, t: now });
    return true;
  }
  h.n += 1;
  return h.n <= PIXEL_PER_MIN;
}

function gif(): Response {
  return new Response(GIF, {
    status: 200,
    headers: {
      "content-type": "image/gif",
      "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
      "content-length": String(GIF.length),
    },
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function authedUserId(req: Request, supaUrl: string, supaAnon: string): Promise<string | null> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const who = await fetch(`${supaUrl}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: supaAnon } });
  if (!who.ok) return null;
  const me = (await who.json()) as { id?: string };
  return me.id || null;
}

export default async function handler(req: Request): Promise<Response> {
  const supaUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const supaAnon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
  const rest = supaUrl + "/rest/v1/email_opens";
  const svcHeaders = { apikey: service, Authorization: "Bearer " + service, "content-type": "application/json" };

  if (req.method === "GET") {
    // The pixel. ALWAYS answer with the gif, whatever happens server-side: a
    // broken tracker must never break the recipient's email rendering. Over
    // the per-IP throttle the gif still ships and only the recording is
    // skipped, same principle.
    const t = new URL(req.url).searchParams.get("t") || "";
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (UUID_RE.test(t) && supaUrl && service && pixelAllowed(ip)) {
      try {
        const row = await fetch(rest + "?track_id=eq." + t + "&select=track_id,first_open,open_count", { headers: svcHeaders });
        const rows = row.ok ? ((await row.json()) as { first_open: string | null; open_count: number }[]) : [];
        if (rows.length === 1) {
          const patch: Record<string, unknown> = { open_count: (rows[0]!.open_count || 0) + 1 };
          if (!rows[0]!.first_open) patch.first_open = new Date().toISOString();
          await fetch(rest + "?track_id=eq." + t, { method: "PATCH", headers: svcHeaders, body: JSON.stringify(patch) });
        }
        // Unknown id: record nothing, still serve the gif.
      } catch { /* the gif still ships */ }
    }
    return gif();
  }

  if (req.method === "POST") {
    if (!supaUrl || !service || !supaAnon) return json({ error: "Not configured" }, 500);
    const userId = await authedUserId(req, supaUrl, supaAnon);
    if (!userId) return json({ error: "Unauthorized" }, 401);
    let body: { t?: unknown; check?: unknown };
    try {
      body = (await req.json()) as { t?: unknown; check?: unknown };
    } catch {
      return json({ error: "Bad request" }, 400);
    }

    if (typeof body.t === "string" && UUID_RE.test(body.t)) {
      const r = await fetch(rest, {
        method: "POST",
        headers: { ...svcHeaders, Prefer: "resolution=ignore-duplicates" },
        body: JSON.stringify({ track_id: body.t, user_id: userId }),
      });
      return json({ ok: r.ok }, r.ok ? 200 : 500);
    }

    if (Array.isArray(body.check)) {
      const ids = body.check.filter((x): x is string => typeof x === "string" && UUID_RE.test(x)).slice(0, 50);
      if (ids.length === 0) return json({ opens: {} });
      const r = await fetch(
        rest + "?track_id=in.(" + ids.join(",") + ")&user_id=eq." + userId + "&select=track_id,first_open",
        { headers: svcHeaders },
      );
      if (!r.ok) return json({ error: "Lookup failed" }, 500);
      const rows = (await r.json()) as { track_id: string; first_open: string | null }[];
      const opens: Record<string, string> = {};
      for (const row of rows) if (row.first_open) opens[row.track_id] = row.first_open;
      return json({ opens });
    }

    return json({ error: "Bad request" }, 400);
  }

  return json({ error: "Method not allowed" }, 405);
}
