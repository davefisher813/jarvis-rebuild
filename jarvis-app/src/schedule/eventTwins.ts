import type { EventData, EventItem } from "./types";

// TWIN EVENTS: ONE REAL THING, TWO ROWS (2026-10-01, the Schedule audit's #3:
// "Phone Interview with Equinox" twice at 11:30 on Fri Oct 2).
//
// An appointment can reach the calendar through several doors that do not know
// about each other: the Google import (gcalId), the "add this appointment"
// offer on an email (clientId), the older Today card for an email (a gmail
// source), a booking a stranger made through the public link (bookingId), and
// the person's own hand. Each door dedupes against ITSELF (one row per gcalId,
// one per clientId, one per bookingId) and none looked at the others, so the
// same interview arrived twice: once from Google, once from the email that
// announced it.
//
// WHAT COUNTS AS A TWIN: two one-off events on one day with the same title
// (case, spacing and edge punctuation ignored) and the same start, when at
// least one of them was made by a DOOR rather than by hand. End is left out
// on purpose: Google says 12:00 where the email's duration default says 12:30
// for the same hour, and that is still one interview. Two events the person
// typed in themselves are never twins, however alike: Duplicate exists, and
// a deliberate copy is theirs to keep.
//
// Pure. The same function drives three things, so they cannot disagree:
//   - dedupeEvents: the READ boundary, what the tabs draw;
//   - twinsToHeal: the importer's own redundant copies, which it deletes;
//   - findTwin: the WRITE boundary, so a door asks before it writes.

export const norm = (t: string | undefined): string =>
  (t ?? "").toLowerCase().replace(/\s+/g, " ").replace(/^[\s.,;:!?'"-]+|[\s.,;:!?'"-]+$/g, "");

/** Made by a door (an import, an email offer, a public booking), not typed in. */
export function isDoorMade(d: EventData): boolean {
  if (d.gcalId || d.bookingId || d.clientId) return true;
  const t = d.source?.type;
  return t === "email" || t === "gmail" || t === "google_calendar" || t === "apple_calendar";
}

/** How much of the person is in this copy; the one with more of them survives. */
export function userWork(d: EventData): number {
  return (d.category ? 1 : 0) + (d.taskIds?.length ? 1 : 0) + (d.gym ? 1 : 0) +
    (d.sourceTaskId ? 1 : 0) + (d.trained && Object.keys(d.trained).length ? 1 : 0) +
    (d.projectId ? 1 : 0) + (d.travelMin !== undefined ? 1 : 0);
}

const oneOff = (d: EventData): boolean => !d.recurrence || d.recurrence === "none";

export const twinKey = (d: Pick<EventData, "title" | "date" | "start">): string =>
  norm(d.title) + "|" + d.date + "|" + d.start;

/**
 * "Phone Interview" and "Phone Interview with Equinox" at one start are the
 * same appointment named two ways; the offer on an email uses the subject,
 * the calendar uses what the organiser typed. Equal after normalising, or one
 * contains the other and is long enough not to be an accident.
 */
export function titlesAlike(a: string, b: string): boolean {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 8 && long.includes(short);
}

/**
 * Which copy survives a group of twins: more of the person in it first; then
 * the copy a booking or an explicit tap made over the importer's; then the
 * first by id, so the answer never depends on read order.
 */
function better(a: EventItem, b: EventItem): boolean {
  const ex = (d: EventData) => (d.bookingId ? 3 : d.clientId ? 2 : d.gcalId ? 0 : 1);
  const wa = userWork(a.data), wb = userWork(b.data);
  if (wa !== wb) return wa > wb;
  const ea = ex(a.data), eb = ex(b.data);
  if (ea !== eb) return ea > eb;
  return a.id < b.id;
}

/** Groups of twins as [survivor, ...redundant]. Empty groups are never returned. */
export function twinGroups(items: EventItem[]): EventItem[][] {
  const by = new Map<string, EventItem[]>();
  for (const e of items) {
    if (!oneOff(e.data) || !e.data.date || !e.data.start) continue;
    const k = twinKey(e.data);
    const g = by.get(k);
    if (g) g.push(e); else by.set(k, [e]);
  }
  const out: EventItem[][] = [];
  for (const g of by.values()) {
    if (g.length < 2 || !g.some((e) => isDoorMade(e.data))) continue;
    const sorted = [...g].sort((a, b) => (better(a, b) ? -1 : 1));
    out.push(sorted);
  }
  return out;
}

/** The READ boundary: the same list with each twin group drawn once. */
export function dedupeEvents(items: EventItem[]): EventItem[] {
  const hide = new Set<string>();
  for (const g of twinGroups(items)) for (const e of g.slice(1)) hide.add(e.id);
  return hide.size ? items.filter((e) => !hide.has(e.id)) : items;
}

/**
 * Redundant copies SAFE TO DELETE: the Google importer's own row (it is the
 * importer's to manage, and it never carries the person's work if userWork is
 * zero) when a twin survives it. Anything else (an email's row, a booking,
 * something typed) is hidden by dedupeEvents but never removed unseen.
 */
export function twinsToHeal(items: EventItem[]): string[] {
  const out: string[] = [];
  for (const g of twinGroups(items)) {
    for (const e of g.slice(1)) {
      if (e.data.gcalId && !e.data.bookingId && userWork(e.data) === 0) out.push(e.id);
    }
  }
  return out;
}

/**
 * The WRITE boundary: is there already an event this one would duplicate?
 * Same day and start, a matching title, one-off. Asked by the DOORS (the
 * import, the email offers) before they write; a person adding a second one
 * by hand never asks, since a deliberate copy is theirs to keep.
 */
export function findTwin(
  items: EventItem[],
  want: { title: string; date: string; start: string },
  loose = false,
): EventItem | null {
  for (const e of items) {
    if (!oneOff(e.data)) continue;
    if (e.data.date !== want.date || e.data.start !== want.start) continue;
    if (loose ? titlesAlike(e.data.title, want.title) : norm(e.data.title) === norm(want.title)) return e;
  }
  return null;
}
