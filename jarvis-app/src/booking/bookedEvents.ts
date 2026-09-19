// A BOOKING BECOMES AN EVENT (Track 3, 2026-09-19).
//
// A booking has been landing in Track 3 since the public page shipped, and the
// host had no way to find out. The visitor got a receipt and the person whose
// day it was did not. That is worse than having no booking system at all,
// because he will fill the hour himself and only one of the two people will
// turn up expecting company.
//
// It lands in JARVIS's OWN store rather than in Google. That is not a
// shortcut: the Google grant is calendar.readonly on purpose, under a standing
// rule that JARVIS writes schedules to its own store and never to Google
// (see connections/google/config.ts). Widening that scope would force every
// connected account through an interactive reconnect, which is a decision for
// Dave and not a side effect of this feature.
//
// Kept pure and separate from the import that uses it, because the conversion
// is where the bugs are: an absolute instant has to become a local day and a
// wall-clock time, and getting that wrong puts a real meeting on the wrong
// day without anything looking broken.

/** One booking, as /api/bookings reports it. */
export interface BookingFace {
  id: string;
  title: string;
  guestName: string;
  guestEmail: string;
  startMs: number;
  endMs: number;
}

/** The event fields a booking becomes. Deliberately the narrow set: a booking
 *  is the visitor's, so there is nothing here to recur, nowhere to be, and no
 *  category, exactly as an imported Google event has none. */
export interface BookedEvent {
  bookingId: string;
  title: string;
  date: string;
  start: string;
  end: string;
  notes: string;
  attendees: { email: string; name?: string }[];
}

const two = (n: number): string => String(n).padStart(2, "0");

/** The local day, in the store's own YYYY-MM-DD form. Built from the parts of
 *  the local date rather than from toISOString, which is UTC and would file a
 *  9 PM meeting under tomorrow for most of the world. */
export function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** The local wall clock, in the store's own HH:MM form. */
export function localTime(ms: number): string {
  const d = new Date(ms);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** A booking as an event, or null if its times are not times. Null rather than
 *  a guess: an event at an invented hour is worse than an event that is
 *  missing, because he would plan around it. */
export function mapBooking(b: BookingFace): BookedEvent | null {
  if (!b.id || !Number.isFinite(b.startMs) || !Number.isFinite(b.endMs)) return null;
  if (b.endMs <= b.startMs) return null;
  const who = b.guestName.trim();
  const type = b.title.trim() || "Meeting";
  return {
    bookingId: b.id,
    // The name goes in the title because the title is the only part of an
    // event he reads at a glance, and the one thing he needs to know about an
    // hour somebody else took is who took it.
    title: who ? `${type} with ${who}` : type,
    date: localDate(b.startMs),
    start: localTime(b.startMs),
    end: localTime(b.endMs),
    // The address is written down because a booking is the one kind of meeting
    // where he has never met the person and has no other record of them.
    notes: b.guestEmail.trim() ? `Booked through your link by ${who || "someone"} (${b.guestEmail.trim()})` : "Booked through your link",
    attendees: b.guestEmail.trim() ? [{ email: b.guestEmail.trim(), ...(who ? { name: who } : {}) }] : [],
  };
}

/** Whether a stored event came from a booking that this fetch can vouch for.
 *
 *  The same timidity the Google import learned the hard way: a booking event
 *  inside the window the server was asked about, that the server did not
 *  return, has genuinely been cancelled. One outside that window was simply
 *  not asked about, and deleting it would delete a real meeting because of a
 *  query's limits. */
export function insideWindow(date: string, fromDate: string, toDate: string): boolean {
  return date >= fromDate && date <= toDate;
}
