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
