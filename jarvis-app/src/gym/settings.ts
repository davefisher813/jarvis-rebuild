import type { Storage2 } from "./liveSession";
import { DEFAULT_BAR, DEFAULT_PLATES } from "./ramp";

// GYM SETTINGS (Training Catalog V2, approved 2026-08-31). D2's "always
// visible unless they want to turn that off": last-time ghosts and the
// header line default ON, with one switch in Settings → Training. D8's bar
// weight and available plates join this store in Wave 2, which is why it is
// a store and not a single key.
//
// localStorage, same Storage2 seam liveSession uses: gym state must work in
// a concrete basement with no network, and a corrupt read heals to defaults
// instead of taking the ghosts down with it.

const KEY = "jarvis.gym.settings.v1";

export interface GymSettings {
  /** D2: "Last: 250 × 3" ghosts on set chips and the last-session header. */
  showLast: boolean;
  /** D8-A: the athlete's own bar and rack, so plate math is their gym's
   *  answer and not a guess. Also what D3's ramp rounds to. */
  barWeight: number;
  plates: number[];
}

export const DEFAULT_GYM_SETTINGS: GymSettings = {
  showLast: true,
  barWeight: DEFAULT_BAR,
  plates: DEFAULT_PLATES,
};

/** The rack as ramp.ts wants it, from whatever is stored. A corrupt or empty
 *  plate list falls back to a normal rack rather than dividing by nothing. */
export function rackFrom(s: GymSettings): { bar: number; plates: number[] } {
  const plates = Array.isArray(s.plates) && s.plates.length ? s.plates.filter((n) => n > 0) : DEFAULT_PLATES;
  return { bar: s.barWeight > 0 ? s.barWeight : DEFAULT_BAR, plates: plates.length ? plates : DEFAULT_PLATES };
}

function browserStorage(): Storage2 {
  return {
    read: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    write: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
    remove: (k) => { try { localStorage.removeItem(k); } catch { /* private mode */ } },
  };
}

export function readGymSettings(store: Storage2 = browserStorage()): GymSettings {
  try {
    const raw = store.read(KEY);
    if (!raw) return { ...DEFAULT_GYM_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<GymSettings>;
    return { ...DEFAULT_GYM_SETTINGS, ...(typeof parsed === "object" && parsed ? parsed : {}) };
  } catch {
    return { ...DEFAULT_GYM_SETTINGS };
  }
}

export function writeGymSettings(s: GymSettings, store: Storage2 = browserStorage()): void {
  store.write(KEY, JSON.stringify(s));
}
