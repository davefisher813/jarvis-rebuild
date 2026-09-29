import { fireAt } from "../tasks/reminders";

// WALL CLOCKS AND ZONES, FOR READING WHAT AN EMAIL SAYS (2026-09-29).
//
// An email that says "tomorrow at 10" means tomorrow relative to when it was
// SENT, in the zone the sender and reader share, not relative to the day it
// happens to be opened. And a calendar file that says 1 PM Eastern means an
// instant, which lands on a different wall clock in another zone and moves
// with daylight saving. Both need a zone database, and the platform already
// ships one behind Intl, so nothing here carries a table of offsets.
//
// The zone the app knows is the DEVICE's: there is no profile timezone. Every
// caller that needs "the account's zone" asks deviceZone(), so if a profile
// zone is ever added it is one line here.
//
// Pure, no imports beyond fireAt (tasks/reminders.ts), which already resolves
// a fixed zone's wall clock to an instant with the zone's own offset at that
// date, so a DST change inside the zone is honoured.

/** The zone this phone is in. "UTC" only when the platform cannot say. */
export function deviceZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

export function isValidZone(zone: string | undefined): zone is string {
  if (!zone) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(0); return true; } catch { return false; }
}

const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD from parts, or null when the day is not on any calendar (2026-02-31). */
export function isoFromParts(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${pad(m)}-${pad(d)}`;
}

export function validIso(iso: string | undefined): iso is string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  return !!m && isoFromParts(+m[1]!, +m[2]!, +m[3]!) === iso;
}

/** Calendar arithmetic on a day string. UTC underneath, so a DST change never moves it. */
export function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 0 = Sunday. */
export function weekdayOfIso(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The wall clock an instant reads in a zone. */
export function wallInZone(ms: number, zone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  // Some engines print midnight as 24.
  const hour = Number(get("hour")) % 24;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${pad(hour)}:${get("minute")}` };
}

/** The day an instant falls on in a zone. This is how a message's own date is read, never "today". */
export function dayInZone(ms: number, zone: string): string {
  return wallInZone(ms, zone).date;
}

/** The instant a wall clock means in a zone, with that zone's offset at that date. */
export function instantAt(date: string, time: string, zone: string): number {
  return fireAt(date, time, zone).getTime();
}

/**
 * Whether the wall clock exists in the zone exactly once. A spring-forward
 * gap has no 2:30 AM (the clock jumps from 2:00 to 3:00) and a fall-back hour
 * has two of them; either way "2:30 AM that day" is not one moment, and
 * anything built on it must say so instead of picking one.
 */
export function wallStatus(date: string, time: string, zone: string): "ok" | "gap" | "repeated" {
  const ms = instantAt(date, time, zone);
  const back = wallInZone(ms, zone);
  if (back.date !== date || back.time !== time) return "gap";
  // The same wall clock an hour earlier or later, in the same zone, means the
  // clock ran through it twice.
  for (const shift of [-3600_000, 3600_000]) {
    const other = wallInZone(ms + shift, zone);
    if (other.date === date && other.time === time) return "repeated";
  }
  return "ok";
}

/** A wall clock in one zone, as the wall clock in another. Null when the source wall clock is not a single real moment. */
export function convertWall(
  date: string, time: string, from: string, to: string,
): { date: string; time: string } | null {
  if (from === to) return { date, time };
  if (wallStatus(date, time, from) !== "ok") return null;
  return wallInZone(instantAt(date, time, from), to);
}

/** "EDT", "PST", or a GMT offset where the platform has no short name. */
export function zoneShortName(zone: string, atMs: number): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" })
      .formatToParts(new Date(atMs)).find((p) => p.type === "timeZoneName")?.value ?? zone;
  } catch { return zone; }
}

// The abbreviations an email actually writes. Each names ONE zone. The ones
// that name two (CST is Central US and China, IST is India, Ireland and
// Israel, BST is British and Bangladesh) are deliberately absent: an
// ambiguous abbreviation stays missing rather than being guessed, and the
// card asks. The US abbreviations stand for the zone, not the season: "ET"
// is New York all year, and "EST" said in July still means New York.
const ABBREV: Record<string, string> = {
  ET: "America/New_York", EST: "America/New_York", EDT: "America/New_York",
  CT: "America/Chicago", CDT: "America/Chicago",
  MT: "America/Denver", MST: "America/Denver", MDT: "America/Denver",
  PT: "America/Los_Angeles", PST: "America/Los_Angeles", PDT: "America/Los_Angeles",
  AKST: "America/Anchorage", AKDT: "America/Anchorage", HST: "Pacific/Honolulu",
  UTC: "UTC", GMT: "UTC",
  CET: "Europe/Paris", CEST: "Europe/Paris", EET: "Europe/Athens", EEST: "Europe/Athens",
  JST: "Asia/Tokyo", AEST: "Australia/Sydney", AEDT: "Australia/Sydney",
};
const AMBIGUOUS = new Set(["CST", "IST", "BST", "AST", "ACT", "WST", "SST", "PST8PDT"]);

export type ZoneRead = { zone: string } | { ambiguous: string } | null;

/** A zone abbreviation or IANA name, read as a zone. Ambiguous abbreviations report themselves. */
export function readZone(token: string): ZoneRead {
  const t = token.trim();
  if (!t) return null;
  const up = t.toUpperCase();
  if (ABBREV[up]) return { zone: ABBREV[up]! };
  if (AMBIGUOUS.has(up)) return { ambiguous: up };
  if (/^[A-Za-z_]+\/[A-Za-z_\-+0-9/]+$/.test(t) && isValidZone(t)) return { zone: t };
  return null;
}

/** Every zone abbreviation this file will read, for a scanner that must not mistake "MT" in a word for one. */
export const ZONE_TOKENS: readonly string[] = [...Object.keys(ABBREV), ...AMBIGUOUS];
