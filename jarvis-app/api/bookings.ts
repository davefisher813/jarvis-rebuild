import { json, who, sel } from "./_track3";
import { parseRange } from "../src/booking/slots";

// WHAT STRANGERS HAVE BOOKED (Track 3, 2026-09-19).
//
//   GET /api/bookings   the caller's own bookings, soonest first.
//
// WHY THIS EXISTS. A booking has been landing in Track 3 since the public page
// shipped, and the host had no way to find out. The visitor got a receipt and
// the person whose day it was did not. A meeting the owner of the calendar
// cannot see is worse than no booking system, because he will double-book the
// hour himself and only one of the two people will turn up expecting company.
//
// It reads and nothing else. Cancelling is a different decision with a
// different consequence (somebody is told their meeting is off), and it is not
// in this endpoint by accident.
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

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const w = await who(req);
  if (!w.ok) return w.res;
  const c = w.ctx;

  try {
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
