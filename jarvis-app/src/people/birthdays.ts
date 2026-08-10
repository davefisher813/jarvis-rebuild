import type { Person } from "./types";

// Birthdays on Today (ride-along, 2026-08-03). People records have carried a
// birthday field since Session 3-era imports and the app never looked at it.
// Fully derived from stored data; shown ONLY on the day itself, so its absence
// is the normal state and its presence means exactly one thing.

export interface BirthdayHit {
  id: string;
  name: string;
}

const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];

// The formats the app itself produces, and nothing else:
// - contact imports write YYYY-MM-DD
// - the Person sheet is free text whose placeholder suggests "March 4"
// Slash dates (3/4) are REJECTED on purpose: month/day vs day/month is
// ambiguous, and a birthday greeting on the wrong day is worse than none
// (accuracy principle).
export function birthdayMonthDay(b: string | undefined): string | null {
  if (!b) return null;
  const t = b.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t.slice(5);
  if (/^\d{2}-\d{2}$/.test(t)) return t;
  // "March 4", "march 4th", "Mar 4" (English month names, unambiguous)
  const m = t.toLowerCase().match(/^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?$/);
  if (m) {
    const idx = MONTHS.findIndex((name) => name === m[1] || name.slice(0, 3) === m[1]);
    const day = Number(m[2]);
    if (idx >= 0 && day >= 1 && day <= 31) {
      return String(idx + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
    }
  }
  return null;
}

// Upcoming birthdays (2026-08-10): the people-kind category page shows the
// next `windowDays` of birthdays among ITS people, so "Family" answers the
// question a family page should ("anyone's day coming up?") instead of
// listing tasks. Year wrap handled (a late-December today still sees early
// January). Feb 29 in a non-leap year lands on Mar 1: a greeting a day late
// beats one that never fires. Same accuracy stance as birthdaysOn: no ages,
// the stored year is unreliable.
export interface UpcomingBirthday { id: string; name: string; inDays: number; label: string }

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function upcomingBirthdays(people: Person[], todayIso: string, windowDays = 30): UpcomingBirthday[] {
  const todayMs = Date.parse(todayIso + "T00:00:00Z");
  if (!isFinite(todayMs)) return [];
  const year = Number(todayIso.slice(0, 4));
  const out: UpcomingBirthday[] = [];
  for (const p of people) {
    const mmdd = birthdayMonthDay(p.data.birthday);
    if (!mmdd) continue;
    const mo = Number(mmdd.slice(0, 2));
    const day = Number(mmdd.slice(3));
    let t = Date.UTC(year, mo - 1, day);
    if (t < todayMs) t = Date.UTC(year + 1, mo - 1, day);
    const inDays = Math.round((t - todayMs) / 86400000);
    if (inDays > windowDays) continue;
    const d2 = new Date(t); // re-read so Feb 29 rollover prints its real date
    const label = inDays === 0 ? "Today" : inDays === 1 ? "Tomorrow" : `${MONTH_ABBR[d2.getUTCMonth()]} ${d2.getUTCDate()}`;
    out.push({ id: p.id, name: p.data.name, inDays, label });
  }
  return out.sort((a, b) => a.inDays - b.inDays || a.name.localeCompare(b.name));
}

// Match on month-day. The stored year is often a guess or absent (contact
// imports), so age is never computed and never shown; "turns a year older" is
// all the copy may claim.
export function birthdaysOn(people: Person[], todayIso: string): BirthdayHit[] {
  const mmdd = todayIso.slice(5); // "MM-DD"
  if (mmdd.length !== 5) return [];
  return people
    .filter((p) => birthdayMonthDay(p.data.birthday) === mmdd)
    .map((p) => ({ id: p.id, name: p.data.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
