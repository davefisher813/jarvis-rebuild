import { ruleRows, makeSlug, VISIBILITY_ROW, WHO_ROW } from "../src/booking/linkPayload";
import { json, who, sel, ins, patch, del, orgOf } from "./_track3";
import type { BookingSettings } from "../src/booking/settings";

// YOUR TIMES, MADE REAL (Track 3, 2026-09-19).
//
//   GET  /api/booking-link    the caller's link, or null
//   PUT  /api/booking-link    write Your Times into Track 3, return the slug
//   DELETE /api/booking-link  stop taking bookings and drop the link
//
// THE BRIDGE THIS IS, and why booking does not wait for Clerk, is written
// once in api/_track3.ts, which this shares with api/bookings.ts.
//
// Everything here is idempotent. Pressing Save twice writes the same link,
// not a second one, because a person who taps a button twice should not end
// up with two addresses and no way to tell which one they gave out.
export const config = { runtime: "edge" };

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
