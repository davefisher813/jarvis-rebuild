import type { BookingSettings, BookingVisibility, BookingWho } from "./settings";

// YOUR TIMES, AS ROWS (Track 3, 2026-09-19).
//
// The Booking settings screen has been storing its answers on the device
// since it was built, waiting for somewhere to put them. This is the
// translation, kept pure so the conversions can be tested rather than
// trusted: the screen's words are not the database's words, and the two
// disagree in three places that would each be a silent, plausible bug.
//
//   1. THE WEEK STARTS ON A DIFFERENT DAY. The screen stores Monday-first
//      (Dave reads a week that way), Postgres and JavaScript both count from
//      Sunday. Off by one here books people on the wrong day of the week,
//      which is the kind of wrong nobody notices until somebody is standing
//      in a car park.
//   2. THE WORDS DIFFER. "link" is `link_only`, "named" is `named_contacts`,
//      and who may book is a separate row in `booking_permissions` rather
//      than a column on the link.
//   3. A DAY IS NOT A WINDOW. The screen collects which days, never which
//      hours, so the hours come from one default stated here rather than
//      from nowhere.

/** The default working window, until the screen asks for one. Stated once,
 *  so the day the screen grows a time picker there is one line to delete. */
export const DEFAULT_WINDOW = { startTime: "09:00", endTime: "17:00" } as const;

/** Monday-first, the way the screen stores a week, to Sunday-first, the way
 *  Date.getDay and the `availability_rules.weekday` column both count. */
export function toSundayFirst(mondayFirst: number): number {
  return (mondayFirst + 1) % 7;
}

export const VISIBILITY_ROW: Record<BookingVisibility, string> = {
  public: "public",
  link: "link_only",
  named: "named_contacts",
};

export const WHO_ROW: Record<BookingWho, string> = {
  anyone: "open_link",
  approved: "approved_contacts",
  connections: "org_internal",
};

export interface RuleRow { owner_id: string; weekday: number; start_time: string; end_time: string; timezone: string }

/** One row per day the owner takes bookings on. An owner who is not
 *  available takes none, which is a real answer and not an empty one: the
 *  rows are replaced wholesale, so turning availability off empties the
 *  table and the link stops offering anything. */
export function ruleRows(s: BookingSettings, ownerId: string, timezone: string): RuleRow[] {
  if (!s.available) return [];
  return [...new Set(s.days)]
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    .map((d) => ({
      owner_id: ownerId,
      weekday: toSundayFirst(d),
      start_time: DEFAULT_WINDOW.startTime,
      end_time: DEFAULT_WINDOW.endTime,
      timezone,
    }))
    .sort((a, b) => a.weekday - b.weekday);
}

// A slug is read aloud and typed by hand, so it leaves out the characters
// that are ambiguous in both: no l or 1, no o or 0, no u or v.
const ALPHABET = "abcdefghjkmnpqrstwxyz23456789";

/** A short, unguessable, sayable slug. The randomness is passed in so a test
 *  can be certain rather than lucky. */
export function makeSlug(rand: () => number = Math.random, len = 10): string {
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[Math.floor(rand() * ALPHABET.length)] ?? ALPHABET[0];
  return out;
}
