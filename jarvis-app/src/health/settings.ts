import type { Storage2 } from "../gym/liveSession";

// HEALTH SETTINGS (Health Push C, H-40, Dave's picks 2026-09-12). One
// versioned key for the choices the Health page and the live session read:
// which shortcuts the Health page offers (only Water changes anything, see
// WORKING_SHORTCUTS), whether the rest timer makes a sound and arms a
// notification, whether a PR is celebrated, and the weekly sets band the
// Weekly Volume card compares against.
//
// THE BAND IS NOT HARD WIRED (Dave 2026-09-13: "I don't want anything hard
// wired that shouldn't be"). The studied range in gym/muscles.ts stays the
// default and keeps its citation; a band set here replaces it and is
// labelled as his, never as studied.
//
// Read synchronously off localStorage, the way gym/settings.ts is, so a tile
// or a timer can ask while it renders. The rack (bar, plates, unit, last-time
// on every set) stays in gym/settings.ts; the Health Settings page shows both.

export type ShortcutKey = "bedtime" | "water" | "meal" | "checkin" | "medication" | "effort" | "discomfort";

// THE REFERENCE'S SHORTCUTS (2026-09-14): Sleep, Meal, Water and Check In on
// by default. Bedtime keeps its name: the Sleep metric (hours) is a tile of
// its own. All seven keys stay valid (a stored list is read as it was, and
// the reminder link pickers name every logger by its key).
export const SHORTCUTS: { key: ShortcutKey; label: string }[] = [
  { key: "bedtime", label: "Bedtime" },
  { key: "meal", label: "Meal" },
  { key: "water", label: "Water" },
  { key: "checkin", label: "Check In" },
  { key: "medication", label: "Medication" },
  { key: "effort", label: "Session Effort" },
  { key: "discomfort", label: "Discomfort" },
];
/** THE SHORTCUTS A CHIP CAN CHANGE (2026-10-04). The chips were meant to pick
 *  the tiles under Daily Log, but the Health page dropped those tiles for the
 *  rows of Log Something, where every logger is always listed (approved
 *  design, 2026-09-14), and Medication is its own page and door. Only Water
 *  still gates something, a row in Log Something, so it is the only chip
 *  Health Settings offers: a chip that changes nothing is a dead button. */
export const WORKING_SHORTCUTS: ShortcutKey[] = ["water"];
/** The version of the default shortcut set a stored record was seeded with. */
const SHORTCUT_SEED = 2;

export interface VolumeBand { low: number; high: number }

/** Part 3 wave 5 (Dave's 9b and O2a). Assisted: the app suggests the next
 *  target from completed working sets and the marks; Manual: it suggests
 *  nothing. A third mode, Program ("the plan as written"), behaved exactly
 *  like Manual in suggestFor and the Now row never read the mode, so it was
 *  taken off the menu 2026-10-04; a stored "program" reads as Manual, which is
 *  what it always did. */
export type ProgressionMode = "assisted" | "manual";
export const PROGRESSION_MODES: ProgressionMode[] = ["assisted", "manual"];

export interface HealthSettings {
  shortcuts: ShortcutKey[];
  /** Which default set the shortcuts were seeded from; absent before 2026-09-14. */
  seeded?: number;
  restSound: boolean;
  restNotify: boolean;
  celebrations: boolean;
  /** Null means the studied default in gym/muscles.ts. */
  volumeBand: VolumeBand | null;
  progression: ProgressionMode;
}

export const DEFAULT_HEALTH_SETTINGS: HealthSettings = {
  shortcuts: ["bedtime", "meal", "water", "checkin"],
  seeded: SHORTCUT_SEED,
  restSound: true,
  restNotify: true,
  celebrations: true,
  volumeBand: null,
  progression: "assisted",
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
    let shortcuts = Array.isArray(p.shortcuts) ? p.shortcuts.filter((k): k is ShortcutKey => KEYS.includes(k as ShortcutKey)) : DEFAULT_HEALTH_SETTINGS.shortcuts;
    // A record from before the reference's four defaults gets them once,
    // keeping whatever it already had on; after that the choice is his.
    const seeded = p.seeded === SHORTCUT_SEED;
    if (!seeded) shortcuts = [...new Set([...DEFAULT_HEALTH_SETTINGS.shortcuts, ...shortcuts])];
    const band = p.volumeBand && typeof p.volumeBand === "object" && Number.isFinite(p.volumeBand.low) && Number.isFinite(p.volumeBand.high)
      && p.volumeBand.low > 0 && p.volumeBand.high > p.volumeBand.low
      ? { low: p.volumeBand.low, high: p.volumeBand.high }
      : null;
    // A stored "program" (a mode taken off the menu, see ProgressionMode) is
    // Manual, which is what it always behaved as.
    const storedMode = p.progression as string | undefined;
    const out: HealthSettings = {
      shortcuts,
      seeded: SHORTCUT_SEED,
      restSound: p.restSound !== false,
      restNotify: p.restNotify !== false,
      celebrations: p.celebrations !== false,
      volumeBand: band,
      progression: storedMode === "program" ? "manual" : PROGRESSION_MODES.includes(storedMode as ProgressionMode) ? (storedMode as ProgressionMode) : "assisted",
    };
    if (!seeded) store.write(KEY, JSON.stringify(out));
    return out;
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
