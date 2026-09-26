import type { AddedExerciseFields, Exercise, WorkoutData, WorkoutExercise, SetEntry, MeasureKind, ProgramDay } from "./types";
import { newClientId } from "../shared/clientId";
import { entryFrom } from "./strip";
import { loadFields, type Counted } from "./equipment";

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
  /** GYM-F-01 (2026-09-05): the wall-clock ms the current rest ends. Set
   *  when a set is logged on a lift with a rest target, cleared by Skip Rest
   *  or Continue. Lives here rather than in screen state so a rest survives
   *  the app being killed mid-rest, and so the countdown is a function of
   *  the clock rather than of how many timer ticks the webview let fire. */
  restEndsAt?: number;
  /** H-52 (Health Push B, 2026-09-12): a parked session keeps the clock
   *  honest. `pausedAt` is stamped when Back or Pause parks it; resuming
   *  folds now - pausedAt into `pausedMs` and clears it. Elapsed and the
   *  receipt's minutes read startedAt + pausedMs, never the wall clock alone. */
  pausedMs?: number;
  pausedAt?: number;
  /** A SUPERSET MADE FOR TODAY ONLY (Dave, 2026-09-21, picking "ask me each
   *  time"). exerciseId -> groupId, for pairs made mid-session that are NOT
   *  to reach the program.
   *
   *  Grouping has always been a program construct, and the live screen reads
   *  its pairs off the day. That is right for a pair you train every week and
   *  wrong for the one you invent because a rack is busy, so the choice had
   *  no honest "just today" answer to offer -- it would have been a button
   *  that lies. This is the other half: the ids are the DAY's exercise ids,
   *  the same ones the program uses, so one overlay is enough and everything
   *  that reads a group (the label, the filler, the round rest, what comes
   *  next in the round) keeps reading exactly what it read before.
   *
   *  A stance for one session, like every other field here (LAW 17), and
   *  absent on every session that never made one. */
  groups?: Record<string, string>;
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

/** H-52: park the session, stamping when its clock stopped. Idempotent. */
export function parkLive(s: LiveSession, now: number = Date.now()): LiveSession {
  return s.pausedAt ? s : { ...s, pausedAt: now };
}

/** H-52: resume a parked session, folding the parked stretch into pausedMs. */
export function resumeLive(s: LiveSession, now: number = Date.now()): LiveSession {
  if (!s.pausedAt) return s;
  const { pausedAt, ...rest } = s;
  return { ...rest, pausedMs: (s.pausedMs ?? 0) + Math.max(0, now - pausedAt) };
}

/** Time actually in the gym: the wall clock since start, less every parked
 *  stretch, including one still open. */
export function elapsedMs(s: LiveSession, now: number = Date.now()): number {
  const open = s.pausedAt ? Math.max(0, now - s.pausedAt) : 0;
  return Math.max(0, now - s.startedAt - (s.pausedMs ?? 0) - open);
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

// GYM-F-28 (2026-09-05): undoLast had no caller. A mistyped set is corrected
// in place on the strip (setLoggedSets above), which is the same repair
// without a second idiom for it.

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
let midSeq = 0;

export function swapExercise(
  s: LiveSession,
  idx: number,
  sub: { exerciseKey?: string; name: string; kind: MeasureKind; unit?: string; timeUnit?: string },
): LiveSession {
  const cur = s.exercises[idx];
  if (!cur) return s;
  // Part 3 wave 5 (O4a; handoff acceptance 7): a swap after sets were logged
  // keeps the original's records where they are and starts the replacement
  // as its own entry right after, with its own identity. Before any set,
  // the slot is simply retaken, as it always was.
  const logged = cur.sets.some((x) => !x.skipped);
  const fresh = {
    exerciseId: logged ? "swap" + Date.now().toString(36) + (midSeq++) : cur.exerciseId,
    name: sub.name, kind: sub.kind,
    ...(sub.unit ? { unit: sub.unit } : {}),
    ...(sub.timeUnit ? { timeUnit: sub.timeUnit } : {}),
    ...(sub.exerciseKey ? { exerciseKey: sub.exerciseKey } : {}),
    sets: [] as SetEntry[], custom: true as const, plan: [] as SetEntry[],
  };
  if (!logged) return { ...s, exercises: s.exercises.map((ex, i) => (i === idx ? fresh : ex)) };
  const exercises = [...s.exercises.slice(0, idx + 1), fresh, ...s.exercises.slice(idx + 1)];
  return { ...s, exercises, idx: idx + 1 };
}


/**
 * ADD MID-SESSION (catalog §3.10). Append an exercise that was never in the
 * plan, without touching the program. `plan` carries the picked target strip
 * forward as ghost chips, same as a normal planned exercise would.
 */
export function addExerciseMidSession(
  s: LiveSession,
  ex: { exerciseKey?: string; name: string; kind: MeasureKind; unit?: string; timeUnit?: string; equipment?: string; counted?: Counted; sided?: boolean; plan: SetEntry[] } & AddedExerciseFields,
): LiveSession {
  const exerciseId = `mid${Date.now().toString(36)}${midSeq++}`;
  // GYM-F-21 (2026-09-05): the added exercise used to keep only its identity
  // and its strip, so a clock became a set strip, a stated rest never rang,
  // and the ramp, the note and the muscle were gone. Nothing else in the
  // session knows about this exercise, so what it carries here is all it will
  // ever have.
  const program: AddedExerciseFields = {
    ...(ex.cond ? { cond: ex.cond } : {}),
    ...(ex.restSec ? { restSec: ex.restSec } : {}),
    ...(ex.ramp ? { ramp: true } : {}),
    ...(ex.muscleGroup ? { muscleGroup: ex.muscleGroup } : {}),
    ...(ex.note ? { note: ex.note } : {}),
  };
  const entry: WorkoutExercise = {
    exerciseId, name: ex.name, kind: ex.kind,
    ...(ex.unit ? { unit: ex.unit } : {}),
    ...(ex.timeUnit ? { timeUnit: ex.timeUnit } : {}),
    ...(ex.exerciseKey ? { exerciseKey: ex.exerciseKey } : {}),
    // AND ITS CONVENTION (2026-09-16), for the same reason GYM-F-21 gave for
    // the clock and the ramp: nothing else in the session knows about this
    // exercise, so what it carries here is all it will ever have. A lift
    // added from the library arrived with no equipment, so the strip stepped
    // it by 5 and the record filed it as unclassified.
    ...loadFields(ex),
    sets: [], custom: true, plan: ex.plan,
    ...(Object.keys(program).length ? { program } : {}),
  };
  return { ...s, exercises: [...s.exercises, entry] };
}

/** Finished session -> pending queue. Nothing is ever dropped for being offline. */
export function queueFinished(w: WorkoutData, store: Storage2 = browserStorage()): void {
  const all = readPending(store);
  // H-51 (Health Push F): the same idempotency key the health queue stamps.
  all.push(w.clientId ? w : { ...w, clientId: newClientId() });
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

// GYM-F-23 (2026-09-05): one flush at a time. GymFlow flushes from two
// mount effects in the same commit (the reload, and the unfinished-session
// recovery that queues B and flushes), and two flushes over one queue each
// snapshotted [A]: A saved twice, Recent showed the same workout twice, and
// every PR and volume figure derived from it doubled. A flush that finds one
// in flight waits for it, then runs its own fresh pass, so what the second
// caller just queued still lands and nothing lands twice. Same shape as
// health/offlineQueue.ts (HMN-F-07), fixed the same day.
let tail: Promise<unknown> = Promise.resolve();

/**
 * Try to persist every pending session. Whatever fails stays queued, in order,
 * for the next attempt. Returns how many landed.
 */
export function flushPending(
  save: (w: WorkoutData) => Promise<string | null>,
  store: Storage2 = browserStorage(),
): Promise<number> {
  const run = tail.then(() => drain(save, store));
  tail = run.catch(() => undefined);
  return run;
}

async function drain(
  save: (w: WorkoutData) => Promise<string | null>,
  store: Storage2,
): Promise<number> {
  const all = readPending(store);
  if (all.length === 0) return 0;
  let saved = 0;
  for (const w of all) {
    let id: string | null = null;
    try { id = await save(w); } catch { id = null; }
    // Remove each landed session as it lands rather than writing the
    // snapshot's leftovers back at the end: a session queued while this
    // flush was in flight is not in the snapshot, and the old write-back
    // would have dropped it. Whatever fails stays where it was, in order.
    if (id) { saved++; removeOne(w, store); }
  }
  return saved;
}

function removeOne(w: WorkoutData, store: Storage2): void {
  const now = readPending(store);
  const key = JSON.stringify(w);
  const idx = now.findIndex((x) => JSON.stringify(x) === key);
  if (idx < 0) return;
  now.splice(idx, 1);
  writePending(now, store);
}

/**
 * Which program exercise, if any, is behind a live entry.
 *
 * GYM-F-08 (2026-09-05): `custom` means "the plan chips come from this
 * entry's own `plan`, not from the program day" -- it has never meant "there
 * is no program exercise behind this", but GymFlow read it that way. Same as
 * Last Time marks every entry custom while every one of them still IS a
 * program exercise, so a whole session lost its rest timers, its warm-up
 * ramps, its A1/A2 tags, its notes and its conditioning clocks.
 *
 * The slot id alone cannot answer it either: Swap deliberately keeps the
 * original's exerciseId so the This Session list stays stable
 * (liveSession.ts:169-177), so a swapped entry sits in a program exercise's
 * slot while being a different lift. Identity settles it: the key when both
 * sides carry one, else name and kind.
 */
export function programExerciseFor(e: WorkoutExercise, day: ProgramDay | null | undefined): Exercise | undefined {
  const pe = day?.exercises.find((x) => x.id === e.exerciseId);
  if (!pe) return undefined;
  if (pe.exerciseKey && e.exerciseKey) return pe.exerciseKey === e.exerciseKey ? pe : undefined;
  return pe.name === e.name && pe.kind === e.kind ? pe : undefined;
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
    // Working sets only (2026-09-26): last session's warm-ups and drop
    // segments were being carried forward as WORKING sets of the plan, so a
    // ramp of three became three extra sets to log.
    const loggedPrior = prior?.sets.filter((s) => !s.skipped && !s.warmup && !s.drop) ?? [];
    if (!prior || loggedPrior.length === 0) return { ...base, sets: [] };
    // entryFrom picks ONLY the numbers: last session's moved marks and D7
    // stamps belong to the sets that already happened, never to plan chips.
    const plan: SetEntry[] = loggedPrior.map(entryFrom);
    return { ...base, sets: [], custom: true, plan };
  });
}

/** ALREADY SAVED FROM ANOTHER DEVICE (Part 3 wave 4, 2026-09-13; Dave's
 *  13a). The live session never leaves the phone it runs on, so the one
 *  collision two devices can have is finishing the same program day on the
 *  same date twice. The saved workout that would be this session's twin, or
 *  null: same day id, same date, a different start (its own start would be
 *  the session resuming, not a twin). */
export function twinWorkout(workouts: { data: Pick<WorkoutData, "dayId" | "date" | "startedAt"> }[], live: Pick<LiveSession, "dayId" | "date" | "startedAt">): { data: Pick<WorkoutData, "dayId" | "date" | "startedAt"> } | null {
  return workouts.find((w) => w.data.dayId === live.dayId && w.data.date === live.date && w.data.startedAt !== live.startedAt) ?? null;
}
