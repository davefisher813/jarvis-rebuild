// Client error receiver (PLUMB-F-11, 2026-09-05). The app's monitor seam
// POSTs one JSON report per caught error here when VITE_ERROR_SINK points
// at it. The receiver writes the report to the function log with a fixed
// prefix, so "what failed on the phone this week" is a log search in the
// Vercel dashboard instead of a guess. No table, no service key, no SDK: the
// log is retained by the host and that is enough of a record for now.
//
// NO auth, on purpose: the launch gate and the boot path can fail before
// there is a session, and those are exactly the crashes worth seeing. The
// cost is bounded instead: a per-IP throttle and a body cap, the same
// posture as the open-tracking pixel.
export const config = { runtime: "edge" };

const MAX_BODY = 16_384;
const PER_MIN = 60;
const hits = new Map<string, { n: number; t: number }>();

function allowed(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.t > 60_000) {
    if (hits.size > 5000) hits.clear();
    hits.set(ip, { n: 1, t: now });
    return true;
  }
  h.n += 1;
  return h.n <= PER_MIN;
}

// The native build posts from capacitor://localhost, which is a different
// origin from the API, so the browser sends a preflight first. Answering it
// is what lets a report from the phone land at all.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

function reply(status: number): Response {
  return new Response(null, { status, headers: CORS });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return reply(204);
  if (req.method !== "POST") return reply(405);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!allowed(ip)) return reply(429);

  let text: string;
  try {
    text = await req.text();
  } catch {
    return reply(400);
  }
  if (text.length === 0 || text.length > MAX_BODY) return reply(413);

  let report: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return reply(400);
    report = parsed as Record<string, unknown>;
  } catch {
    return reply(400);
  }

  // One line per report, JSON, fixed prefix. The host's log viewer is the
  // reader, so the shape is optimised for a search box: prefix, build, name,
  // then the report as sent. The IP is used for the throttle only and is not
  // written: the record is about the failure, not the person.
  console.error(
    "[jarvis-client-error]",
    String(report.build ?? "?"),
    String(report.name ?? "Error"),
    JSON.stringify(report),
  );
  return reply(204);
}
