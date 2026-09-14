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
  /** GYM-F-19 (2026-09-05): which unit the bar and plates above are in.
   *  S5-Q32 shipped them as bare numbers, so the ramp and the plate line had
   *  no way to be right for a lifter whose exercises are in the other one.
   *  Defaults to pounds, which is what every rack stored before this was. */
  rackUnit: "lb" | "kg";
  /** UP-ATH-21 (2026-09-06): library keys the athlete has taken off the
   *  suggestion lists. HIDE, NEVER DELETE, the same rule the metric strip
   *  keeps: the history stays and the row stays on Your Lifts, it just stops
   *  being offered by Swap and autocomplete. Absent on every settings blob
   *  written before this, which reads as nothing hidden. */
  hiddenKeys?: string[];
  /** Health Push E (H-23): the names each lift used to go by, by library
   *  key, so a rename keeps the old name searchable. See libraryEdit.ts. */
  aliases?: Record<string, string[]>;
  /** Part 3 wave 1 (2026-09-13): the lifts he starred on Your Lifts. They
   *  lead every picker; nothing else about them changes. */
  favoriteKeys?: string[];
  /** MUSCLES BY LIFT (Dave, 2026-09-14: "I said I wanted users to be able to
   *  mark what muscle groups the exercises hit").
   *
   *  Muscle used to live only on `Exercise.muscleGroup` -- one muscle, set
   *  inside one program day, invisible to every other program and lost the
   *  moment a lift was logged mid-session or the program was archived. The
   *  weekly volume row then joined it back to history BY NAME, so a rename
   *  silently emptied it. Here it hangs off the LIBRARY KEY instead, which
   *  is the identity that survives a rename and a merge, and it is a LIST,
   *  because a row hits more than one muscle and always did.
   *
   *  First entry is the primary. Still set by hand and absent by default:
   *  the app does not read a muscle out of a free-text name (muscles.ts). */
  muscleByKey?: Record<string, string[]>;
  /** WHAT EACH EXERCISE IS (2026-09-14, second pass). The whole
   *  classification -- primary and secondary muscles as two named lists,
   *  equipment, movement pattern, exercise type, execution, the machine's own
   *  identity, tags, archive state -- by library key. See gym/classify.ts,
   *  which owns the shape, validates every read and carries `muscleByKey`
   *  forward into it.
   *
   *  `muscleByKey` above is still written alongside this one, and deliberately:
   *  it is the older store, a build that predates this field still reads it,
   *  and a reader that loses its data because a newer build stopped writing it
   *  is the kind of silent loss acceptance criterion 15 exists to prevent. */
  classByKey?: Record<string, unknown>;
  /** Near-duplicate pairs the athlete has waved off (gym/duplicates.ts), by
   *  pairId. Kept so the page stops proposing a merge that has already been
   *  considered and declined. */
  dismissedDupes?: string[];
  /** MERGE HISTORY (handoff §5: "Provide recoverable merge history"). Newest
   *  last. A record of what was folded into what and when, so a merge is
   *  answerable weeks later even when it can no longer be safely reversed. */
  merges?: MergeRecord[];
}

/** One merge, as it happened. `undoable` goes false the moment anything else
 *  rewrites what the merge touched, because an undo that restores a stale
 *  pre-image would silently discard the edits made since. */
export interface MergeRecord {
  at: number;
  loserName: string;
  survivorName: string;
  survivorKey: string;
  sessions: number;
  programDays: number;
}

export const DEFAULT_GYM_SETTINGS: GymSettings = {
  showLast: true,
  barWeight: DEFAULT_BAR,
  plates: DEFAULT_PLATES,
  rackUnit: "lb",
};

/** The rack as ramp.ts wants it, from whatever is stored. A corrupt or empty
 *  plate list falls back to a normal rack rather than dividing by nothing. */
export function rackFrom(s: GymSettings): { bar: number; plates: number[]; unit: "lb" | "kg" } {
  const plates = Array.isArray(s.plates) && s.plates.length ? s.plates.filter((n) => n > 0) : DEFAULT_PLATES;
  return {
    bar: s.barWeight > 0 ? s.barWeight : DEFAULT_BAR,
    plates: plates.length ? plates : DEFAULT_PLATES,
    unit: s.rackUnit === "kg" ? "kg" : "lb",
  };
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
