// THE SHORT HUMAN DATE, WRITTEN ONCE (2026-09-03, drift sweep follow-up).
//
// "Aug 12" was being built inline, slightly differently, in provenance, the
// category record, chat answers, Notes, Messages, Smart Paste's receipt, the
// outbox hold line, the waiting-on line, Decisions, and (as of the health
// sweep two sessions ago) health/dayLabel.ts -- eleven call sites for one
// fact. Some passed `[]` for locale, some "en-US"; some parsed a bare date at
// midnight, which lands on the wrong day for anyone west of Greenwich (the
// oldest date bug there is; dayLabel.ts named it first). One place now,
// "en-US" and noon-local everywhere a bare date comes in, so the whole app
// says the same date the same way.
//
// dayDate handles both shapes a caller has: a bare "YYYY-MM-DD" (parsed at
// local noon) and anything else -- a full ISO instant, already carrying its
// own time and offset -- passed straight to Date. shortDate / weekdayShortDate
// / weekdayLongDate read either. shortDateFromMs / weekdayShortDateFromMs are
// for the callers who already hold a real Date or epoch ms (a source
// timestamp, "now"); there is no calendar day to protect, so no noon
// adjustment applies.
//
// Every formatter is NaN-safe: an unparseable input echoes back unchanged
// rather than rendering "Invalid Date".

function dayDate(iso: string): Date {
  return new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
}

function fmt(d: Date, opts: Intl.DateTimeFormatOptions, fallback: string): string {
  return Number.isNaN(d.getTime()) ? fallback : d.toLocaleDateString("en-US", opts);
}

/** "Aug 12" -- a date inside a line of text. Bare date or full ISO. */
export function shortDate(iso: string): string {
  return fmt(dayDate(iso), { month: "short", day: "numeric" }, iso);
}

/** "Mon, Aug 12" -- a date that IS the row, or the head over one. */
export function weekdayShortDate(iso: string): string {
  return fmt(dayDate(iso), { weekday: "short", month: "short", day: "numeric" }, iso);
}

/** "Monday, Aug 12" -- the receipt line, where the date gets its own breath. */
export function weekdayLongDate(iso: string): string {
  return fmt(dayDate(iso), { weekday: "long", month: "short", day: "numeric" }, iso);
}

/** "Aug 12" from an epoch ms instant (a timestamp, not a calendar date). */
export function shortDateFromMs(ms: number): string {
  return fmt(new Date(ms), { month: "short", day: "numeric" }, "");
}

/** "Mon, Aug 12" from an epoch ms instant. */
export function weekdayShortDateFromMs(ms: number): string {
  return fmt(new Date(ms), { weekday: "short", month: "short", day: "numeric" }, "");
}
