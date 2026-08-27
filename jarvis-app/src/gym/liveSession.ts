import type { WorkoutData, WorkoutExercise, SetEntry, MeasureKind, ProgramDay } from "./types";
import { newSetId } from "./strip";

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
  /** LOG IT LATER (catalog §3.8). True when `date` is deliberately not
   *  today -- a session entered after the fact for a day the phone was in a
   *  locker. The stale-session recovery sweep in GymFlow leaves a backdated
   *  session alone instead of treating its date as an abandoned leftover. */
  backdated?: boolean;
  /** SAME AS LAST TIME (catalog §3.13). True when this session was started
   *  from the last session with this day: the per-exercise `plan` on each
   *  WorkoutExercise below carries the prior actual numbers instead of the
   *  program's own target strip. */
  sameAsLastTime?: boolean;
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

/**
 * SWAP (catalog §3.9). The rack is taken, the shoulder is cranky: substitute
 * a different exercise at `idx` for THIS session only. Whatever was already
 * logged against the original belongs to the original, not the substitute,
 * so it does not carry over. The program day is never touched.
 */
export function swapExercise(
  s: LiveSession,
  idx: number,
  sub: { exerciseKey?: string; name: string; kind: MeasureKind; unit?: string; timeUnit?: string },
): LiveSession {
  const exercises = s.exercises.map((ex, i) => (i === idx
    ? {
      exerciseId: ex.exerciseId, name: sub.name, kind: sub.kind,
      ...(sub.unit ? { unit: sub.unit } : {}),
      ...(sub.timeUnit ? { timeUnit: sub.timeUnit } : {}),
      ...(sub.exerciseKey ? { exerciseKey: sub.exerciseKey } : {}),
      sets: [] as SetEntry[], custom: true as const, plan: [] as SetEntry[],
    }
    : ex));
  return { ...s, exercises };
}

let midSeq = 0;

/**
 * ADD MID-SESSION (catalog §3.10). Append an exercise that was never in the
 * plan, without touching the program. `plan` carries the picked target strip
 * forward as ghost chips, same as a normal planned exercise would.
 */
export function addExerciseMidSession(
  s: LiveSession,
  ex: { exerciseKey?: string; name: string; kind: MeasureKind; unit?: string; timeUnit?: string; plan: SetEntry[] },
): LiveSession {
  const exerciseId = `mid${Date.now().toString(36)}${midSeq++}`;
  const entry: WorkoutExercise = {
    exerciseId, name: ex.name, kind: ex.kind,
    ...(ex.unit ? { unit: ex.unit } : {}),
    ...(ex.timeUnit ? { timeUnit: ex.timeUnit } : {}),
    ...(ex.exerciseKey ? { exerciseKey: ex.exerciseKey } : {}),
    sets: [], custom: true, plan: ex.plan,
  };
  return { ...s, exercises: [...s.exercises, entry] };
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

/**
 * SAME AS LAST TIME (catalog §3.13). The fastest possible entry: start a
 * session for `day` pre-filled with what actually happened last time you
 * trained it, exercise by exercise, instead of the program's own target
 * strip. An exercise added to the day since then, or one that was skipped
 * outright last time, simply falls back to its own plan -- there is nothing
 * prior to carry forward for it.
 */
export function sessionExercisesSameAsLastTime(day: ProgramDay, last: WorkoutData): WorkoutExercise[] {
  const priorById = new Map(last.exercises.map((e) => [e.exerciseId, e]));
  return day.exercises.map((e): WorkoutExercise => {
    const base = { exerciseId: e.id, name: e.name, kind: e.kind, ...(e.unit ? { unit: e.unit } : {}), ...(e.timeUnit ? { timeUnit: e.timeUnit } : {}), ...(e.exerciseKey ? { exerciseKey: e.exerciseKey } : {}) };
    const prior = priorById.get(e.id);
    const loggedPrior = prior?.sets.filter((s) => !s.skipped) ?? [];
    if (!prior || loggedPrior.length === 0) return { ...base, sets: [] };
    const plan: SetEntry[] = loggedPrior.map((s) => ({
      id: newSetId(),
      ...(s.w !== undefined ? { w: s.w } : {}),
      ...(s.r !== undefined ? { r: s.r } : {}),
      ...(s.v !== undefined ? { v: s.v } : {}),
      ...(s.t !== undefined ? { t: s.t } : {}),
      ...(s.done ? { done: true } : {}),
    }));
    return { ...base, sets: [], custom: true, plan };
  });
}
