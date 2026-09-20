import type { ScheduleService } from "../schedule/ScheduleService";
import { occursOn, addDays, todayISO } from "../schedule/calendar";
import { supabase } from "../auth/supabaseClient";
import { committedBlocks, type Block, type Occurrence } from "./committed";

// TELLING THE LINK WHICH HOURS ARE GONE (Track 3, 2026-09-19).
//
// The grid subtracted other people's bookings and nothing else, so a link
// published for Tuesday afternoons offered the hour he already had a meeting in.
// This is the other half: the app works out which hours are taken and hands them
// to Track 3, where the public endpoint can see them without ever being able to
// see his calendar.
//
// IT REPLACES, NEVER MERGES. A meeting he moved or deleted has to stop blocking
// the hour it used to be in, and the only way to be sure of that is for the set
// of rows to mean exactly what the schedule means right now. Anything else
// leaves an hour blocked forever by a meeting that no longer exists.
//
// IT NEVER TOUCHES HIS DAYS OFF. Those are rows in the same table with no window
// on them; this only ever writes and clears rows that name one. Two readings of
// the same columns, kept apart by that one difference.
//
// HOW FAR AHEAD. The same 30 days the public grid offers, and no further:
// pushing a year of a calendar to block hours nobody can book is a large request
// on every app open for nothing.
const WINDOW_DAYS = 30;

/** Every hour the owner has already spoken for, over the window the link
 *  offers. Reads occurrences through the schedule's own recurrence rule, so a
 *  weekly meeting blocks every week and a day removed from a series does not. */
export async function committedFor(schedule: ScheduleService, now: Date = new Date()): Promise<Block[]> {
  const fromDate = todayISO(now);
  const toDate = addDays(fromDate, WINDOW_DAYS);
  const events = await schedule.listEvents();
  const occurrences: Occurrence[] = [];
  for (let i = 0; i <= WINDOW_DAYS; i++) {
    const date = addDays(fromDate, i);
    for (const e of events) {
      // A booking is not a commitment to push back: it came FROM the link, the
      // link already knows about it, and sending it back would have the grid
      // subtract the same hour twice.
      if ((e.data as { bookingId?: string }).bookingId) continue;
      if (occursOn(e.data, date)) occurrences.push({ date, data: e.data });
    }
  }
  return committedBlocks(occurrences, fromDate, toDate);
}

async function token(): Promise<string | null> {
  try {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch { return null; }
}

/** Hand them over. Resolves to how many hours are now blocked, or null when
 *  there was no way to ask, which is an ordinary answer on a device with no
 *  booking server behind it. */
export async function pushCommitted(
  schedule: ScheduleService,
  fetchImpl: typeof fetch = fetch,
  getToken: () => Promise<string | null> = token,
  now: Date = new Date(),
): Promise<number | null> {
  const t = await getToken();
  if (!t) return null;
  try {
    const blocks = await committedFor(schedule, now);
    const r = await fetchImpl("/api/booking-busy", {
      method: "PUT",
      headers: { Authorization: `Bearer ${t}`, "content-type": "application/json" },
      body: JSON.stringify({ blocks }),
    });
    if (!r.ok) return null;
    const body = (await r.json()) as { blocked?: number };
    return typeof body.blocked === "number" ? body.blocked : blocks.length;
  } catch {
    return null;
  }
}
