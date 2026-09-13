import type { Storage2 } from "../gym/liveSession";

// HEALTH SETTINGS (Health Push C, H-40, Dave's picks 2026-09-12). One
// versioned key for the choices the Health page and the live session read:
// which shortcut tiles the Daily Log shows, whether the rest timer makes a
// sound and arms a notification, whether a PR is celebrated, and the weekly
// sets band the Weekly Volume card compares against.
//
// THE BAND IS NOT HARD WIRED (Dave 2026-09-13: "I don't want anything hard
// wired that shouldn't be"). The studied range in gym/muscles.ts stays the
// default and keeps its citation; a band set here replaces it and is
// labelled as his, never as studied.
//
// Read synchronously off localStorage, the way gym/settings.ts is, so a tile
// or a timer can ask while it renders. The rack (bar, plates, unit, last-time
// on every set) stays in gym/settings.ts; the Health Settings page shows both.

export type ShortcutKey = "bedtime" | "water" | "effort" | "discomfort";

export const SHORTCUTS: { key: ShortcutKey; label: string }[] = [
  { key: "bedtime", label: "Bedtime" },
  { key: "water", label: "Water" },
  { key: "effort", label: "Session Effort" },
  { key: "discomfort", label: "Discomfort" },
];

export interface VolumeBand { low: number; high: number }

export interface HealthSettings {
  shortcuts: ShortcutKey[];
  restSound: boolean;
  restNotify: boolean;
  celebrations: boolean;
  /** Null means the studied default in gym/muscles.ts. */
  volumeBand: VolumeBand | null;
}

export const DEFAULT_HEALTH_SETTINGS: HealthSettings = {
  shortcuts: ["bedtime"],
  restSound: true,
  restNotify: true,
  celebrations: true,
  volumeBand: null,
};

const KEY = "jarvis.health.settings.v1";

function browserStorage(): Storage2 {
  return {
    read: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    write: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
    remove: (k) => { try { localStorage.removeItem(k); } catch { /* private mode */ } },
  };
}

const KEYS: ShortcutKey[] = SHORTCUTS.map((s) => s.key);

export function readHealthSettings(store: Storage2 = browserStorage()): HealthSettings {
  try {
    const raw = store.read(KEY);
    if (!raw) return { ...DEFAULT_HEALTH_SETTINGS };
    const p = JSON.parse(raw) as Partial<HealthSettings>;
    const shortcuts = Array.isArray(p.shortcuts) ? p.shortcuts.filter((k): k is ShortcutKey => KEYS.includes(k as ShortcutKey)) : DEFAULT_HEALTH_SETTINGS.shortcuts;
    const band = p.volumeBand && typeof p.volumeBand === "object" && Number.isFinite(p.volumeBand.low) && Number.isFinite(p.volumeBand.high)
      && p.volumeBand.low > 0 && p.volumeBand.high > p.volumeBand.low
      ? { low: p.volumeBand.low, high: p.volumeBand.high }
      : null;
    return {
      shortcuts,
      restSound: p.restSound !== false,
      restNotify: p.restNotify !== false,
      celebrations: p.celebrations !== false,
      volumeBand: band,
    };
  } catch {
    return { ...DEFAULT_HEALTH_SETTINGS };
  }
}

export function writeHealthSettings(s: HealthSettings, store: Storage2 = browserStorage()): void {
  store.write(KEY, JSON.stringify(s));
}

export function updateHealthSettings(patch: Partial<HealthSettings>, store: Storage2 = browserStorage()): HealthSettings {
  const next = { ...readHealthSettings(store), ...patch };
  writeHealthSettings(next, store);
  return next;
}
