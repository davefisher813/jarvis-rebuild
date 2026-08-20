import type { ThreadRow } from "../connections/google/map";
import { capAfterNumber } from "../shared/casing";

// Nothing-slips safety net (relief track #1).
//
// The fold is only calm if nothing can rot behind it. A thread that has sat in
// "needs you" for three days stops being an email problem and becomes a task:
// it leaves the inbox's gravity and joins the list Dave actually works from.
//
// Laws:
//   - ONCE per thread, ever. A task that reappears every open is nagging, and
//     nagging is the thing this whole track exists to remove.
//   - The marker is by thread id, so a re-triaged or archived thread never
//     produces a second task.
//   - No shame vocabulary anywhere in the copy. It is a receipt, not a scold.

const KEY = "jarvis.mail.netted.v1";
const CAP = 300;
export const NET_DAYS = 3;
// At most this many per pass. Thirty tasks arriving at once is not relief, it
// is the pile with a new name.
export const NET_MAX_PER_PASS = 5;
const SEEDED = "jarvis.mail.netted.seeded.v1";
const DAY_MS = 86400000;

export function loadNetted(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function saveNetted(ids: string[]): void {
  // Newest wins when the cap bites: old ids matter least, their threads are
  // long gone from the inbox.
  try { localStorage.setItem(KEY, JSON.stringify(ids.slice(-CAP))); } catch { /* private mode */ }
}

// Threads that have been waiting long enough AND have never been netted.
// `now` is injected so this is deterministic under test.
export function netCandidates(
  needsYou: ThreadRow[],
  netted: string[],
  now: number,
  days: number = NET_DAYS,
  max: number = NET_MAX_PER_PASS,
): ThreadRow[] {
  const cutoff = now - days * DAY_MS;
  const seen = new Set(netted);
  return needsYou
    .filter((r) => !seen.has(r.id) && r.dateMs > 0 && r.dateMs <= cutoff)
    .sort((a, b) => a.dateMs - b.dateMs) // oldest first: they earned it
    .slice(0, max);
}

// The first time the app ever sees this inbox, the backlog is not news. Every
// old thread gets marked as already caught, silently, and the net starts
// working from things that go stale from here on. Without this, connecting an
// account for the first time dumps the entire history into the task list.
export function seedFirstRun(needsYou: ThreadRow[]): boolean {
  let seeded = false;
  try { seeded = localStorage.getItem(SEEDED) === "1"; } catch { return true; }
  if (seeded) return false;
  try {
    localStorage.setItem(SEEDED, "1");
    saveNetted([...loadNetted(), ...needsYou.map((r) => r.id)]);
  } catch { /* private mode: the cap alone keeps it survivable */ }
  return true;
}

// The quiet line under the fold. Absent when nothing was netted: a receipt is
// derived or it does not render.
export function guardLine(n: number, days: number = NET_DAYS): string {
  if (n <= 0) return "";
  const what = capAfterNumber(n === 1 ? "1 email" : n + " emails");
  return what + " over " + days + " days old · now tasks";
}
