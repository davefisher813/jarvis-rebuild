// THE ONE DURATION FORMATTER (Dave 2026-09-26, the pass-off, second round:
// "45 Min" spelled and capitalized for minutes-only, "+30 Sec"; hours use
// the compact clock "1h 30m"; running clocks m:ss, h:mm:ss past an hour).
//
// Before this file the app had fourteen hand-rolled shapes for the same
// number: "45 min", "45m", "45 Min", "2 hr 40 min", "1 hour", "2m 30s", and
// Today's headliner said "45 min" two rows above a "45m". Every one of those
// was a builder that knew the rule on the day it was written and drifted
// the moment the rule moved. So the shapes live here, once, and a screen
// that wants a duration asks for it rather than gluing a unit onto a number.
//
// The four shapes, and nothing else:
//
//   minutesLabel(45)   "45 Min"     a count of minutes, always spelled
//   spanLabel(90)      "1h 30m"     a length: minutes alone under an hour,
//                                   the compact clock from an hour up
//   secondsLabel(30)   "30 Sec"     a count of seconds ("+30 Sec" signed)
//   clockLabel(462)    "7:42"       a running clock, "1:00:05" past an hour
//
// The unit is a WORD, so it takes the casing every other word on a line
// takes (§H2, §T.3 as superseded): "Min", "Sec", never "min". The compact
// clock is not a word, so it keeps its shape: lineCase leaves "1h 30m" and
// "7:42" alone, which is the whole reason a screen can run a built line
// through it after this file has done its part.
//
// An estimate is spelled "About", never "~" (the §H2 example is "Saves About
// 8 Min"); aboutLabel is that one word in front of a span, so no builder
// writes the tilde back.

const round = (n: number): number => Math.max(0, Math.round(Number.isFinite(n) ? n : 0));

/** "45 Min", "1 Min", "0 Min": a count of minutes, always spelled out. A
 *  fraction is rounded, since half a minute is not a thing a line says. */
export function minutesLabel(min: number): string {
  return `${round(min)} Min`;
}

/** "45 Min" under an hour; "1h", "1h 30m", "18h 30m" from an hour up. The
 *  compact clock is the rule's own shape for anything with hours in it
 *  ("1h 30m", never "1 Hr 30 Min"), and a zero reads "0 Min". */
export function spanLabel(min: number): string {
  const m = round(min);
  if (m < 60) return minutesLabel(m);
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

/** Decimal hours, as a span: 7.4 reads "7h 24m", 0.5 reads "30 Min". The
 *  sleep average and a typed night's length arrive as hours. */
export function hoursLabel(hours: number): string {
  return spanLabel(hours * 60);
}

/** "30 Sec"; with `signed`, "+30 Sec" for an add and "-30 Sec" for a cut,
 *  the shape of the rest timer's extend button. */
export function secondsLabel(sec: number, opts: { signed?: boolean } = {}): string {
  const n = Math.round(Number.isFinite(sec) ? sec : 0);
  if (!opts.signed) return `${Math.abs(n)} Sec`;
  return `${n < 0 ? "-" : "+"}${Math.abs(n)} Sec`;
}

/** A running clock: "7:42", "0:07", "12:00", and "1:00:05" once it passes
 *  an hour. Never negative; a fraction of a second is rounded off. */
export function clockLabel(totalSec: number): string {
  const t = round(totalSec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const ss = String(s).padStart(2, "0");
  if (h === 0) return `${m}:${ss}`;
  return `${h}:${String(m).padStart(2, "0")}:${ss}`;
}

/** "About 45 Min", "About 1h 30m": an estimate, spelled with the word and
 *  never the tilde. */
export function aboutLabel(min: number): string {
  return `About ${spanLabel(min)}`;
}
