import type { GymService } from "../gym/GymService";
import type { LibraryEntry } from "../gym/library";
import { fallbackKey } from "../gym/library";
import { normalizeExerciseName } from "../gym/starterLibrary";
import { readLive, writeLive, logSet, setLoggedSets, isStillActive } from "../gym/liveSession";
import { newSetId } from "../gym/strip";
import type { SetEntry, WorkoutData, WorkoutExercise } from "../gym/types";
import type { SpokenSet } from "./spokenSet";

// WHERE A SPOKEN SET IS WRITTEN (the speech box, 2026-10-31). One event, one record (Logging Standard addendum 7).
//
//  1. A live session that has this lift on it: the set goes on that lift, exactly as a set logged on the Now card does.
//  2. Otherwise today's Quick Log: one workout per day that holds the sets said outside a session, so a set said at the
//     rack with no session open lands in training history (PRs, last time, the Exercises page) instead of in Notes.
//
// Every set is "reported" (said by him, not suggested). The result carries its own Undo, which puts the record back the
// way it was: the sets come off the lift, and a Quick Log this created is removed.

export const QUICK_LOG_DAY = "quick-log";

export interface SetLogged {
  where: "session" | "quick";
  name: string;
  undo: () => Promise<void>;
}

const same = (a: string, b: string): boolean => normalizeExerciseName(a) === normalizeExerciseName(b);

function entries(s: SpokenSet): SetEntry[] {
  return Array.from({ length: s.sets }, () => ({
    id: newSetId(),
    ...(s.w !== undefined ? { w: s.w } : {}),
    ...(s.r !== undefined ? { r: s.r } : {}),
    state: "reported" as const,
  }));
}

export async function logSpokenSet(s: SpokenSet, opts: { gym: GymService | null; library: LibraryEntry[]; today: string; now?: number }): Promise<SetLogged | null> {
  // 1. The live session.
  const live = readLive();
  if (live && isStillActive(live, opts.today)) {
    const idx = live.exercises.findIndex((e) => !e.skipped && same(e.name, s.name));
    if (idx >= 0) {
      const before = live.exercises[idx]!.sets;
      let next = live;
      for (const set of entries(s)) next = logSet(next, idx, set);
      writeLive(next);
      return {
        where: "session",
        name: live.exercises[idx]!.name,
        undo: async () => { const cur = readLive(); if (cur) writeLive(setLoggedSets(cur, idx, before)); },
      };
    }
  }
  // 2. Today's Quick Log.
  const gym = opts.gym;
  if (!gym) return null;
  const lib = opts.library.find((e) => same(e.name, s.name));
  const name = lib?.name ?? s.name;
  const now = opts.now ?? Date.now();
  const sets = entries(s);
  const workouts = await gym.listWorkouts();
  const quick = workouts.find((w) => w.data.date === opts.today && w.data.dayId === QUICK_LOG_DAY);
  const fresh = (): WorkoutExercise => ({
    exerciseId: lib?.exerciseKey ?? lib?.key ?? fallbackKey(name, "weight_reps"),
    name,
    kind: lib?.kind ?? "weight_reps",
    unit: lib?.unit ?? s.unit,
    sets,
    ...(lib?.exerciseKey ? { exerciseKey: lib.exerciseKey } : {}),
  });
  if (quick) {
    const prior = quick.data.exercises;
    const at = prior.findIndex((e) => same(e.name, name));
    const exercises = at >= 0
      ? prior.map((e, i) => (i === at ? { ...e, sets: [...e.sets, ...sets] } : e))
      : [...prior, fresh()];
    const ok = await gym.updateWorkout(quick.id, { exercises, endedAt: now });
    if (!ok) return null;
    return { where: "quick", name, undo: async () => { await gym.updateWorkout(quick.id, { exercises: prior, endedAt: quick.data.endedAt }); } };
  }
  const data: WorkoutData = {
    programId: "", dayId: QUICK_LOG_DAY, dayName: "Quick Log", date: opts.today,
    startedAt: now, endedAt: now, exercises: [fresh()],
  };
  const id = await gym.saveWorkout(data);
  if (!id) return null;
  return { where: "quick", name, undo: async () => { await gym.removeWorkout(id); } };
}
