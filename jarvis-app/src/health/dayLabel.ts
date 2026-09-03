// A DATE THE ATHLETE READS (2026-09-03, found in the drift sweep).
//
// Five of the health screens printed a stored ISO string straight into the
// UI: Week Shape listed "2026-08-31" down its left edge, the Med Window's
// section heads read "2026-09-03" in caps, and Third Practice made one the
// TITLE of a row. That is a database value on a page, and nowhere else in
// the app does it: provenance, the category record and the chat answers all
// speak the same short human date, built inline in each of them.
//
// So this is that format, written once, for the screens that had none. It
// deliberately matches what those three already produce ("Aug 31"), and
// adds the weekday where a row is about a DAY rather than about a moment,
// because "Mon, Aug 31" is the fact a training week is actually read by.
//
// Noon, not midnight: an ISO date parsed as UTC midnight lands on the
// previous day for anyone west of Greenwich, which is the oldest date bug
// there is. Every other date parse in this codebase already does this.

/** "Aug 31" -- a date inside a line of text. */
export function shortDay(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "Mon, Aug 31" -- a date that IS the row, or the head over one. */
export function weekdayDay(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
