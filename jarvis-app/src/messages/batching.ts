// EMAIL WINDOWS (Dave 2026-08-20; rebuilt 2026-08-22).
//
// The research is consistent and unkind about how people use email: workers
// lose around 10.8 hours a week to non-critical mail, interruptions raise
// task completion time by about 27% while raising stress, and the fix every
// paper lands on is the same: batching. Fixed windows, a few times a day,
// instead of a live feed you graze all day long.
//
// The 2026-08-22 rebuild exists because the first version broke its own
// third law. "Off by default" is not enough when a single tap on a row-act
// turns it on with no confirmation, no explanation, and no way to change
// the hardcoded hours. Dave, on finding his email closed: "My email is
// closed off and I no idea why." A way of working has to be CHOSEN, and
// choosing means seeing what you are choosing.
//
// Laws:
//   - IT IS A CURTAIN, NOT A LOCK. Outside a window the tab is quiet, and one
//     tap opens it anyway with no friction and no scolding. An app that
//     refuses to show a man his own email is a toy.
//   - Nothing is hidden that needs him NOW. A VIP shows through the curtain.
//   - Off by default, and turning it on is a decision made INSIDE the editor,
//     with every window visible and editable, never a stray tap on a row.
//   - Every window is his: start, length, and which days the feature runs.

const KEY_V1 = "jarvis.mail.windows.v1";
const KEY = "jarvis.mail.windows.v2";

export interface MailWindow { startMin: number; minutes: number }
export interface WindowSettings {
  on: boolean;
  windows: MailWindow[]; // kept sorted by startMin
  days: number[];        // JS getDay values the curtain runs; other days email is open
}

export const WINDOW_LENGTHS = [30, 45, 60, 90];
export const MAX_WINDOWS = 6;
const DEFAULT_LEN = 45;

// Fresh install: weekday batching, the classic 9 / 1 / 5. Chosen, never
// imposed: `on` is false until the editor's Start is tapped.
export const DEFAULT_WINDOWS: WindowSettings = {
  on: false,
  windows: [
    { startMin: 9 * 60, minutes: DEFAULT_LEN },
    { startMin: 13 * 60, minutes: DEFAULT_LEN },
    { startMin: 17 * 60, minutes: DEFAULT_LEN },
  ],
  days: [1, 2, 3, 4, 5],
};

const sortW = (ws: MailWindow[]) => [...ws].sort((a, b) => a.startMin - b.startMin);
const validW = (w: unknown): w is MailWindow =>
  !!w && typeof w === "object"
  && typeof (w as MailWindow).startMin === "number" && (w as MailWindow).startMin >= 0 && (w as MailWindow).startMin < 24 * 60
  && typeof (w as MailWindow).minutes === "number" && (w as MailWindow).minutes >= 15 && (w as MailWindow).minutes <= 240;

export function loadWindows(storage: Pick<Storage, "getItem"> = localStorage): WindowSettings {
  try {
    const p = JSON.parse(storage.getItem(KEY) || "null") as Partial<WindowSettings> | null;
    if (p && typeof p.on === "boolean" && Array.isArray(p.windows)) {
      const windows = sortW(p.windows.filter(validW)).slice(0, MAX_WINDOWS);
      const days = Array.isArray(p.days)
        ? p.days.filter((d): d is number => typeof d === "number" && d >= 0 && d <= 6)
        : DEFAULT_WINDOWS.days;
      return {
        on: p.on && windows.length > 0,
        windows: windows.length ? windows : DEFAULT_WINDOWS.windows,
        days: days.length ? [...new Set(days)].sort() : DEFAULT_WINDOWS.days,
      };
    }
  } catch { /* fall through to v1 */ }
  // v1 migration: hours[] at a flat 45 minutes. v1 ran every day, so a
  // migrated user keeps every day; changing behavior in a migration is how
  // trust dies. Days-of-week are a v2 idea and default on only for fresh
  // installs.
  try {
    const p = JSON.parse(storage.getItem(KEY_V1) || "null") as { on?: boolean; hours?: number[] } | null;
    if (p && typeof p.on === "boolean" && Array.isArray(p.hours)) {
      const hours = p.hours.filter((h): h is number => typeof h === "number" && h >= 0 && h < 24).sort((a, b) => a - b);
      if (hours.length) {
        return { on: p.on, windows: hours.map((h) => ({ startMin: h * 60, minutes: 45 })), days: [0, 1, 2, 3, 4, 5, 6] };
      }
    }
  } catch { /* corrupt is the same as absent */ }
  return DEFAULT_WINDOWS;
}

export function saveWindows(w: WindowSettings, storage: Pick<Storage, "setItem"> = localStorage): void {
  try { storage.setItem(KEY, JSON.stringify({ ...w, windows: sortW(w.windows) })); } catch { /* private mode */ }
}

// ---- editor operations, pure ----

export function addWindow(w: WindowSettings): WindowSettings {
  if (w.windows.length >= MAX_WINDOWS) return w;
  // The new window lands an hour after the latest one, wrapping sanely, so
  // Add never asks a question before showing something editable.
  const last = sortW(w.windows)[w.windows.length - 1];
  const startMin = Math.min(23 * 60, (last ? last.startMin + last.minutes + 60 : 9 * 60));
  return { ...w, windows: sortW([...w.windows, { startMin, minutes: DEFAULT_LEN }]) };
}

export function removeWindow(w: WindowSettings, i: number): WindowSettings {
  const windows = w.windows.filter((_, ix) => ix !== i);
  // The last window cannot be removed while the curtain is on: zero windows
  // means email never opens, which is a lock, not a curtain.
  if (windows.length === 0) return w;
  return { ...w, windows };
}

export function setWindowStart(w: WindowSettings, i: number, startMin: number): WindowSettings {
  const windows = w.windows.map((x, ix) => (ix === i ? { ...x, startMin: Math.max(0, Math.min(24 * 60 - 15, startMin)) } : x));
  return { ...w, windows: sortW(windows) };
}

export function setWindowLen(w: WindowSettings, i: number, minutes: number): WindowSettings {
  return { ...w, windows: w.windows.map((x, ix) => (ix === i ? { ...x, minutes } : x)) };
}

export function toggleDay(w: WindowSettings, day: number): WindowSettings {
  const days = w.days.includes(day) ? w.days.filter((d) => d !== day) : [...w.days, day].sort();
  // Zero days is the feature quietly off while claiming to be on; refuse.
  if (days.length === 0) return w;
  return { ...w, days };
}

// ---- the curtain's questions ----

export function isOpenNow(w: WindowSettings, now: Date): boolean {
  if (!w.on) return true;
  if (!w.days.includes(now.getDay())) return true;
  const mins = now.getHours() * 60 + now.getMinutes();
  return w.windows.some((x) => mins >= x.startMin && mins < x.startMin + x.minutes);
}

export function nextOpen(w: WindowSettings, now: Date): Date | null {
  if (!w.on || w.windows.length === 0 || w.days.length === 0) return null;
  const mins = now.getHours() * 60 + now.getMinutes();
  for (let add = 0; add < 8; add++) {
    const d = new Date(now);
    d.setDate(d.getDate() + add);
    if (!w.days.includes(d.getDay())) continue;
    const first = sortW(w.windows).find((x) => add > 0 || x.startMin > mins);
    if (!first) continue;
    d.setHours(Math.floor(first.startMin / 60), first.startMin % 60, 0, 0);
    return d;
  }
  return null;
}

export function minLabel(startMin: number): string {
  const h = Math.floor(startMin / 60);
  const m = startMin % 60;
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${ap}` : `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}
export const hourLabel = (h: number) => minLabel(h * 60);

export const DAY_LETTER = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// The line on the curtain. It says when, never how many are waiting: a count
// there would reintroduce exactly the guilt this feature exists to remove.
export function closedLine(w: WindowSettings, now: Date): string {
  const next = nextOpen(w, now);
  if (!next) return "";
  const days = Math.round((new Date(next).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86400e3);
  if (days === 0) return "Opens at " + minLabel(next.getHours() * 60 + next.getMinutes());
  if (days === 1) return "Opens at " + minLabel(next.getHours() * 60 + next.getMinutes()) + " tomorrow";
  return "Opens " + DAY_NAME[next.getDay()];
}
