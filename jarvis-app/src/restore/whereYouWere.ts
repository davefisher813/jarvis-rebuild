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

// The banner's read: a spot from a prior sitting, not yet expired.
export function restorableSpot(now: () => number = Date.now): WorkSpot | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(KEY);
    if (!raw) return null;
    const spot = JSON.parse(raw) as WorkSpot;
    const age = now() - spot.ts;
    if (age < SESSION_GAP_MS || age > EXPIRY_MS) return null;
    if (!spot.id || !spot.label) return null;
    return spot;
  } catch {
    return null;
  }
}

export function clearSpot(): void {
  const s = storage();
  if (!s) return;
  try { s.removeItem(KEY); } catch { /* gone is gone */ }
}

// "Training Plan note · 25 min ago"
export function spotMeta(spot: WorkSpot, now: () => number = Date.now): string {
  const noun = spot.kind === "note" ? "note" : spot.kind === "task" ? "task" : spot.kind === "event" ? "event" : "gym session";
  const mins = Math.round((now() - spot.ts) / 60_000);
  const when = mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} ${Math.round(mins / 60) === 1 ? "hour" : "hours"} ago`;
  return `${spot.label} ${noun} · ${when}`;
}
