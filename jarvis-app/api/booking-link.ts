import { ruleRows, makeSlug, VISIBILITY_ROW, WHO_ROW } from "../src/booking/linkPayload";
import type { BookingSettings } from "../src/booking/settings";

// YOUR TIMES, MADE REAL (Track 3, 2026-09-19).
//
//   GET  /api/booking-link    the caller's link, or null
//   PUT  /api/booking-link    write Your Times into Track 3, return the slug
//   DELETE /api/booking-link  stop taking bookings and drop the link
//
// THE BRIDGE THIS IS. Track 3 lives in its own Supabase project and its
// policies expect Clerk, which is not wired. That blocked everything, and it
// did not have to: the SESSION can come from the live project while the
// STORAGE is Track 3. This endpoint verifies the caller against the live
// project exactly the way the admin endpoints do, and then writes to Track 3
// with the service role, using the caller's live user id as `owner_id`.
// `owner_id` is a bare uuid in that schema with no foreign key behind it,
// which is what makes this legal rather than a trick.
//
// So booking works today, for the one user this app has, without Clerk.
// Connections and shared projects still need it, because those need TWO real
// user ids that can see each other; one user's own calendar does not.
//
// Everything here is idempotent. Pressing Save twice writes the same link,
// not a second one, because a person who taps a button twice should not end
// up with two addresses and no way to tell which one they gave out.
export const config = { runtime: "edge" };

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

interface Ctx { t3: string; key: string; owner: string }

/** The caller, proven against the LIVE project, and the Track 3 credentials
 *  to act on their behalf. Fails closed at every step. */
async function who(req: Request): Promise<{ ok: true; ctx: Ctx } | { ok: false; res: Response }> {
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

const hdrs = (c: Ctx, extra: Record<string, string> = {}) =>
  ({ apikey: c.key, Authorization: `Bearer ${c.key}`, "content-type": "application/json", ...extra });

async function sel<T>(c: Ctx, path: string): Promise<T[]> {
  const r = await fetch(`${c.t3}/rest/v1/${path}`, { headers: hdrs(c) });
  if (!r.ok) throw new Error(`select ${path}: ${r.status}`);
  return (await r.json()) as T[];
}
async function ins<T>(c: Ctx, table: string, body: unknown): Promise<T[]> {
  const r = await fetch(`${c.t3}/rest/v1/${table}`, {
    method: "POST", headers: hdrs(c, { Prefer: "return=representation" }), body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`insert ${table}: ${r.status}`);
  return (await r.json()) as T[];
}
async function patch(c: Ctx, path: string, body: unknown): Promise<void> {
  const r = await fetch(`${c.t3}/rest/v1/${path}`, { method: "PATCH", headers: hdrs(c), body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`patch ${path}: ${r.status}`);
}
async function del(c: Ctx, path: string): Promise<void> {
  const r = await fetch(`${c.t3}/rest/v1/${path}`, { method: "DELETE", headers: hdrs(c) });
  if (!r.ok) throw new Error(`delete ${path}: ${r.status}`);
}

/** The caller's org, made once. Every Track 3 row hangs off an org, so this
 *  is the root the rest of it needs; a personal one is created the first
 *  time rather than demanded up front. */
async function orgOf(c: Ctx): Promise<string> {
  const mine = await sel<{ org_id: string }>(c, `org_members?user_id=eq.${c.owner}&select=org_id&limit=1`);
  if (mine[0]) return mine[0].org_id;
  const made = await ins<{ id: string }>(c, "orgs", { name: "Personal", template: "personal" });
  const org = made[0]!.id;
  await ins(c, "org_members", { org_id: org, user_id: c.owner, role: "owner" });
  return org;
}

interface LinkShape { id: string; slug: string; visibility: string; bookable_type_id: string | null }

export default async function handler(req: Request): Promise<Response> {
  const w = await who(req);
  if (!w.ok) return w.res;
  const c = w.ctx;

  try {
    const links = await sel<LinkShape>(c, `booking_links?owner_id=eq.${c.owner}&select=id,slug,visibility,bookable_type_id&limit=1`);
    const link = links[0] ?? null;

    if (req.method === "GET") {
      if (!link) return json({ link: null });
      const rules = await sel<{ weekday: number }>(c, `availability_rules?owner_id=eq.${c.owner}&select=weekday`);
      return json({ link: { slug: link.slug, visibility: link.visibility, days: rules.length } });
    }

    if (req.method === "DELETE") {
      // Taking the link down is two facts: no hours, and no address. The
      // bookings already made are left exactly where they are, because
      // cancelling somebody's meeting is a different decision from closing
      // your calendar and must never be a side effect of it.
      await del(c, `availability_rules?owner_id=eq.${c.owner}`);
      if (link) await del(c, `booking_links?id=eq.${link.id}`);
      return json({ link: null });
    }

    if (req.method === "PUT") {
      const body = (await req.json().catch(() => null)) as
        { settings?: BookingSettings; timezone?: string; name?: string } | null;
      const s = body?.settings;
      if (!s || typeof s.durationMin !== "number") return json({ error: "No settings" }, 400);
      const timezone = (body?.timezone || "UTC").slice(0, 60);
      const label = (body?.name || "Meeting").trim().slice(0, 80) || "Meeting";
      const org = await orgOf(c);

      // The type carries the duration, so changing the slot length on the
      // settings screen changes what the public page offers rather than
      // leaving a second type behind.
      let typeId = link?.bookable_type_id ?? null;
      if (typeId) {
        await patch(c, `bookable_types?id=eq.${typeId}`, { name: label, duration_min: s.durationMin });
      } else {
        const made = await ins<{ id: string }>(c, "bookable_types", {
          org_id: org, owner_id: c.owner, name: label, duration_min: s.durationMin,
        });
        typeId = made[0]!.id;
      }

      // The hours are replaced wholesale, never merged: the screen shows one
      // set of days, so the table has to mean exactly what the screen shows.
      await del(c, `availability_rules?owner_id=eq.${c.owner}`);
      const rules = ruleRows(s, c.owner, timezone);
      if (rules.length > 0) await ins(c, "availability_rules", rules);

      const visibility = VISIBILITY_ROW[s.visibility];
      let slug = link?.slug ?? "";
      if (link) {
        await patch(c, `booking_links?id=eq.${link.id}`, { visibility, bookable_type_id: typeId });
      } else {
        // The address is made once and then kept, because a link that
        // changes every time it is saved is a link nobody can give out.
        const made = await ins<{ id: string; slug: string }>(c, "booking_links", {
          org_id: org, owner_id: c.owner, bookable_type_id: typeId, slug: makeSlug(), visibility,
        });
        slug = made[0]!.slug;
        await ins(c, "booking_permissions", { booking_link_id: made[0]!.id, mode: WHO_ROW[s.who] });
      }
      if (link) await patch(c, `booking_permissions?booking_link_id=eq.${link.id}`, { mode: WHO_ROW[s.who] });

      return json({ link: { slug, visibility, days: rules.length } });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch {
    return json({ error: "Could not save your times" }, 502);
  }
}
