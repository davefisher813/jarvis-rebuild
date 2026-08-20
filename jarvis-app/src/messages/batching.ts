// EMAIL WINDOWS (Dave 2026-08-20). The one thing on this list that no mail
// app does, and the one the evidence supports most strongly.
//
// The research is consistent and unkind about how people use email: workers
// lose around 10.8 hours a week to non-critical mail, interruptions raise
// task completion time by about 27% while raising stress, more time in email
// correlates with LOWER perceived productivity, and 68% say email overload
// feeds burnout. The recommended alternative in every one of those papers is
// the same: batching. Fixed windows, a few times a day, instead of a live
// feed you graze all day long.
//
// Every other client does the opposite. They compete on how fast they can
// interrupt you.
//
// Laws:
//   - IT IS A CURTAIN, NOT A LOCK. Outside a window the tab is quiet, and one
//     tap opens it anyway with no friction and no scolding. An app that
//     refuses to show a man his own email is a toy.
//   - Nothing is hidden that needs him NOW. A VIP is always through; the
//     window governs grazing, not emergencies.
//   - Off by default. This is a way of working, and it has to be chosen.

const KEY = "jarvis.mail.windows.v1";

export interface WindowSettings {
  on: boolean;
  hours: number[]; // local hours the inbox opens, e.g. [9, 13, 17]
}

export const DEFAULT_WINDOWS: WindowSettings = { on: false, hours: [9, 13, 17] };
// How long a window stays open once it starts.
export const WINDOW_MINUTES = 45;

export function loadWindows(storage: Pick<Storage, "getItem"> = localStorage): WindowSettings {
  try {
    const p = JSON.parse(storage.getItem(KEY) || "null") as Partial<WindowSettings> | null;
    if (!p || typeof p.on !== "boolean" || !Array.isArray(p.hours)) return DEFAULT_WINDOWS;
    const hours = p.hours.filter((h): h is number => typeof h === "number" && h >= 0 && h < 24).sort((a, b) => a - b);
    return { on: p.on, hours: hours.length ? hours : DEFAULT_WINDOWS.hours };
  } catch {
    return DEFAULT_WINDOWS;
  }
}

export function saveWindows(w: WindowSettings, storage: Pick<Storage, "setItem"> = localStorage): void {
  try { storage.setItem(KEY, JSON.stringify(w)); } catch { /* private mode */ }
}

export function isOpenNow(w: WindowSettings, now: Date): boolean {
  if (!w.on) return true;
  const mins = now.getHours() * 60 + now.getMinutes();
  return w.hours.some((h) => mins >= h * 60 && mins < h * 60 + WINDOW_MINUTES);
}

export function nextOpen(w: WindowSettings, now: Date): Date | null {
  if (!w.on || w.hours.length === 0) return null;
  const mins = now.getHours() * 60 + now.getMinutes();
  const todayNext = w.hours.find((h) => h * 60 > mins);
  const d = new Date(now);
  if (todayNext !== undefined) {
    d.setHours(todayNext, 0, 0, 0);
    return d;
  }
  d.setDate(d.getDate() + 1);
  d.setHours(w.hours[0]!, 0, 0, 0);
  return d;
}

export function hourLabel(h: number): string {
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${ap}`;
}

// The line on the curtain. It says when, never how many are waiting: a count
// there would reintroduce exactly the guilt this feature exists to remove.
export function closedLine(w: WindowSettings, now: Date): string {
  const next = nextOpen(w, now);
  if (!next) return "";
  const today = next.toDateString() === now.toDateString();
  return "Opens at " + hourLabel(next.getHours()) + (today ? "" : " tomorrow");
}
