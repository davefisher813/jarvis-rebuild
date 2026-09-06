// Send Feedback receiver (UP-LAUNCH-16, 2026-09-05).
//
// Settings > Support > Send Feedback posts here. It is the only support
// channel a TestFlight tester will use, so it has to work before anything
// else does: no account lookup beyond the caller's own token, no dependency
// on mail being configured, and an answer the sheet can act on.
//
// Same shape as the other privileged endpoints (api/ai-usage.ts,
// api/account/delete.ts): edge runtime, the caller's Supabase JWT verified
// against /auth/v1/user with the anon key, then the service-role key for the
// insert. The row is written for the id Supabase returns for that token, so
// nobody can file a message as somebody else.
//
// NOT DONE HERE, deliberately: forwarding the message to the support mailbox.
// That needs the transactional sender from UP-LAUNCH-02, which is a Supabase
// SMTP setting only Dave can make. Until it exists the messages land in the
// table and the admin panel's Feedback section is where they are read; when
// it exists, one fetch goes in below the insert. Nothing here pretends the
// mail was sent.
export const config = { runtime: "edge" };

const MAX_TEXT_BYTES = 2048;
const MAX_ERROR_BYTES = 8192;
// Five an hour per account. Enough for a tester having a bad morning, low
// enough that a script cannot fill the table.
const PER_HOUR = 5;

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-max-age": "86400",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...CORS } });
}

const bytes = (s: string) => new TextEncoder().encode(s).length;
const clip = (s: unknown, cap: number): string => {
  const v = typeof s === "string" ? s : "";
  return v.length > cap ? v.slice(0, cap) : v;
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supaUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supaAnon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaAnon || !serviceKey) return json({ error: "Feedback is not configured on the server" }, 500);

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return json({ error: "Unauthorized" }, 401);
  const who = await fetch(`${supaUrl}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: supaAnon } });
  if (!who.ok) return json({ error: "Unauthorized" }, 401);
  const me = (await who.json()) as { id?: string };
  if (!me.id) return json({ error: "Unauthorized" }, 401);

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return json({ error: "Bad request" }, 400); }

  const text = typeof body["text"] === "string" ? body["text"].trim() : "";
  if (!text) return json({ error: "Bad request" }, 400);
  if (bytes(text) > MAX_TEXT_BYTES) return json({ error: "Too long" }, 413);

  const svc = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

  // The rate limit is a count of this user's own rows in the last hour. Not
  // atomic, and it does not need to be: two messages slipping through a race
  // is a person double-tapping Send, not an abuse vector.
  const since = new Date(Date.now() - 3600_000).toISOString();
  const recent = await fetch(
    `${supaUrl}/rest/v1/feedback?user_id=eq.${me.id}&created_at=gte.${since}&select=id`,
    { headers: { ...svc, Prefer: "count=exact", Range: "0-0" } },
  );
  if (recent.ok) {
    const n = parseInt((recent.headers.get("content-range") || "*/0").split("/")[1] || "0", 10) || 0;
    if (n >= PER_HOUR) return json({ error: "Too many messages" }, 429);
  }

  const row = {
    id: crypto.randomUUID(),
    user_id: me.id,
    text,
    build: clip(body["build"], 64),
    device: clip(body["device"], 300),
    template: clip(body["template"], 32),
    last_error: bytes(clip(body["lastError"], MAX_ERROR_BYTES)) > 0 ? clip(body["lastError"], MAX_ERROR_BYTES) : null,
  };

  const ins = await fetch(`${supaUrl}/rest/v1/feedback`, {
    method: "POST",
    headers: { ...svc, "content-type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  // The app says "Sent" only for this branch. A failed insert is a failure,
  // not a message we quietly dropped while thanking them for it.
  if (!ins.ok) return json({ error: "Could not save that" }, 502);
  return new Response(null, { status: 204, headers: CORS });
}
