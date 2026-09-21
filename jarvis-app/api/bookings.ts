import { json, who, sel, patch } from "./_track3";
import { parseRange } from "../src/booking/slots";
import { sendBookingCancellation } from "./_receipt";

// WHAT STRANGERS HAVE BOOKED (Track 3, 2026-09-19).
//
//   GET    /api/bookings                    the caller's own, soonest first.
//   DELETE /api/bookings {id, reason?}      call one off, and say so.
//
// WHY THIS EXISTS. A booking has been landing in Track 3 since the public page
// shipped, and the host had no way to find out. The visitor got a receipt and
// the person whose day it was did not. A meeting the owner of the calendar
// cannot see is worse than no booking system, because he will double-book the
// hour himself and only one of the two people will turn up expecting company.
//
// CANCELLING IS A DIFFERENT DECISION, and it is written like one.
//
//   - The row is marked cancelled, never deleted. The history is worth keeping
//     and the slot frees up on its own, because every grid this app draws
//     counts confirmed bookings only.
//   - The guest is told. A cancellation nobody hears about is not a
//     cancellation, it is a stranger standing somewhere on their own. The
//     answer says whether the mail went, so the app can say so too rather
//     than implying a person has been told when they have not.
//   - It is idempotent. Cancelling twice is one cancellation and one email,
//     because the second call finds nothing confirmed to cancel.
//   - A booking that is not the caller's own is a 404, not a 403. Whether
//     somebody else's booking exists is not this caller's business.
//
// THE WINDOW. Yesterday forward, because a meeting that happened this morning
// is still the thing he is trying to remember at lunchtime, and 90 days ahead,
// which is well past the 30 the public grid will ever offer.
export const config = { runtime: "edge" };

const BACK_DAYS = 1;
const AHEAD_DAYS = 90;
const MAX = 200;
const DAY_MS = 86_400_000;

interface Row {
  id: string;
  requester_name: string | null;
  requester_email: string | null;
  time_range: string;
  status: string;
  bookable_types: { name: string } | null;
}

/** The zone the owner's hours are set in, which is the clock their grid was
 *  drawn on. Falls back to UTC when there are no hours, which can only happen
 *  for a booking made before the hours were cleared. */
async function hostZone(c: Parameters<typeof sel>[0]): Promise<string> {
  const rules = await sel<{ timezone: string }>(c, `availability_rules?owner_id=eq.${c.owner}&select=timezone&limit=1`);
  return rules[0]?.timezone || "UTC";
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET" && req.method !== "DELETE") return json({ error: "Method not allowed" }, 405);
  const w = await who(req);
  if (!w.ok) return w.res;
  const c = w.ctx;

  try {
    if (req.method === "DELETE") return await cancel(req, c);
    const now = Date.now();
    const from = new Date(now - BACK_DAYS * DAY_MS).toISOString();
    const to = new Date(now + AHEAD_DAYS * DAY_MS).toISOString();
    // The range overlap operator is what an exclusion-constrained tstzrange
    // column is for; comparing a range to a timestamp with gt would not
    // typecheck in Postgres, let alone mean the right thing.
    const rows = await sel<Row>(
      c,
      `bookings?owner_id=eq.${c.owner}&status=eq.confirmed` +
      `&time_range=ov.%5B%22${encodeURIComponent(from)}%22%2C%22${encodeURIComponent(to)}%22%29` +
      `&select=id,requester_name,requester_email,time_range,status,bookable_types(name)` +
      `&limit=${MAX}`,
    );

    const bookings = rows
      .map((r) => {
        const { startMs, endMs } = parseRange(r.time_range);
        return {
          id: r.id,
          title: r.bookable_types?.name || "Meeting",
          guestName: r.requester_name || "",
          guestEmail: r.requester_email || "",
          startMs, endMs,
        };
      })
      .filter((b) => Number.isFinite(b.startMs) && Number.isFinite(b.endMs))
      .sort((a, b) => a.startMs - b.startMs);

    return json({ bookings });
  } catch {
    return json({ error: "Could not read your bookings" }, 502);
  }
}

async function cancel(req: Request, c: { t3: string; key: string; owner: string }): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { id?: string; reason?: string } | null;
  const id = (body?.id || "").trim();
  // The host's own words, if they gave any. Capped because it goes in an email,
  // and trimmed because a reason of spaces is no reason.
  const reason = (body?.reason || "").trim().slice(0, 300);
  if (!id) return json({ error: "Which booking" }, 400);

  // Scoped to the caller AND to confirmed, which makes this both an
  // authorization check and the idempotency check in one query: somebody
  // else's booking and an already-cancelled one are the same answer.
  const found = await sel<Row>(
    c,
    `bookings?id=eq.${encodeURIComponent(id)}&owner_id=eq.${c.owner}&status=eq.confirmed` +
    `&select=id,requester_name,requester_email,time_range,status,bookable_types(name)&limit=1`,
  );
  const row = found[0];
  if (!row) return json({ error: "No such booking" }, 404);
  const { startMs, endMs } = parseRange(row.time_range);

  await patch(c, `bookings?id=eq.${encodeURIComponent(id)}&owner_id=eq.${c.owner}`, { status: "cancelled" });

  // The mail comes after the row, never before: telling somebody a meeting is
  // off and then failing to cancel it is the one ordering that cannot be
  // recovered from.
  let told = false;
  if (row.requester_email && Number.isFinite(startMs) && Number.isFinite(endMs)) {
    told = await sendBookingCancellation({
      ownerId: c.owner,
      bookingId: row.id,
      typeName: row.bookable_types?.name || "Meeting",
      startMs, endMs,
      guestName: row.requester_name || "there",
      guestEmail: row.requester_email,
      hostZone: await hostZone(c),
      ...(reason ? { reason } : {}),
    }).catch(() => false);
  }

  return json({ cancelled: true, told });
}
