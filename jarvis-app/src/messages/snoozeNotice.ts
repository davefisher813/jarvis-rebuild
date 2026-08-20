// SNOOZE TO A TIME, NOT TO A PILE (U4, Dave 2026-08-20).
//
// Dismiss hides a notice until tomorrow. That is the right answer for "not
// today", and the wrong one for "not right now": the email is still live, he
// still means to deal with it, and burying it until tomorrow makes the app
// complicit in the thing slipping.
//
// A snooze names a time. The notice leaves, and comes back once, at that time.
//
// Laws:
//   - Same-day only, clamped inside the day. Last night's snooze must never
//     silence this morning.
//   - A snooze that has expired is simply gone from the store: no state to
//     clean up, nothing to reset at midnight.
//   - The offered times are relative to NOW and never in the past. "Back at 4"
//     at 5pm is not an option, it is a joke.

const KEY = "jarvis.mail.snooze.v1";

export interface SnoozeStore { day: string; until: Record<string, string> } // key -> "HH:MM"

export function loadSnoozes(
  todayISO: string,
  storage: Pick<Storage, "getItem"> = localStorage,
): Record<string, string> {
  try {
    const p = JSON.parse(storage.getItem(KEY) || "null") as Partial<SnoozeStore> | null;
    if (!p || p.day !== todayISO || typeof p.until !== "object" || p.until === null) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(p.until)) if (typeof v === "string") out[k] = v;
    return out;
  } catch {
    return {};
  }
}

export function snoozeNotice(
  key: string,
  until: string,
  todayISO: string,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): Record<string, string> {
  const next = { ...loadSnoozes(todayISO, storage), [key]: until };
  try { storage.setItem(KEY, JSON.stringify({ day: todayISO, until: next })); } catch { /* private mode */ }
  return next;
}

// Keys still asleep at this minute. Anything whose time has come is awake,
// and the caller shows it again.
export function sleepingNow(snoozes: Record<string, string>, nowHHMM: string): string[] {
  return Object.entries(snoozes).filter(([, at]) => at > nowHHMM).map(([k]) => k);
}

const STEPS = [60, 180, 300]; // an hour, this afternoon, this evening

export interface SnoozeChoice { label: string; at: string }

// Two or three real options, never a time that has already passed and never
// one past the end of the day.
export function snoozeChoices(nowHHMM: string, dayEndHHMM = "22:00"): SnoozeChoice[] {
  const toMin = (t: string) => Number(t.split(":")[0] ?? 0) * 60 + Number(t.split(":")[1] ?? 0);
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const label = (m: number) => {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    const ap = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return mm === 0 ? `${h12} ${ap}` : `${h12}:${String(mm).padStart(2, "0")} ${ap}`;
  };
  const now = toMin(nowHHMM);
  const end = toMin(dayEndHHMM);
  const out: SnoozeChoice[] = [];
  for (const step of STEPS) {
    const at = Math.round((now + step) / 30) * 30;
    if (at <= now || at >= end) continue;
    if (out.some((o) => o.at === fmt(at))) continue;
    out.push({ label: "Back at " + label(at), at: fmt(at) });
  }
  return out;
}
