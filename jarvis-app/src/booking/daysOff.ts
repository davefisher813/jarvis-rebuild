import { supabase } from "../auth/supabaseClient";

// DAYS HE IS NOT AVAILABLE (Track 3, 2026-09-19).
//
// The grid has honoured a blocked day since the arithmetic was written, and
// nothing ever wrote one, so a holiday could not be said. He sets Monday to
// Friday, goes away for a week, and the link keeps handing that week out.
//
// A DAY OFF IS NOT A BUSY HOUR, and they share a table. The difference is the one
// thing that keeps them apart everywhere: a busy hour names a window, a day off
// does not. The app pushes his calendar's hours on every open and types in days
// off by hand, and neither write can touch the other's rows.

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Is this a day, in the form the store and the server both use?
 *
 *  The round trip is the check, not the parse. Date.parse happily accepts
 *  2026-02-30 and rolls it forward to March 2, so a mistyped day would be
 *  stored as a different day and take the wrong one out of his calendar
 *  without anything looking wrong. Its own test caught that. */
export function isDate(s: string): boolean {
  if (!DATE.test(s)) return false;
  const ms = Date.parse(s + "T00:00:00Z");
  if (Number.isNaN(ms)) return false;
  return new Date(ms).toISOString().slice(0, 10) === s;
}

/** The list a screen should show: sorted, deduped, days only. The server sorts
 *  too; this is so the screen is right the moment he adds one, without waiting
 *  for a round trip to tell it where the new row goes. */
export function tidy(dates: string[]): string[] {
  return [...new Set(dates.filter(isDate))].sort();
}

/** How a day off reads to a person. The year only when it is not this one,
 *  because "Friday, 25 December" is how somebody says it and the year is noise
 *  until it is not. */
export function dayOffLabel(date: string, now: Date = new Date()): string {
  const d = new Date(date + "T12:00:00");
  if (Number.isNaN(d.getTime())) return date;
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString([], {
    weekday: "long", month: "long", day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

async function token(): Promise<string | null> {
  try {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch { return null; }
}

/** The days he has marked off, or null when there was no way to ask. Null and an
 *  empty list are different answers: one means the screen does not know, the
 *  other means he has no days off. */
export async function readDaysOff(
  fetchImpl: typeof fetch = fetch,
  getToken: () => Promise<string | null> = token,
): Promise<string[] | null> {
  const t = await getToken();
  if (!t) return null;
  try {
    const r = await fetchImpl("/api/booking-busy", { headers: { Authorization: `Bearer ${t}` } });
    if (!r.ok) return null;
    const body = (await r.json()) as { daysOff?: unknown };
    return Array.isArray(body.daysOff) ? tidy(body.daysOff.filter((d): d is string => typeof d === "string")) : null;
  } catch {
    return null;
  }
}

/** Replace the list. Throws when it did not save, because a person who has just
 *  marked next week off must not be left believing it when it did not take. */
export async function saveDaysOff(
  dates: string[],
  fetchImpl: typeof fetch = fetch,
  getToken: () => Promise<string | null> = token,
): Promise<string[]> {
  const t = await getToken();
  if (!t) throw new Error("no session");
  const r = await fetchImpl("/api/booking-busy", {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "content-type": "application/json" },
    body: JSON.stringify({ daysOff: tidy(dates) }),
  });
  if (!r.ok) throw new Error(String(r.status));
  const body = (await r.json()) as { daysOff?: unknown };
  return Array.isArray(body.daysOff) ? tidy(body.daysOff.filter((d): d is string => typeof d === "string")) : tidy(dates);
}
