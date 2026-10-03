// DATES, TIMES AND ZONES, READ WITHOUT GUESSING (IMPLEMENTATION-SPEC.md 10.1
// step 6; 13). An explicit date is read as written; a year the text left out
// is the message's year, or the next one when that would put the date two
// months behind the message. A relative word (tomorrow, Friday) is anchored
// to the message's own date but flagged, so the card asks rather than decides.
// A slash date whose two numbers could both be a month is ambiguous and asks.
// A time without a zone has no instant; the card asks for the zone. A wall
// clock that does not exist in its zone, or happens twice, asks for the exact
// offset. Nothing silently picks AM or PM, a zone, or a year.

export interface DateHit { iso: string | null; start: number; end: number; raw: string; relative: boolean; ambiguous: boolean }
export interface TimeHit { hh: number; mm: number; start: number; end: number; zone: string | null; endHH?: number; endMM?: number }

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const pad = (n: number): string => String(n).padStart(2, "0");
export const isoOf = (y: number, m: number, d: number): string => `${y}-${pad(m)}-${pad(d)}`;

export function isRealDay(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return isoOf(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

/** The year a month-and-day most plausibly belongs to: the anchor's, unless that puts it more than sixty days behind the anchor. */
export function yearFor(month: number, day: number, anchorISO: string): number {
  const y = Number(anchorISO.slice(0, 4));
  if (!isRealDay(y, month, day)) return isRealDay(y + 1, month, day) ? y + 1 : y;
  return daysBetween(anchorISO, isoOf(y, month, day)) < -60 ? y + 1 : y;
}

/** Every date in the text, in order. anchorISO is the message's own date (in its zone), YYYY-MM-DD. */
export function findDates(text: string, anchorISO: string): DateHit[] {
  const hits: DateHit[] = [];
  const taken = (s: number, e: number) => hits.some((h) => s < h.end && e > h.start);
  const push = (h: DateHit) => { if (!taken(h.start, h.end)) hits.push(h); };

  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    push({ iso: isRealDay(y, mo, d) ? isoOf(y, mo, d) : null, start: m.index!, end: m.index! + m[0].length, raw: m[0], relative: false, ambiguous: !isRealDay(y, mo, d) });
  }
  const monthDay = new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, "gi");
  for (const m of text.matchAll(monthDay)) {
    const mo = MONTHS[m[1]!.toLowerCase()]!, d = Number(m[2]);
    const y = m[3] ? Number(m[3]) : yearFor(mo, d, anchorISO);
    push({ iso: isRealDay(y, mo, d) ? isoOf(y, mo, d) : null, start: m.index!, end: m.index! + m[0].length, raw: m[0], relative: false, ambiguous: !isRealDay(y, mo, d) });
  }
  const dayMonth = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\.?(?:,?\\s+(\\d{4}))?\\b`, "gi");
  for (const m of text.matchAll(dayMonth)) {
    const d = Number(m[1]), mo = MONTHS[m[2]!.toLowerCase()]!;
    const y = m[3] ? Number(m[3]) : yearFor(mo, d, anchorISO);
    push({ iso: isRealDay(y, mo, d) ? isoOf(y, mo, d) : null, start: m.index!, end: m.index! + m[0].length, raw: m[0], relative: false, ambiguous: !isRealDay(y, mo, d) });
  }
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g)) {
    const a = Number(m[1]), b = Number(m[2]);
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    let iso: string | null = null;
    let ambiguous = false;
    if (a > 12 && b <= 12) iso = isRealDay(y, b, a) ? isoOf(y, b, a) : null;
    else if (b > 12 && a <= 12) iso = isRealDay(y, a, b) ? isoOf(y, a, b) : null;
    else ambiguous = true;
    push({ iso, start: m.index!, end: m.index! + m[0].length, raw: m[0], relative: false, ambiguous: ambiguous || iso === null });
  }
  // Relative words: anchored, and flagged.
  const anchorDow = new Date(anchorISO + "T00:00:00Z").getUTCDay();
  for (const m of text.matchAll(/\b(today|tonight|tomorrow|day after tomorrow|(?:next|this)\s+(?:week|month)|(?:next|this)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b|end of (?:the )?(?:week|month))\b/gi)) {
    const word = m[1]!.toLowerCase().replace(/\s+/g, " ").trim();
    let iso: string | null = null;
    if (word === "today" || word === "tonight") iso = anchorISO;
    else if (word === "tomorrow") iso = addDays(anchorISO, 1);
    else if (word === "day after tomorrow") iso = addDays(anchorISO, 2);
    else if (m[2]) {
      const want = WEEKDAYS.indexOf(m[2].toLowerCase());
      let ahead = (want - anchorDow + 7) % 7;
      if (ahead === 0) ahead = 7;
      if (/^next\b/.test(word) && ahead < 7) ahead += 7;
      iso = addDays(anchorISO, ahead);
    }
    push({ iso, start: m.index!, end: m.index! + m[0].length, raw: m[0], relative: true, ambiguous: iso === null });
  }
  return hits.sort((a, b) => a.start - b.start);
}

/** The first date whose own sentence or the sixty characters before it carry one of the words. */
export function dateNear(hits: DateHit[], text: string, words: RegExp): DateHit | null {
  for (const h of hits) {
    const context = text.slice(Math.max(0, h.start - 60), h.start);
    if (words.test(context)) return h;
  }
  return null;
}

// ---- zones ----------------------------------------------------------------

const ZONE_WORDS: Array<[RegExp, string]> = [
  [/\b(ET|EST|EDT|Eastern(?: Time)?|US\/Eastern|America\/New_York)\b/i, "America/New_York"],
  [/\b(CT|CST|CDT|Central(?: Time)?|America\/Chicago)\b/i, "America/Chicago"],
  [/\b(MT|MST|MDT|Mountain(?: Time)?|America\/Denver)\b/i, "America/Denver"],
  [/\b(PT|PST|PDT|Pacific(?: Time)?|America\/Los_Angeles)\b/i, "America/Los_Angeles"],
  [/\b(Arizona(?: Time)?|America\/Phoenix)\b/i, "America/Phoenix"],
  [/\b(AKST|AKDT|Alaska(?: Time)?)\b/i, "America/Anchorage"],
  [/\b(HST|Hawaii(?: Time)?)\b/i, "Pacific/Honolulu"],
  [/\b(UTC|GMT|Zulu)\b/, "UTC"],
  [/\b(BST|London time|Europe\/London)\b/i, "Europe/London"],
  [/\b(CET|CEST|Central European(?: Time)?|Europe\/Berlin|Europe\/Paris)\b/i, "Europe/Berlin"],
];

/** The IANA zone a stretch of text names, or null. */
export function zoneIn(text: string): string | null {
  for (const [re, zone] of ZONE_WORDS) if (re.test(text)) return zone;
  return null;
}

/** Every time of day in the text: a clock with AM or PM, or a 24-hour clock, with a zone named within reach and a range's end when there is one. */
export function findTimes(text: string): TimeHit[] {
  const out: TimeHit[] = [];
  const re = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?:\s*(?:[-\u2012-\u2015]|to|until)\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?)?/gi;
  for (const m of text.matchAll(re)) {
    const h1 = Number(m[1]);
    const min1 = m[2] ? Number(m[2]) : 0;
    const ap1 = m[3]?.replace(/\./g, "").toLowerCase();
    const h2 = m[4] !== undefined ? Number(m[4]) : undefined;
    const min2 = m[5] ? Number(m[5]) : 0;
    const ap2 = m[6]?.replace(/\./g, "").toLowerCase();
    // A clock is a clock only with AM/PM, a colon, or an AM/PM on the range's end.
    const isClock = !!ap1 || m[2] !== undefined || !!ap2;
    if (!isClock) continue;
    // "October 4" and "2026" must not read as times: a bare number with no colon and no AM/PM already skipped above.
    const to24 = (h: number, ap: string | undefined, fallback: string | undefined): number | null => {
      const a = ap ?? fallback;
      if (a === "am") return h === 12 ? 0 : h;
      if (a === "pm") return h === 12 ? 12 : h + 12;
      return h;
    };
    const hh = to24(h1, ap1, ap2);
    if (hh === null || hh > 23 || min1 > 59) continue;
    const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 24);
    const zone = zoneIn(after.split(/[.,;!?\n]/)[0] ?? "");
    const hit: TimeHit = { hh, mm: min1, start: m.index!, end: m.index! + m[0].length, zone };
    if (h2 !== undefined) {
      const eh = to24(h2, ap2, ap1);
      if (eh !== null && eh <= 23 && min2 <= 59) { hit.endHH = eh; hit.endMM = min2; }
    }
    out.push(hit);
  }
  return out;
}

const WORD_NUMBERS: Record<string, number> = { fifteen: 15, twenty: 20, thirty: 30, "forty-five": 45, "forty five": 45, sixty: 60, ninety: 90, ten: 10, five: 5, "an hour": 60, "one hour": 60, "half an hour": 30, "two hours": 120, "half hour": 30 };

/** A stated duration in minutes, or null. "Fifteen minutes should be enough" is fifteen. */
export function durationIn(text: string): number | null {
  const m = /\b(\d{1,3}|fifteen|twenty|thirty|forty[- ]five|sixty|ninety|ten|five)[- ]?(?:minutes?|mins?)\b/i.exec(text);
  if (m) { const w = m[1]!.toLowerCase(); return WORD_NUMBERS[w] ?? Number(w); }
  const h = /\b(half an hour|half hour|an hour|one hour|two hours|(\d{1,2})\s*(?:hours?|hrs?))\b/i.exec(text);
  if (h) { if (h[2]) return Number(h[2]) * 60; return WORD_NUMBERS[h[1]!.toLowerCase()] ?? null; }
  return null;
}

// ---- instants -------------------------------------------------------------

function offsetMinutes(utcMs: number, zone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(utcMs));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") === 24 ? 0 : get("hour"), get("minute"), get("second"));
    return Math.round((asUtc - utcMs) / 60000);
  } catch {
    return null;
  }
}

const fmtOffset = (min: number): string => `${min < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(min) / 60))}:${pad(Math.abs(min) % 60)}`;

export type Instant =
  | { ok: true; iso: string; offset: string }
  | { ok: false; why: "zone" | "nonexistent" | "ambiguous"; offsets?: string[] };

/**
 * A wall clock in a zone as an instant. The two readings the clock could have
 * around a DST change are tried: a clock that exists once is one instant; one
 * that exists twice is ambiguous (the person picks the offset); one that does
 * not exist is nonexistent (the save is blocked until the time is changed).
 */
export function instantOf(dateISO: string, hh: number, mm: number, zone: string, selectedOffset?: string): Instant {
  const [y, mo, d] = dateISO.split("-").map(Number) as [number, number, number];
  const wall = Date.UTC(y, mo - 1, d, hh, mm);
  const found = new Map<string, number>();
  for (const guess of [-12 * 60, -1 * 60, 0, 60, 12 * 60]) {
    const off0 = offsetMinutes(wall - guess * 60000, zone);
    if (off0 === null) return { ok: false, why: "zone" };
    const utc = wall - off0 * 60000;
    const off1 = offsetMinutes(utc, zone);
    if (off1 === off0) found.set(fmtOffset(off1), utc);
  }
  if (found.size === 0) return { ok: false, why: "nonexistent" };
  if (found.size > 1) {
    if (selectedOffset && found.has(selectedOffset)) return { ok: true, iso: new Date(found.get(selectedOffset)!).toISOString(), offset: selectedOffset };
    return { ok: false, why: "ambiguous", offsets: [...found.entries()].sort((a, b) => a[1] - b[1]).map(([o]) => o) };
  }
  const [offset, utc] = [...found.entries()][0]!;
  return { ok: true, iso: new Date(utc).toISOString(), offset };
}

/** The message's own calendar date in a zone (the anchor for relative words). */
export function dateInZone(instantISO: string, zone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instantISO));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return instantISO.slice(0, 10);
  }
}
