import type { Exercise, ProgramData, ProgramDay, ProgramWeek, SetEntry } from "./types";
import { newSetId } from "./strip";
import { newExerciseKey } from "./library";

// DUPLICATE, MOVE & COPY (catalog §3.2-3.4). Pure array surgery: GymFlow
// calls these and hands the result straight to updateProgram. Every copy
// mints fresh ids top to bottom (set, exercise, day, week, program) so a
// duplicate never shares a set-strip chip -- or a program's own storage
// item -- with the original; editing one can never bleed into the other.

let seq = 0;
const nid = (p: string) => `${p}${Date.now().toString(36)}${seq++}`;

/** "Push Day" -> "Push Day 2"; "Push Day 2" -> "Push Day 3". A duplicate of a
 *  duplicate keeps counting up rather than piling on trailing "2 2"s. */
export function nextCopyName(name: string): string {
  const m = /^(.*?)\s+(\d+)$/.exec(name);
  if (m) return `${m[1]} ${Number(m[2]) + 1}`;
  return `${name} 2`;
}

function freshSets(sets: SetEntry[]): SetEntry[] {
  return sets.map((s) => ({ ...s, id: newSetId() }));
}

/** Duplicate one exercise in place, right after the original. No name
 *  change: "same lift, different rep scheme" (catalog §3.3) is the point,
 *  and the two rows staying named alike is exactly what makes that legible. */
export function duplicateExercise(day: ProgramDay, exerciseId: string): ProgramDay {
  const i = day.exercises.findIndex((e) => e.id === exerciseId);
  if (i < 0) return day;
  const src = day.exercises[i]!;
  const copy: Exercise = { ...src, id: nid("e"), sets: freshSets(src.sets), pairWith: undefined };
  const exercises = [...day.exercises.slice(0, i + 1), copy, ...day.exercises.slice(i + 1)];
  return { ...day, exercises };
}

function duplicateExerciseFresh(e: Exercise): Exercise {
  return { ...e, id: nid("e"), sets: freshSets(e.sets), pairWith: undefined };
}

/** Duplicate a whole day -- "Push Day" becomes "Push Day 2" ready to edit
 *  (catalog §3.3), right after the original in the same week. */
export function duplicateDay(week: ProgramWeek, dayId: string): ProgramWeek {
  const i = week.days.findIndex((d) => d.id === dayId);
  if (i < 0) return week;
  const src = week.days[i]!;
  const copy: ProgramDay = { id: nid("d"), name: nextCopyName(src.name), exercises: src.exercises.map(duplicateExerciseFresh) };
  const days = [...week.days.slice(0, i + 1), copy, ...week.days.slice(i + 1)];
  return { ...week, days };
}

/** Duplicate an entire program -- "the basis of every new block" (catalog
 *  §3.3). Fresh ids everywhere, never archived, name bumped. */
export function duplicateProgramData(data: ProgramData): ProgramData {
  return {
    name: nextCopyName(data.name),
    weeks: data.weeks.map((w) => ({
      id: nid("w"), label: w.label, ...(w.backOff ? { backOff: true } : {}),
      days: w.days.map((d) => ({ id: nid("d"), name: d.name, exercises: d.exercises.map(duplicateExerciseFresh) })),
    })),
    ...(data.inSeason ? { inSeason: true } : {}),
    ...(data.gameCategoryId ? { gameCategoryId: data.gameCategoryId } : {}),
  };
}

/** Move an exercise from one day to another, same program, preserving its
 *  own id and sets. Any pairing it carried is dropped -- the exercise it was
 *  paired with almost certainly is not on the day it is moving to. */
export function moveExerciseToDay(weeks: ProgramWeek[], fromDayId: string, exerciseId: string, toDayId: string): ProgramWeek[] {
  let moved: Exercise | null = null;
  const stripped = weeks.map((w) => ({
    ...w,
    days: w.days.map((d) => {
      if (d.id !== fromDayId) return d;
      const i = d.exercises.findIndex((e) => e.id === exerciseId);
      if (i < 0) return d;
      moved = { ...d.exercises[i]!, pairWith: undefined };
      return { ...d, exercises: d.exercises.filter((e) => e.id !== exerciseId) };
    }),
  }));
  if (!moved) return weeks;
  return stripped.map((w) => ({
    ...w,
    days: w.days.map((d) => (d.id === toDayId ? { ...d, exercises: [...d.exercises, moved!] } : d)),
  }));
}

/** Copy an exercise to several days at once -- "arm care goes in all four"
 *  (catalog §3.4). The original is untouched; every target day gets its own
 *  fresh copy. */
export function copyExerciseToDays(weeks: ProgramWeek[], sourceDayId: string, exerciseId: string, toDayIds: string[]): ProgramWeek[] {
  const source = weeks.flatMap((w) => w.days).find((d) => d.id === sourceDayId)?.exercises.find((e) => e.id === exerciseId);
  if (!source) return weeks;
  const targets = new Set(toDayIds);
  return weeks.map((w) => ({
    ...w,
    days: w.days.map((d) => (targets.has(d.id) ? { ...d, exercises: [...d.exercises, duplicateExerciseFresh(source)] } : d)),
  }));
}

/** Move a day, with all its exercises, to a target week -- possibly in a
 *  different program (catalog §3.4). Returns the SOURCE program's weeks with
 *  the day removed, and the day itself (own id and content preserved) for
 *  the caller to append to the destination. */
export function extractDay(weeks: ProgramWeek[], dayId: string): { weeks: ProgramWeek[]; day: ProgramDay | null } {
  let found: ProgramDay | null = null;
  const next = weeks.map((w) => {
    const i = w.days.findIndex((d) => d.id === dayId);
    if (i < 0) return w;
    found = w.days[i]!;
    return { ...w, days: w.days.filter((d) => d.id !== dayId) };
  });
  return { weeks: next, day: found };
}

/** Append a day into a target week -- the other half of a day move. Mints a
 *  fresh id when the day is landing in a DIFFERENT program (own storage
 *  item, own identity) but keeps it when reordering within the same one. */
export function appendDayToWeek(weeks: ProgramWeek[], weekId: string, day: ProgramDay, freshId: boolean): ProgramWeek[] {
  const landing: ProgramDay = freshId ? { ...day, id: nid("d"), exercises: day.exercises.map(duplicateExerciseFresh) } : day;
  return weeks.map((w) => (w.id === weekId ? { ...w, days: [...w.days, landing] } : w));
}

/** A stable, freshly-minted exerciseKey for an exercise that has never had
 *  one (predates the library, or was created before this session's edit).
 *  Idempotent: an exercise that already carries a key is returned as-is. */
export function ensureExerciseKey(e: Exercise): Exercise {
  return e.exerciseKey ? e : { ...e, exerciseKey: newExerciseKey() };
}
