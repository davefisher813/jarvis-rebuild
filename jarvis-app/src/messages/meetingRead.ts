import type { MeetingMissing } from "./mailContracts";
import { addDaysIso, isoFromParts, readZone, weekdayOfIso } from "./zoneTime";

// READING WHEN A SENTENCE SAYS (2026-09-29).
//
// The brief's model answer is untrusted, and a calendar is the last place to
// trust it. So the model is asked for WHAT (a title, a status, and the
// sentence it read it from) and this file reads WHEN out of that sentence, in
// code, the same way for every message:
//
//   - RELATIVE DAYS RESOLVE AGAINST THE MESSAGE'S OWN DAY. "Tomorrow" and
//     "Tuesday" are counted from the day the message was SENT, in the zone it
//     was read in, never from the day the phone happens to open it. The same
//     email opened a week later still means the same Tuesday.
//   - A TIME WITHOUT AM OR PM STAYS WITHOUT. "Tuesday at 3" is asked about;
//     it is not turned into 3 PM because that is the likelier reading.
//   - A DAY PART IS NOT A TIME. "Thursday morning" is a date and a day part.
//     It is never turned into 9 AM.
//   - A ZONE THE MESSAGE DOES NOT NAME IS NOT INVENTED. An ambiguous
//     abbreviation (CST is Central US and China) stays missing.
//   - A SENTENCE THAT NAMES TWO DAYS OR TWO TIMES IS NOT ONE MEETING. Nothing
//     is picked; both are left missing and the card asks.
//
// Pure. English only, which is the language the rest of the mail reading is.

export type DayPart = "morning" | "afternoon" | "evening";

export interface WhenRead {
  date?: string;
  /** HH:MM, 24-hour. Absent while AM or PM (or the hour itself) is unknown. */
  start?: string;
  /** HH:MM, only when the sentence stated an end or a length AND it stays inside the day. */
  end?: string;
  /** True when the sentence gave a range or a length, whether or not it fits inside one day. */
  durationStated: boolean;
  /** The sentence gave an end that is not the same day. It is not drawn; the default length applies. */
  overnight?: boolean;
  dayPart?: DayPart;
  timeZone?: string;
  missing: MeetingMissing[];
  /** True when the sentence names more than one day or more than one time. */
  conflicting: boolean;
  /** False when the sentence carries nothing that reads as a date or a time at all. */
  signals: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (mins: number) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;

const WEEKDAY_NAMES: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  tues: 2, thur: 4, thurs: 4, weds: 3,
  // Three-letter forms only where a digit or "at" follows, see below.
  mon: 1, tue: 2, wed: 3, thu: 4, fri: 5,
};
const SHORT_ONLY_WITH_TIME = new Set(["mon", "tue", "wed", "thu", "fri"]);

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5,
  june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9,
  october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

interface DayHit { iso: string; at: number; kind: "explicit" | "relative" | "weekday"; wd?: number; yearStated?: boolean }

// Days an email can name. Each hit carries its position so a repeated mention
// of the same day is one day, and two different days are a conflict.
function readDays(text: string, sourceDay: string): DayHit[] {
  const hits: DayHit[] = [];
  const sw = weekdayOfIso(sourceDay);
  const sy = Number(sourceDay.slice(0, 4));

  // 2026-09-23
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const iso = isoFromParts(+m[1]!, +m[2]!, +m[3]!);
    if (iso) hits.push({ iso, at: m.index!, kind: "explicit", yearStated: true });
  }

  // September 23rd, Sept. 23, Sep 23 2026. "may" only when capitalised: as a
  // lowercase word it is a verb ("we may 5 times").
  const monthAlt = "january|february|march|april|may|june|july|august|september|sept|sep|october|november|december|jan|feb|mar|apr|jun|jul|aug|oct|nov|dec";
  const md = new RegExp(`\\b(${monthAlt})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, "gi");
  for (const m of text.matchAll(md)) {
    const word = m[1]!;
    if (word === "may") continue;
    const month = MONTHS[word.toLowerCase()]!;
    const day = +m[2]!;
    if (m[3]) {
      const iso = isoFromParts(+m[3], month, day);
      if (iso) hits.push({ iso, at: m.index!, kind: "explicit", yearStated: true });
      continue;
    }
    // No year: the next time that date comes round, counted from the message.
    let iso = isoFromParts(sy, month, day);
    if (iso && iso < sourceDay) iso = isoFromParts(sy + 1, month, day);
    if (iso) hits.push({ iso, at: m.index!, kind: "explicit" });
  }
  // The 23rd of September
  const dm = new RegExp(`\\b(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)\\s+of\\s+(${monthAlt})\\b`, "gi");
  for (const m of text.matchAll(dm)) {
    if (m[2] === "may") continue;
    const month = MONTHS[m[2]!.toLowerCase()]!;
    let iso = isoFromParts(sy, month, +m[1]!);
    if (iso && iso < sourceDay) iso = isoFromParts(sy + 1, month, +m[1]!);
    if (iso) hits.push({ iso, at: m.index!, kind: "explicit" });
  }

  // 9/23 and 9/23/26, US order. A fraction ("1/2 an hour") is not a date, so a
  // digit or a slash on either side disqualifies it.
  for (const m of text.matchAll(/(?<![\d/])(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?(?![\d/])(?!\s*(?:an?\s+)?(?:hours?|hrs?|minutes?|mins?|miles?|cups?|off|of)\b)/g)) {
    const month = +m[1]!, day = +m[2]!;
    if (month < 1 || month > 12) continue;
    if (m[3]) {
      const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
      const iso = isoFromParts(year, month, day);
      if (iso) hits.push({ iso, at: m.index!, kind: "explicit", yearStated: true });
      continue;
    }
    let iso = isoFromParts(sy, month, day);
    if (iso && iso < sourceDay) iso = isoFromParts(sy + 1, month, day);
    if (iso) hits.push({ iso, at: m.index!, kind: "explicit" });
  }

  // Words: the day after tomorrow, tomorrow, today, tonight. Counted from the message.
  for (const m of text.matchAll(/\bday after tomorrow\b/gi)) hits.push({ iso: addDaysIso(sourceDay, 2), at: m.index!, kind: "relative" });
  for (const m of text.matchAll(/\b(?<!day after )tomorrow\b/gi)) hits.push({ iso: addDaysIso(sourceDay, 1), at: m.index!, kind: "relative" });
  for (const m of text.matchAll(/\b(today|tonight)\b/gi)) hits.push({ iso: sourceDay, at: m.index!, kind: "relative" });

  // Weekdays, with the "this" and "next" the sender may have put in front.
  const wdAlt = Object.keys(WEEKDAY_NAMES).join("|");
  for (const m of text.matchAll(new RegExp(`\\b(?:(this|next)\\s+)?(${wdAlt})\\b(\\.?)(\\s*,?\\s*(?:at\\b|\\d))?`, "gi"))) {
    const word = m[2]!.toLowerCase();
    if (SHORT_ONLY_WITH_TIME.has(word) && !m[4]) continue;
    const w = WEEKDAY_NAMES[word]!;
    const mode = (m[1] ?? "").toLowerCase();
    let delta: number;
    if (mode === "next") {
      // The following calendar week: the first Monday after the message, then
      // the named day within it. "Next Tuesday" said on a Monday is eight days
      // out, not tomorrow.
      const toNextMonday = ((8 - sw) % 7) || 7;
      delta = toNextMonday + ((w - 1 + 7) % 7);
    } else if (mode === "this") {
      delta = (w - sw + 7) % 7;
    } else {
      // Plain "Tuesday": the next one, strictly after the day it was written.
      delta = ((w - sw + 7) % 7) || 7;
    }
    hits.push({ iso: addDaysIso(sourceDay, delta), at: m.index!, kind: "weekday", wd: w });
  }

  // "the 22nd" on its own: the next 22nd, counted from the message.
  for (const m of text.matchAll(/\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b(?!\s+of\b)/gi)) {
    const day = +m[1]!;
    let y = sy, mo = Number(sourceDay.slice(5, 7));
    let iso = isoFromParts(y, mo, day);
    if (!iso || iso < sourceDay) {
      mo += 1; if (mo > 12) { mo = 1; y += 1; }
      iso = isoFromParts(y, mo, day);
    }
    if (iso) hits.push({ iso, at: m.index!, kind: "explicit" });
  }
  return hits;
}

interface TimeHit { start: number | null; end: number | null; hour?: number; minute?: number; at: number; explicitEnd: boolean; ambiguous: boolean; endAmbiguous?: boolean }

const to24 = (h: number, ap: "am" | "pm"): number => (h % 12) + (ap === "pm" ? 12 : 0);

// Times an email can name. `ambiguous` means an hour was read and AM or PM was
// not stated; the hour is kept on the hit so a day part can settle it.
function readTimes(text: string): TimeHit[] {
  const hits: TimeHit[] = [];
  const t = text.replace(/\b([ap])\.m\./gi, "$1m");
  const used: [number, number][] = [];
  const claim = (from: number, to: number) => used.push([from, to]);
  const taken = (from: number) => used.some(([a, b]) => from >= a && from < b);

  // Ranges: "3-4 PM", "3 PM to 4 PM", "10:30 to 11:30 am", "from 9 until 10".
  const range = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|\u2013|to|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/gi;
  for (const m of t.matchAll(range)) {
    const h1 = +m[1]!, mi1 = m[2] ? +m[2] : 0, h2 = +m[4]!, mi2 = m[5] ? +m[5] : 0;
    if (h1 < 1 || h1 > 12 || h2 < 1 || h2 > 12 || mi1 > 59 || mi2 > 59) continue;
    // "2026-09-23" and "9-23" are dates, not times: a range needs a meridiem
    // on at least one side or a clock colon to be read as hours.
    if (!m[3] && !m[6] && !m[2] && !m[5]) continue;
    const ap1 = (m[3]?.toLowerCase() as "am" | "pm" | undefined);
    const ap2 = (m[6]?.toLowerCase() as "am" | "pm" | undefined);
    if (!ap1 && !ap2) {
      hits.push({ start: null, end: null, hour: h1, minute: mi1, at: m.index!, explicitEnd: true, ambiguous: true, endAmbiguous: true });
      claim(m.index!, m.index! + m[0].length);
      continue;
    }
    let s: number;
    let e: number;
    if (ap1 && ap2) { s = to24(h1, ap1) * 60 + mi1; e = to24(h2, ap2) * 60 + mi2; }
    else if (ap2) {
      // "3-4 PM": the one meridiem covers both, unless that puts the start
      // after the end ("11-1 pm" is 11 AM to 1 PM).
      e = to24(h2, ap2) * 60 + mi2;
      s = to24(h1, ap2) * 60 + mi1;
      if (s >= e) s = to24(h1, ap2 === "pm" ? "am" : "pm") * 60 + mi1;
    } else {
      s = to24(h1, ap1!) * 60 + mi1;
      e = to24(h2, ap1!) * 60 + mi2;
    }
    hits.push({ start: s, end: e, at: m.index!, explicitEnd: true, ambiguous: false });
    claim(m.index!, m.index! + m[0].length);
  }

  // noon
  for (const m of t.matchAll(/\bnoon\b/gi)) {
    if (taken(m.index!)) continue;
    hits.push({ start: 12 * 60, end: null, at: m.index!, explicitEnd: false, ambiguous: false });
    claim(m.index!, m.index! + m[0].length);
  }

  // 3 PM, 3:30 pm, 3pm
  for (const m of t.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi)) {
    if (taken(m.index!)) continue;
    const h = +m[1]!, mi = m[2] ? +m[2] : 0;
    if (h < 1 || h > 12 || mi > 59) continue;
    hits.push({ start: to24(h, m[3]!.toLowerCase() as "am" | "pm") * 60 + mi, end: null, at: m.index!, explicitEnd: false, ambiguous: false });
    claim(m.index!, m.index! + m[0].length);
  }

  // 15:00, 08:30 (a 24-hour clock reads itself) and 3:30 (it does not).
  for (const m of t.matchAll(/(?<![\d:])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])/g)) {
    if (taken(m.index!)) continue;
    const h = +m[1]!, mi = +m[2]!;
    const twentyFour = h >= 13 || /^0\d/.test(m[1]!) || h === 0;
    if (twentyFour) hits.push({ start: h * 60 + mi, end: null, at: m.index!, explicitEnd: false, ambiguous: false });
    else hits.push({ start: null, end: null, hour: h, minute: mi, at: m.index!, explicitEnd: false, ambiguous: true });
    claim(m.index!, m.index! + m[0].length);
  }

  // "at 3", "around 3", "@ 3": an hour and nothing else. The lookahead keeps
  // "at 3 players" and "at 10%" from being read as clock times.
  for (const m of t.matchAll(/(?:\bat|\baround|@)\s+(\d{1,2})\b(?!\s*(?:%|:|\/|-|\d|st\b|nd\b|rd\b|th\b|people|players|kids|of\b|per\b|items|pm\b|am\b))/gi)) {
    if (taken(m.index!)) continue;
    const h = +m[1]!;
    if (h < 1 || h > 12) continue;
    hits.push({ start: null, end: null, hour: h, minute: 0, at: m.index!, explicitEnd: false, ambiguous: true });
  }
  return hits.sort((a, b) => a.at - b.at);
}

function readDayPart(text: string): DayPart | undefined {
  const found = new Set<DayPart>();
  if (/\b(morning|a\.?m\.? slot)\b/i.test(text)) found.add("morning");
  if (/\bafternoon\b/i.test(text)) found.add("afternoon");
  if (/\b(evening|tonight)\b/i.test(text)) found.add("evening");
  return found.size === 1 ? [...found][0] : undefined;
}

// "for an hour", "for 45 minutes", "90 minutes", "half an hour", "2 hours".
const WORD_NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4 };
function readLength(text: string): number | null {
  if (/\bhalf an? hour\b/i.test(text)) return 30;
  const m = /\b(?:for\s+)?(\d{1,3}(?:\.\d)?|an?|one|two|three|four)\s*(hours?|hrs?|minutes?|mins?)\b/i.exec(text);
  if (!m) return null;
  const raw = m[1]!.toLowerCase();
  const n = WORD_NUM[raw] ?? Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  const mins = /^h/i.test(m[2]!) ? Math.round(n * 60) : Math.round(n);
  // A 40-hour "meeting" is a misread, not a meeting.
  return mins >= 5 && mins <= 600 ? mins : null;
}

function readZoneIn(text: string): { zone?: string; ambiguous?: string } {
  // A zone follows a clock ("3 PM ET", "at 10:30 (PST)") or is an IANA name.
  // Bare "PT" or "CT" anywhere else is NOT read: "PT appointment" is physical
  // therapy, and a wrong zone would move the event by hours.
  const re = /(?:\d|\b[AaPp]\.?[Mm]\.?)\s*\(?\s*(?![Pp][Mm]\b|[Aa][Mm]\b)([A-Z]{2,5})\b\)?|\b((?:America|Europe|Asia|Africa|Australia|Pacific|Atlantic)\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)\b/g;
  for (const m of text.matchAll(re)) {
    const token = m[1] ?? m[2];
    if (!token) continue;
    const r = readZone(token);
    if (!r) continue;
    if ("zone" in r) return { zone: r.zone };
    return { ambiguous: r.ambiguous };
  }
  // Names that are not also words, anywhere in the sentence.
  for (const m of text.matchAll(/\b(EST|EDT|CDT|MST|MDT|PST|PDT|UTC|GMT)\b/g)) {
    const r = readZone(m[1]!);
    if (r && "zone" in r) return { zone: r.zone };
  }
  return {};
}

/**
 * When a sentence says. `sourceDay` is the day the MESSAGE was written, in the
 * zone it is read in (dayInZone of its own timestamp), never today.
 */
export function readWhen(sentence: string, sourceDay: string | null): WhenRead {
  const text = sentence.replace(/\s+/g, " ").trim();
  // A message with no usable timestamp has no "day it was written", so nothing
  // relative to it can be resolved: "tomorrow", "Tuesday" and a month-day with
  // no year all stay unresolved, and only a date that states its own year is
  // read. The card then asks for the day.
  const allDays = readDays(text, sourceDay ?? "2000-01-01");
  const days = sourceDay ? allDays : allDays.filter((d) => d.kind === "explicit" && d.yearStated);
  const times = readTimes(text);
  const part = readDayPart(text);
  const length = readLength(text);
  const zone = readZoneIn(text);

  // "Wednesday, September 23rd" is one day said twice. A weekday that AGREES
  // with an explicit date beside it is that date; one that does not is a
  // conflict, and the card asks rather than trusting either.
  const explicit = [...new Set(days.filter((d) => d.kind === "explicit").map((d) => d.iso))];
  const counted = explicit.length === 1
    ? days.filter((d) => d.kind !== "weekday" || d.wd !== weekdayOfIso(explicit[0]!))
    : days;
  const distinctDays = [...new Set(counted.map((d) => d.iso))];
  const conflictingDays = distinctDays.length > 1;
  const date = distinctDays.length === 1 ? distinctDays[0] : undefined;

  const distinctStarts = new Set(times.map((t) => (t.start !== null ? "s" + t.start : "h" + t.hour + ":" + t.minute)));
  const conflictingTimes = distinctStarts.size > 1;
  const one = times.length >= 1 && !conflictingTimes ? times[0]! : null;

  const missing: MeetingMissing[] = [];
  let start: number | null = null;
  let end: number | null = null;
  let stated = false;

  if (one) {
    if (!one.ambiguous && one.start !== null) {
      start = one.start;
      if (one.end !== null) { end = one.end; stated = true; }
    } else if (one.hour !== undefined) {
      // An hour with no AM or PM. A day part the sender wrote settles it
      // ("3 in the afternoon", "8 tonight"); otherwise it stays missing.
      const h = one.hour;
      if (part === "morning" && h <= 12) start = (h % 12) * 60 + (one.minute ?? 0);
      else if ((part === "afternoon" || part === "evening") && h <= 12) start = ((h % 12) + 12) * 60 + (one.minute ?? 0);
      else missing.push("meridiem");
    }
  }
  if (start === null && !missing.includes("meridiem")) {
    if (conflictingTimes) missing.push("time");
    else if (part || times.length === 0) missing.push("time");
  }
  if (start !== null && end === null && length) { end = start + length; stated = true; }
  if (start === null) { end = null; stated = false; }

  // A range that runs past midnight cannot be drawn on one day. The end is
  // dropped and the default length applies, rather than claiming 11:59 PM.
  let overnight = false;
  if (start !== null && end !== null && end <= start) { overnight = true; end = null; stated = false; }
  if (start !== null && end !== null && end > 24 * 60 - 1) { overnight = true; end = null; stated = false; }

  if (date === undefined) missing.unshift("date");
  if (zone.ambiguous) missing.push("timezone");

  const signals = allDays.length > 0 || times.length > 0 || !!part;
  return {
    ...(date ? { date } : {}),
    ...(start !== null ? { start: hhmm(start) } : {}),
    ...(end !== null ? { end: hhmm(end) } : {}),
    durationStated: stated,
    ...(overnight ? { overnight: true } : {}),
    ...(part ? { dayPart: part } : {}),
    ...(zone.zone ? { timeZone: zone.zone } : {}),
    missing,
    conflicting: conflictingDays || conflictingTimes,
    signals,
  };
}

/**
 * The hour a sentence named without saying AM or PM ("Tuesday at 3"), so the
 * card can ask "3 AM or 3 PM" in the sender's own number instead of guessing
 * which. Null when the sentence has no such hour, or has more than one.
 */
export function pendingHour(sentence: string): { hour: number; minute: number } | null {
  const hits = readTimes(sentence.replace(/\s+/g, " ")).filter((t) => t.ambiguous && t.hour !== undefined && !t.endAmbiguous);
  const all = readTimes(sentence.replace(/\s+/g, " "));
  if (hits.length !== 1 || all.length !== 1) return null;
  return { hour: hits[0]!.hour!, minute: hits[0]!.minute ?? 0 };
}
