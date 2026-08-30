// THE SWEEP (Dave 2026-08-25, the Anti-Inbox catalog, picks 2A 3A 4A 5A 6A
// 7A 10A, all approved in one string).
//
// The research behind the catalog says an inbox hurts through six mechanisms:
// an infinite pile, a count that only rises, unmade decisions, invisible time
// cost, sensory flatness, and no payoff. The Sweep is the surface built as
// their opposite: it deals a HAND (never the pile), counts DOWN (never up),
// leads with the decision already made, wears its time cost on every card,
// pays every kill, and ends somewhere: a finish screen with real receipts.
//
// This module is the pure logic. The presentation lives in DeckFlow; keeping
// the arithmetic here means every promise the screen makes is held by a test.

export const HAND_MAX = 9;
export const SESSION_MS = 5 * 60_000;

// THE HAND (3A). Never the pile: a session takes at most nine, and the rest
// stay face-down in the deck. Nine because the countdown ring (2A) must never
// show a scary number, and because five minutes (5A) at half a minute a card
// is honestly about nine cards.
export function dealHand<T>(rows: readonly T[]): T[] {
  return rows.slice(0, HAND_MAX);
}

// THE CLOCK ON EVERY CARD (5A). "A two-minute task can feel like it might
// swallow an hour. That uncertainty alone can trigger avoidance." So every
// card says what it costs. These are honest ballparks, not measurements: a
// prepared one-tap action is seconds, approving a drafted reply is the time
// it takes to read it, and a card with no plan means opening the thread.
export function estimateOf(kind: string | null | undefined): string {
  switch (kind) {
    case "bill":
    case "event":
    case "task":
    case "archive":
      return "~5 sec";
    case "reply":
      return "~30 sec";
    default:
      return "~1 min";
  }
}

// THE RECEIPTS (7A). What actually happened, counted as it happens, never
// estimated at the end. The finish screen prints these; a session the user
// abandons halfway still shows what it truly cleared.
export interface SweepReceipts {
  sent: number;
  bills: number;
  scheduled: number;
  tasks: number;
  archived: number;
  later: number;
}

export const EMPTY_RECEIPTS: SweepReceipts = { sent: 0, bills: 0, scheduled: 0, tasks: 0, archived: 0, later: 0 };

export function receiptLines(r: SweepReceipts): string[] {
  const out: string[] = [];
  const n = (k: number, one: string, many: string) => { if (k > 0) out.push(k + " " + (k === 1 ? one : many)); };
  n(r.sent, "reply sent", "replies sent");
  n(r.scheduled, "thing on the schedule", "things on the schedule");
  n(r.bills, "bill filed in Money", "bills filed in Money");
  n(r.tasks, "task made", "tasks made");
  n(r.archived, "gone for good", "gone for good");
  n(r.later, "saved for later", "saved for later");
  return out;
}

export function handledOf(r: SweepReceipts): number {
  return r.sent + r.bills + r.scheduled + r.tasks + r.archived + r.later;
}

// THE HONEST STREAK (10A), the same shape reminders already ship: nothing
// ever resets, a missed day simply is not colored in, and the best run is
// kept forever. "Cleared 6 of the last 7" is pride without a cliff to fall
// off, which is the entire difference between a ritual and a guillotine.
const STREAK_KEY = "jarvis.mail.sweep.v1";

export interface SweepDays { days: string[]; }

export function loadSweepDays(storage: Pick<Storage, "getItem"> = localStorage): SweepDays {
  try {
    const p = JSON.parse(storage.getItem(STREAK_KEY) || "null") as { days?: unknown } | null;
    const days = Array.isArray(p?.days) ? p.days.filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) : [];
    return { days: [...new Set(days)].sort() };
  } catch {
    return { days: [] };
  }
}

// A day counts when at least one card was truly handled. Zero-card sessions
// do not color the square: the streak is about mail dying, not the app
// opening.
export function recordSweepDay(todayISO: string, handled: number, storage: Pick<Storage, "getItem" | "setItem"> = localStorage): SweepDays {
  const cur = loadSweepDays(storage);
  if (handled <= 0 || cur.days.includes(todayISO)) return cur;
  const days = [...cur.days, todayISO].sort().slice(-370); // a year is plenty
  try { storage.setItem(STREAK_KEY, JSON.stringify({ days })); } catch { /* private mode */ }
  return { days };
}

const dayMs = 86400e3;
const at = (iso: string) => new Date(iso + "T12:00:00").getTime();

export interface StreakView {
  /** Oldest first, ending today: which of the last seven days had a sweep. */
  last7: boolean[];
  cleared: number;
  best: number;
}

export function streakView(d: SweepDays, todayISO: string): StreakView {
  const set = new Set(d.days);
  const t = at(todayISO);
  const last7: boolean[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(t - i * dayMs);
    const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    last7.push(set.has(iso));
  }
  // Best CONSECUTIVE run, ever. Sorted unique days, so a gap of more than one
  // calendar day breaks the run.
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const iso of d.days) {
    const cur = at(iso);
    run = prev !== null && Math.round((cur - prev) / dayMs) === 1 ? run + 1 : 1;
    if (run > best) best = run;
    prev = cur;
  }
  return { last7, cleared: last7.filter(Boolean).length, best };
}

/**
 * The deck card's honest time estimate (2026-08-26, the Mission Deck).
 * Forty seconds a card is the measured shape of a sweep: most cards are a
 * one-tap archive or a prewritten reply, a few need a real look. Rounded UP,
 * because "about 2 min" that takes 90 seconds delights and the reverse
 * breaks the one promise the timer exists to make.
 */
export function sweepEstimate(n: number): string {
  if (n <= 0) return "";
  const mins = Math.max(1, Math.ceil((n * 40) / 60));
  // Leads with a capital because it renders as its own dot-segment on the
  // Sweep scorecard, and segments lead capitalized everywhere else in the
  // app (casing law, extended to scorecards 2026-08-29).
  return "About " + mins + " min";
}
