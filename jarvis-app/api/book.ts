import { openSlots, type Busy, type Override, type Rule } from "../src/booking/slots";
import { sendBookingReceipt } from "./_receipt";

// PUBLIC BOOKING (Track 3, 2026-09-19).
//
//   GET  /api/book?slug=<slug>            the open slots on a link, for a
//                                         stranger with no account.
//   POST /api/book {slug, startMs, name, email, timezone}
//                                         takes one of them.
//
// NO AUTH, on purpose: the whole point of a booking link is that the person
// holding it does not have an account here. That makes this the most exposed
// surface in the app, so it is written the way an exposed surface has to be.
//
//   - It runs against the Track 3 project through its OWN env vars, and this
//     file names no live-project credential anywhere. That is a discipline
//     about what the public endpoint does, not a wall: every function in a
//     deployment can read every variable. The confirmation needs the host's
//     mail grant, which lives in the live project, and that one exception is
//     quarantined in api/_receipt.ts, where its whole surface is one function
//     that reads one row and sends one message.
//   - It fails CLOSED. With the env unset it answers 503 and writes nothing,
//     rather than falling back to some other project.
//   - It never trusts the client's arithmetic. The client sends a start; the
//     server recomputes the grid and refuses a start that is not on it.
//     The slot list is a convenience, not an authorization.
//   - The database is the arbiter of the race. Two strangers can take the
//     same slot in the same second; the exclusion constraint on `bookings`
//     rejects the second, and this turns that rejection into "someone just
//     took it" rather than a 500.
//   - A link that is not public answers 404, not 403: whether a private slug
//     exists is itself worth not saying.
export const config = { runtime: "edge" };

const MAX_DAYS = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

interface Ctx { url: string; key: string }
function ctx(): Ctx | null {
  const url = process.env.TRACK3_SUPABASE_URL || "";
  const key = process.env.TRACK3_SUPABASE_SERVICE_ROLE_KEY || "";
  return url && key ? { url, key } : null;
}
function headers(c: Ctx): Record<string, string> {
  return { apikey: c.key, Authorization: `Bearer ${c.key}`, "content-type": "application/json" };
}
async function rows<T>(c: Ctx, path: string): Promise<T[]> {
  const r = await fetch(`${c.url}/rest/v1/${path}`, { headers: headers(c) });
  if (!r.ok) throw new Error(`select ${path}: ${r.status}`);
  return (await r.json()) as T[];
}

// Best-effort per-IP damper on an endpoint that cannot ask who you are. Per
// isolate, so it is a damper and not a wall; the ceiling is well above what
// a person booking a meeting does and well below what a script does.
const PER_MIN = 30;
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

interface LinkRow {
  id: string; org_id: string; owner_id: string; visibility: string;
  bookable_type_id: string | null;
  bookable_types: {
    id: string; name: string; duration_min: number;
    buffer_before_min: number; buffer_after_min: number;
    min_notice_hours: number; max_per_day: number | null;
  } | null;
}

/** The link, its type, the owner's rules and what is already booked: one
 *  shape both the GET and the POST decide from, so they cannot disagree
 *  about what is open. */
async function grid(c: Ctx, slug: string, nowMs: number) {
  const links = await rows<LinkRow>(
    c,
    `booking_links?slug=eq.${encodeURIComponent(slug)}&select=id,org_id,owner_id,visibility,bookable_type_id,bookable_types(id,name,duration_min,buffer_before_min,buffer_after_min,min_notice_hours,max_per_day)`,
  );
  const link = links[0];
  // A named-contacts link cannot be honoured without knowing who is asking,
  // and this endpoint never knows. It reads as absent rather than refused.
  if (!link || link.visibility === "named_contacts" || !link.bookable_types) return null;

  const type = link.bookable_types;
  const [ruleRows, overRows, busyRows] = await Promise.all([
    rows<{ weekday: number; start_time: string; end_time: string; timezone: string }>(
      c, `availability_rules?owner_id=eq.${link.owner_id}&select=weekday,start_time,end_time,timezone`),
    rows<{ the_date: string; is_blocked: boolean; override_start: string | null; override_end: string | null }>(
      c, `availability_overrides?owner_id=eq.${link.owner_id}&select=the_date,is_blocked,override_start,override_end`),
    rows<{ time_range: string }>(
      c, `bookings?owner_id=eq.${link.owner_id}&status=eq.confirmed&select=time_range`),
  ]);

  const rules: Rule[] = ruleRows.map((r) => ({
    weekday: r.weekday, startTime: r.start_time.slice(0, 5), endTime: r.end_time.slice(0, 5), timezone: r.timezone,
  }));
  const overrides: Override[] = overRows.map((o) => ({
    date: o.the_date,
    blocked: o.is_blocked,
    ...(o.override_start ? { startTime: o.override_start.slice(0, 5) } : {}),
    ...(o.override_end ? { endTime: o.override_end.slice(0, 5) } : {}),
  }));
  // postgres renders a tstzrange as ["lower","upper") and the bound style is
  // part of the value, so it is parsed rather than assumed.
  const busy: Busy[] = busyRows.map((b) => {
    const m = /^[[(]"?([^",]+)"?,"?([^",)\]]+)"?[)\]]$/.exec(b.time_range.trim());
    return m ? { startMs: Date.parse(m[1]!), endMs: Date.parse(m[2]!) } : { startMs: NaN, endMs: NaN };
  }).filter((b) => Number.isFinite(b.startMs) && Number.isFinite(b.endMs));

  const zone = rules[0]?.timezone ?? "UTC";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(nowMs));

  return {
    link, type, zone,
    slots: openSlots({
      rules, overrides, busy, fromDate: today, days: MAX_DAYS,
      durationMin: type.duration_min,
      bufferBeforeMin: type.buffer_before_min,
      bufferAfterMin: type.buffer_after_min,
      minNoticeHours: type.min_notice_hours,
      maxPerDay: type.max_per_day,
      nowMs,
    }),
  };
}

export default async function handler(req: Request): Promise<Response> {
  const c = ctx();
  if (!c) return json({ error: "Booking is not set up" }, 503);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
  if (!allowed(ip)) return json({ error: "Too many requests" }, 429);

  const u = new URL(req.url);
  const nowMs = Date.now();

  try {
    if (req.method === "GET") {
      const slug = u.searchParams.get("slug") || "";
      if (!slug) return json({ error: "No link" }, 400);
      const g = await grid(c, slug, nowMs);
      if (!g) return json({ error: "No such link" }, 404);
      return json({
        name: g.type.name,
        durationMin: g.type.duration_min,
        timezone: g.zone,
        slots: g.slots.map((s) => ({ startMs: s.startMs, endMs: s.endMs, date: s.date })),
      });
    }

    if (req.method === "POST") {
      const body = (await req.json().catch(() => null)) as
        { slug?: string; startMs?: number; name?: string; email?: string; timezone?: string } | null;
      const slug = (body?.slug || "").trim();
      const startMs = Number(body?.startMs);
      const name = (body?.name || "").trim().slice(0, 120);
      const email = (body?.email || "").trim().slice(0, 200);
      // The visitor's own clock, for the receipt. Untrusted and length-capped
      // here, then checked against the runtime before anything formats with it.
      const guestZone = (body?.timezone || "").trim().slice(0, 60);
      if (!slug || !Number.isFinite(startMs)) return json({ error: "Pick a time" }, 400);
      if (!name) return json({ error: "Add your name" }, 400);
      if (!EMAIL_RE.test(email)) return json({ error: "Add an email we can confirm to" }, 400);

      const g = await grid(c, slug, nowMs);
      if (!g) return json({ error: "No such link" }, 404);
      // THE CLIENT'S START IS A REQUEST, NOT A FACT. It has to be a start the
      // server itself just computed, or it is refused; otherwise the grid is
      // decoration and anyone can post any time at all.
      const slot = g.slots.find((s) => s.startMs === startMs);
      if (!slot) return json({ error: "That time is no longer open" }, 409);

      const range = `["${new Date(slot.startMs).toISOString()}","${new Date(slot.endMs).toISOString()}")`;
      const res = await fetch(`${c.url}/rest/v1/bookings`, {
        method: "POST",
        headers: { ...headers(c), Prefer: "return=representation" },
        body: JSON.stringify({
          org_id: g.link.org_id,
          owner_id: g.link.owner_id,
          booking_link_id: g.link.id,
          bookable_type_id: g.type.id,
          requester_name: name,
          requester_email: email,
          time_range: range,
          status: "confirmed",
        }),
      });
      if (res.status === 409) return json({ error: "Someone just took that time" }, 409);
      if (!res.ok) return json({ error: "Could not book that" }, 502);
      const made = (await res.json()) as { id: string }[];
      const id = made[0]?.id ?? null;

      // THE RECEIPT, AFTER THE FACT. The slot is taken; this is a courtesy on
      // top of work that has already succeeded, so it is allowed to fail and
      // the answer says whether it did. The page then tells the visitor what
      // actually happened rather than promising an email nobody sent.
      let confirmationSent = false;
      if (id) {
        confirmationSent = await sendBookingReceipt({
          ownerId: g.link.owner_id,
          bookingId: id,
          typeName: g.type.name,
          startMs: slot.startMs,
          endMs: slot.endMs,
          guestName: name,
          guestEmail: email,
          ...(guestZone ? { guestZone } : {}),
          hostZone: g.zone,
        }).catch(() => false);
      }

      return json({ id, startMs: slot.startMs, endMs: slot.endMs, timezone: g.zone, name: g.type.name, confirmationSent });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch {
    // Never leak the shape of the database to an unauthenticated caller.
    return json({ error: "Could not load that link" }, 502);
  }
}
