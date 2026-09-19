import type { ScheduleService } from "../schedule/ScheduleService";
import type { EventData } from "../schedule/types";
import { supabase } from "../auth/supabaseClient";
import { mapBooking, localDate, insideWindow, type BookingFace } from "./bookedEvents";

// BRINGING BOOKINGS IN (Track 3, 2026-09-19).
//
// Runs the same shape as the Google calendar import and for the same reason:
// something outside the app decided the contents of an hour, and the schedule
// has to agree with it. It is much simpler than that import, because a booking
// cannot be edited. Nobody retitles it, nobody moves it. It appears, and it
// either stands or is cancelled. So there is no field-by-field merge here and
// no hash: an id either has an event or it does not.
//
// TWO RULES CARRIED OVER FROM THE GOOGLE IMPORT, both learned expensively.
//
//   1. NEVER CREATE A SECOND COPY. The id is the key and the store is checked
//      before anything is written, so running this on every open is safe.
//   2. NEVER DELETE ON AN ABSENCE ALONE. An event is removed only when the
//      server was actually asked about its day. Outside that window an absence
//      means "not asked", and deleting on it would delete a real meeting.
//
// It is quiet by design. No sign-in, no booking server, no bookings: each of
// those is an ordinary answer that leaves the schedule exactly as it was.

const BACK_DAYS = 1;
const AHEAD_DAYS = 90;
const DAY_MS = 86_400_000;

export interface BookingImportSummary { created: number; removed: number }

const NOTHING: BookingImportSummary = { created: 0, removed: 0 };

async function token(): Promise<string | null> {
  try {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch { return null; }
}

/** The caller's bookings, or null when there is no way to ask. Null and an
 *  empty list are different answers: null leaves the schedule alone, an empty
 *  list means every booking inside the window is gone. */
export async function readBookings(
  fetchImpl: typeof fetch = fetch,
  getToken: () => Promise<string | null> = token,
): Promise<BookingFace[] | null> {
  const t = await getToken();
  if (!t) return null;
  try {
    const r = await fetchImpl("/api/bookings", { headers: { Authorization: `Bearer ${t}` } });
    if (!r.ok) return null;
    const body = (await r.json()) as { bookings?: BookingFace[] };
    return Array.isArray(body.bookings) ? body.bookings : null;
  } catch {
    return null;
  }
}

/** Call a booking off. Resolves to whether the guest was actually told, which
 *  is a different fact from whether the cancellation happened: the meeting is
 *  off either way, and the screen has to be able to say which.
 *
 *  Throws when the cancellation itself did not happen, because that is the one
 *  outcome the person pressing the button must not be allowed to believe. */
export async function cancelBooking(
  id: string,
  reason = "",
  fetchImpl: typeof fetch = fetch,
  getToken: () => Promise<string | null> = token,
): Promise<{ told: boolean }> {
  const t = await getToken();
  if (!t) throw new Error("no session");
  const r = await fetchImpl("/api/bookings", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${t}`, "content-type": "application/json" },
    body: JSON.stringify({ id, ...(reason.trim() ? { reason: reason.trim() } : {}) }),
  });
  if (!r.ok) throw new Error(String(r.status));
  const body = (await r.json()) as { told?: boolean };
  return { told: body.told === true };
}

export async function importBookings(
  schedule: ScheduleService,
  fetchImpl: typeof fetch = fetch,
  getToken: () => Promise<string | null> = token,
  now: Date = new Date(),
): Promise<BookingImportSummary> {
  const bookings = await readBookings(fetchImpl, getToken);
  if (!bookings) return NOTHING;

  // The days the server was asked about, which is exactly what its own window
  // is. These two numbers and the endpoint's must agree or this deletes things
  // it was never told about.
  const fromDate = localDate(now.getTime() - BACK_DAYS * DAY_MS);
  const toDate = localDate(now.getTime() + AHEAD_DAYS * DAY_MS);

  const existing = await schedule.listEvents();
  const byId = new Map<string, { id: string; data: EventData }>();
  for (const e of existing) {
    const id = (e.data as { bookingId?: string }).bookingId;
    if (id) byId.set(id, e as { id: string; data: EventData });
  }

  let created = 0;
  const live = new Set<string>();
  for (const b of bookings) {
    const m = mapBooking(b);
    if (!m) continue;
    live.add(m.bookingId);
    if (byId.has(m.bookingId)) continue;
    const made = await schedule.createEvent(m.title, {
      date: m.date,
      start: m.start,
      end: m.end,
      notes: m.notes,
      bookingId: m.bookingId,
      ...(m.attendees.length ? { attendees: m.attendees } : {}),
    });
    if (made) created++;
  }

  // A booking that was cancelled after it was imported. Only inside the window
  // the fetch can vouch for; see rule 2 above.
  let removed = 0;
  for (const [bookingId, e] of byId) {
    if (live.has(bookingId)) continue;
    if (!insideWindow(e.data.date ?? "", fromDate, toDate)) continue;
    await schedule.deleteEvent(e.id);
    removed++;
  }

  return { created, removed };
}
