import type { WorkoutData, WorkoutExercise, SetEntry } from "./types";

// OFFLINE-FIRST, and not optionally (2026-08-03 recon): the core Store only
// queues UPDATES when offline, creates fail outright. Gyms are concrete boxes.
// So the live session lives entirely in localStorage while it happens, and the
// finished workout goes into a pending queue that flushes to the store on the
// next successful write. Same proven shape as the 6.5 event sink.
//
// Consequence: losing signal mid-session costs nothing, and a set logged in a
// basement is never lost.

const LIVE_KEY = "jarvis.gym.live.v1";
const PENDING_KEY = "jarvis.gym.pending.v1";
const PENDING_CAP = 50;

export interface LiveSession {
  programId: string;
  dayId: string;
  dayName: string;
  date: string;
  startedAt: number;
  idx: number; // which exercise is on screen
  exercises: WorkoutExercise[];
}

export interface Storage2 { read(k: string): string | null; write(k: string, v: string): void; remove(k: string): void }

function browserStorage(): Storage2 {
  return {
    read: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    write: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
    remove: (k) => { try { localStorage.removeItem(k); } catch { /* private mode */ } },
  };
}

export function readLive(store: Storage2 = browserStorage()): LiveSession | null {
  try {
    const raw = store.read(LIVE_KEY);
    return raw ? (JSON.parse(raw) as LiveSession) : null;
  } catch {
    return null;
  }
}

export function writeLive(s: LiveSession, store: Storage2 = browserStorage()): void {
  store.write(LIVE_KEY, JSON.stringify(s));
}

export function clearLive(store: Storage2 = browserStorage()): void {
  store.remove(LIVE_KEY);
}

/** Log one entry against the exercise at `idx`. Returns the updated session. */
export function logSet(s: LiveSession, idx: number, set: SetEntry): LiveSession {
  const exercises = s.exercises.map((ex, i) => (i === idx ? { ...ex, sets: [...ex.sets, set] } : ex));
  return { ...s, exercises };
}

/** Replace the whole logged strip for one exercise in a single write: the
 *  set strip (catalog §3.1) owns add / duplicate / delete / reorder / edit
 *  as ONE change to the array, and this is where that change lands. Used
 *  for everything except the big one-tap Log button, which stays logSet so
 *  a matching set is exactly one call. */
export function setLoggedSets(s: LiveSession, idx: number, sets: SetEntry[]): LiveSession {
  const exercises = s.exercises.map((ex, i) => (i === idx ? { ...ex, sets } : ex));
  return { ...s, exercises };
}

/** Undo the last entry on an exercise (a fat-fingered tap mid-set). */
export function undoLast(s: LiveSession, idx: number): LiveSession {
  const exercises = s.exercises.map((ex, i) => (i === idx ? { ...ex, sets: ex.sets.slice(0, -1) } : ex));
  return { ...s, exercises };
}

/** Skip an exercise: recorded as the fact it is, with no mark against anyone. */
export function skipExercise(s: LiveSession, idx: number): LiveSession {
  const exercises = s.exercises.map((ex, i) => (i === idx ? { ...ex, skipped: true } : ex));
  return { ...s, exercises };
}

/** Finished session -> pending queue. Nothing is ever dropped for being offline. */
export function queueFinished(w: WorkoutData, store: Storage2 = browserStorage()): void {
  const all = readPending(store);
  all.push(w);
  store.write(PENDING_KEY, JSON.stringify(all.slice(-PENDING_CAP)));
}

export function readPending(store: Storage2 = browserStorage()): WorkoutData[] {
  try {
    const raw = store.read(PENDING_KEY);
    return raw ? (JSON.parse(raw) as WorkoutData[]) : [];
  } catch {
    return [];
  }
}

export function writePending(all: WorkoutData[], store: Storage2 = browserStorage()): void {
  store.write(PENDING_KEY, JSON.stringify(all));
}

/**
 * Try to persist every pending session. Whatever fails stays queued, in order,
 * for the next attempt. Returns how many landed.
 */
export async function flushPending(
  save: (w: WorkoutData) => Promise<string | null>,
  store: Storage2 = browserStorage(),
): Promise<number> {
  const all = readPending(store);
  if (all.length === 0) return 0;
  const left: WorkoutData[] = [];
  let saved = 0;
  for (const w of all) {
    try {
      const id = await save(w);
      if (id) saved++;
      else left.push(w);
    } catch {
      left.push(w);
    }
  }
  writePending(left, store);
  return saved;
}

/** A session is worth keeping if anything at all was logged (partial counts). */
export function hasWork(exercises: WorkoutExercise[]): boolean {
  return exercises.some((ex) => ex.sets.some((s) => !s.skipped));
}
