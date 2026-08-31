import type { WorkoutData, WorkoutExercise, SetEntry, MeasureKind, ProgramDay } from "./types";
import { entryFrom } from "./strip";

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
  /** SESSIONS RESUME, NOT FRAGMENT (2026-08-30, training catalog audit).
   *  Stamped at start and on every logged change. Optional only so a session
   *  already sitting in a user's storage from before this field existed
   *  still reads -- isStillActive falls back to startedAt for those. */
  lastActivityAt?: number;
  /** THE FIT, D5-C (Training Catalog V2, approved 2026-08-31). The athlete's
   *  own levers for THIS session -- a stance, never a program edit (LAW 17).
   *  All optional so every stored session from before the fit existed reads
   *  as what it was: no budget, no levers. */
  budgetMin?: number;
  restCut?: boolean;
  superset?: boolean;
  skipCool?: boolean;
  /** exerciseId -> planned sets dropped from the END of that lift's plan.
   *  Per-exercise so the catch-up banner can trim one curl set without
   *  dragging a day-wide toggle along. */
  trims?: Record<string, number>;
  /** D3-C in session: which warm-up / cool-down block ids are checked off,
   *  and whether the whole block was skipped as a unit. Session state, not
   *  workout data -- the receipt's minutes already carry the truth. */
  warmDone?: string[];
  warmSkipped?: boolean;
  coolDone?: string[];
  coolSkipped?: boolean;
  /** D4-C: the schedule event this session walked in through, so finishing
   *  can stamp that block done with the real minutes. Absent when the
   *  session started from the gym page itself. */
  doorEventId?: string;
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

/**
 * SESSIONS RESUME, NOT FRAGMENT (2026-08-30, from the training catalog
 * audit). GymFlow used to decide a session was abandoned purely by comparing
 * its `date` to today -- so a workout that started at 11:58pm and was still
 * being actively logged at 12:05am crossed a calendar day through no fault
 * of the user, and the very next remount (phone lock, a notification, a tab
 * switch) silently closed it out as a truncated "unfinished" workout and
 * started a fresh one underneath their thumb. A handful of backgroundings
 * near midnight produced exactly the reported symptom: several short
 * "Pull Day 1" workouts on one night instead of one continuous session.
 *
 * Staleness is about elapsed time since the last real write, not calendar
 * dates. `date === today` is kept as a fast path so every same-day case
 * behaves exactly as before; the grace window only rescues the specific
 * case that broke: real, recent activity on a session whose date has
 * rolled over. A session nobody has touched in GRACE still gets recovered,
 * whatever the date says -- that part of the original design was right.
 */
export const STALE_GRACE_MS = 6 * 60 * 60 * 1000; // 6 hours of no activity

export function isStillActive(s: LiveSession, todayIso: string, now: number = Date.now()): boolean {
  if (s.backdated) return true;
  if (s.date === todayIso) return true;
  return now - (s.lastActivityAt ?? s.startedAt) < STALE_GRACE_MS;
}

/** Log one entry against the exercise at `idx`. Returns the updated session.
 *  D7 (Training Catalog V2, 2026-08-31): the entry is stamped `at: now` on
 *  the way in -- this and setLoggedSets are the only two doors into the live
 *  log, so pacing data accrues from every logged set with no UI knowing. */
export function logSet(s: LiveSession, idx: number, set: SetEntry, now: number = Date.now()): LiveSession {
  const stamped = set.at ? set : { ...set, at: now };
  const exercises = s.exercises.map((ex, i) => (i === idx ? { ...ex, sets: [...ex.sets, stamped] } : ex));
  return { ...s, exercises };
}

/** Replace the whole logged strip for one exercise in a single write: the
 *  set strip (catalog §3.1) owns add / duplicate / delete / reorder / edit
 *  as ONE change to the array, and this is where that change lands. Used
 *  for everything except the big one-tap Log button, which stays logSet so
 *  a matching set is exactly one call.
 *
 *  D7: only chips NEW to the strip get stamped. An edited survivor keeps
 *  its own stamp (an edit is a correction, not a new event), and a legacy
 *  chip that predates the field is never back-stamped with a lie. */
export function setLoggedSets(s: LiveSession, idx: number, sets: SetEntry[], now: number = Date.now()): LiveSession {
  const exercises = s.exercises.map((ex, i) => {
    if (i !== idx) return ex;
    const prior = new Set(ex.sets.map((e) => e.id));
    return { ...ex, sets: sets.map((e) => (e.at || prior.has(e.id) ? e : { ...e, at: now })) };
  });
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
    // entryFrom picks ONLY the numbers: last session's moved marks and D7
    // stamps belong to the sets that already happened, never to plan chips.
    const plan: SetEntry[] = loggedPrior.map(entryFrom);
    return { ...base, sets: [], custom: true, plan };
  });
}
