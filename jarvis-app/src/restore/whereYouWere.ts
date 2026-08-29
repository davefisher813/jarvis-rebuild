// Where You Were (addendum item 6, Group A). Continuous state persist with
// exact restore. Flows record the spot the user is working in; Today offers
// ONE line back to it. The offer shows only when the spot is from a PRIOR
// sitting (older than the session gap) and younger than 12 hours; the moment
// the user does anything new the record refreshes and the offer vanishes,
// because a fresh record is by definition this sitting, not a restore.

export interface WorkSpot {
  kind: "note" | "task" | "event" | "gym";
  id: string;
  label: string;
  ts: number;
}

const KEY = "jarvis.whereyouwere.v1";
const DISMISSED_KEY = "jarvis.whereyouwere.dismissed.v1";
// Younger than this = the current sitting, no banner. Older = a return.
export const SESSION_GAP_MS = 5 * 60_000;
export const EXPIRY_MS = 12 * 3600e3;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

// Flows call this on meaningful activity (opening an editor, logging a set).
// Constant overwrite is the design: the record is always the latest spot.
export function recordSpot(spot: Omit<WorkSpot, "ts">, now: () => number = Date.now): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(KEY, JSON.stringify({ ...spot, ts: now() } satisfies WorkSpot));
  } catch { /* restore is a nicety */ }
}

// Any activity that is not a recordable spot still proves the user is HERE
// (typing, completing, capturing): refresh the timestamp so the banner stays
// gone for this sitting.
export function touchActivity(now: () => number = Date.now): void {
  const s = storage();
  if (!s) return;
  try {
    const raw = s.getItem(KEY);
    if (!raw) return;
    const spot = JSON.parse(raw) as WorkSpot;
    spot.ts = now();
    s.setItem(KEY, JSON.stringify(spot));
  } catch { /* nothing to refresh */ }
}

// The banner's read: a spot from a prior sitting, not yet expired, not
// waved off, and -- when the caller can say -- still pointing at something
// that exists.
//
// LAW 1 (Dave 2026-08-29): the spot is a bookmark, and a bookmark outlives
// the page. Deleting the note it names left "Journal · Left 5h ago · Resume"
// on the home page for up to twelve hours, offering to reopen nothing. The
// only clearSpot caller was the Resume button itself, so nothing else could
// ever retire it. `exists` lets the caller -- which is the one holding the
// live lists -- answer for it. Omitting the check keeps the old behaviour
// for callers with nothing to check against (tests, the gym flow).
export function restorableSpot(
  now: () => number = Date.now,
  exists?: (spot: WorkSpot) => boolean,
): WorkSpot | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(KEY);
    if (!raw) return null;
    const spot = JSON.parse(raw) as WorkSpot;
    const age = now() - spot.ts;
    if (age < SESSION_GAP_MS || age > EXPIRY_MS) return null;
    if (!spot.id || !spot.label) return null;
    if (isSpotDismissed(spot, s)) return null;
    if (exists && !exists(spot)) return null;
    return spot;
  } catch {
    return null;
  }
}

// LAW 2: the Resume card had no dismiss at all -- swiping it revealed an
// empty rail, so the only exits were taking it or waiting out the twelve
// hours, and any visit longer than five minutes ago re-armed it. Dismissal
// is keyed to the exact spot (kind + id + timestamp): coming back to the
// same note later records a NEW spot, which is a fresh offer, not the one
// that was waved off.
function spotKey(spot: WorkSpot): string {
  return `${spot.kind}:${spot.id}:${spot.ts}`;
}

function isSpotDismissed(spot: WorkSpot, s: Storage): boolean {
  try { return s.getItem(DISMISSED_KEY) === spotKey(spot); } catch { return false; }
}

export function dismissSpot(spot: WorkSpot): void {
  const s = storage();
  if (!s) return;
  try { s.setItem(DISMISSED_KEY, spotKey(spot)); } catch { /* the card reappears; harmless */ }
}

export function clearSpot(): void {
  const s = storage();
  if (!s) return;
  try { s.removeItem(KEY); s.removeItem(DISMISSED_KEY); } catch { /* gone is gone */ }
}

// "Training Plan note · 25 min ago"
export function spotMeta(spot: WorkSpot, now: () => number = Date.now): string {
  const noun = spot.kind === "note" ? "note" : spot.kind === "task" ? "task" : spot.kind === "event" ? "event" : "gym session";
  const mins = Math.round((now() - spot.ts) / 60_000);
  const when = mins < 60 ? `${mins} Min ago` : `${Math.round(mins / 60)} ${Math.round(mins / 60) === 1 ? "Hour" : "Hours"} ago`;
  return `${spot.label} ${noun} · ${when}`;
}

// The quiet-line form of the age (Law 3E, 2026-08-22): fused units, no noun.
// "Left 9h ago" -- the row's title already names the thing, so repeating its
// kind here was the old sub's padding.
export function spotAgo(spot: WorkSpot, now: () => number = Date.now): string {
  const mins = Math.max(1, Math.round((now() - spot.ts) / 60_000));
  const span = mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`;
  return `Left ${span} ago`;
}
