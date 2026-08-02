import type { ProfileData } from "../profile/types";

// Pattern awareness (Routine Phase 2 stretch). Reads the 14-day check-in
// history and surfaces at most ONE honest observation as a suggestion, never a
// lecture. Everything here is deterministic: if the data does not clearly show
// a pattern, we say nothing. Silence beats a guess, and guilt is banned.

export interface PatternObservation { id: string; text: string }

type CheckinMap = NonNullable<ProfileData["checkin"]>;

const DOW_NAME = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

// Sorted [isoDate, mood] pairs for entries that actually answered the evening
// question. The record is already trimmed to 14 days at write time.
function moodEntries(checkin: CheckinMap): [string, string][] {
  return Object.entries(checkin)
    .filter((e): e is [string, { mood: string }] => typeof e[1]?.mood === "string")
    .map(([d, v]) => [d, v.mood] as [string, string])
    .sort((a, b) => a[0].localeCompare(b[0]));
}

// Length of the run of identical moods ending at the most recent entry, but
// only when those entries are consecutive calendar days (a streak with holes
// in it is not a streak).
function endingStreak(entries: [string, string][]): { mood: string; len: number } | null {
  if (entries.length === 0) return null;
  const last = entries[entries.length - 1]!;
  let len = 1;
  for (let i = entries.length - 2; i >= 0; i--) {
    const [d, m] = entries[i]!;
    const next = entries[i + 1]![0];
    const gap = (new Date(next + "T12:00:00").getTime() - new Date(d + "T12:00:00").getTime()) / 86400000;
    if (m !== last[1] || Math.round(gap) !== 1) break;
    len++;
  }
  return { mood: last[1], len };
}

// The one observation worth making right now, or null. Priority order: a heavy
// streak (respond to how things are going), then a weekday that keeps running
// heavy (plannable), then a flow streak (earned, so say it).
export function patternObservation(checkin: CheckinMap | undefined, _todayIso: string): PatternObservation | null {
  if (!checkin) return null;
  const entries = moodEntries(checkin);
  const streak = endingStreak(entries);

  if (streak && streak.mood === "under" && streak.len >= 3) {
    return { id: "under-streak", text: "It has been a heavy stretch. Small days still count, and I am keeping your plans light." };
  }

  // Weekday heaviness needs real evidence: at least 6 answered evenings, and a
  // weekday with 2+ entries where every one of them came back underwater.
  if (entries.length >= 6) {
    const byDow = new Map<number, { under: number; total: number }>();
    for (const [d, m] of entries) {
      const dow = new Date(d + "T12:00:00").getDay();
      const c = byDow.get(dow) ?? { under: 0, total: 0 };
      c.total++;
      if (m === "under") c.under++;
      byDow.set(dow, c);
    }
    for (let dow = 0; dow < 7; dow++) {
      const c = byDow.get(dow);
      if (c && c.total >= 2 && c.under === c.total) {
        return { id: `heavy-${dow}`, text: `${DOW_NAME[dow]} have been running heavy for you. Worth planning them a little lighter.` };
      }
    }
  }

  if (streak && streak.mood === "fire" && streak.len >= 3) {
    return { id: "fire-streak", text: `${streak.len} days in flow. Whatever this rhythm is, it is working.` };
  }

  return null;
}

// Dismissal memory: a dismissed observation stays gone for 7 days, so the same
// insight never nags. Stored per observation id, survives across days.
const DISMISS_KEY = "jarvis.pattern.dismissed";

export function readPatternDismissals(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(DISMISS_KEY) || "{}") as Record<string, string>; } catch { return {}; }
}

export function isPatternDismissed(id: string, todayIso: string, dismissals: Record<string, string> = readPatternDismissals()): boolean {
  const when = dismissals[id];
  if (!when) return false;
  const days = (new Date(todayIso + "T12:00:00").getTime() - new Date(when + "T12:00:00").getTime()) / 86400000;
  return days < 7;
}

export function dismissPattern(id: string, todayIso: string): void {
  try {
    const d = readPatternDismissals();
    d[id] = todayIso;
    localStorage.setItem(DISMISS_KEY, JSON.stringify(d));
  } catch { /* private mode */ }
}

// --- The writable Brain (Session 5) ---
// An approved observation becomes a remembered habit: one line appended to the
// Brain doc (topic "habits") that the context assembler feeds to every AI
// feature. Only ever written on the user's explicit tap, never silently.
export function appendHabit(existing: string, observation: string, todayIso: string): string {
  const line = `${todayIso}: ${observation}`;
  const lines = existing ? existing.split("\n").filter((l) => l.trim()) : [];
  // The same observation text is never recorded twice.
  if (lines.some((l) => l.includes(observation))) return existing;
  return [...lines, line].slice(-20).join("\n");
}
