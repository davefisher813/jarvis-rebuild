import type { Exercise, ProgramData, ProgramDay, ProgramWeek, SetEntry } from "./types";
import { newSetId } from "./strip";
import { newExerciseKey } from "./library";
import { loadFields, type Counted } from "./equipment";

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
  // UP-ATH-17 (2026-09-06): a copy joins no group either. The original keeps
  // its place in the rotation; a duplicate silently taking a turn in it would
  // be an A4 nobody asked for.
  const copy: Exercise = { ...src, id: nid("e"), sets: freshSets(src.sets), pairWith: undefined, groupId: undefined };
  const exercises = [...day.exercises.slice(0, i + 1), copy, ...day.exercises.slice(i + 1)];
  return { ...day, exercises };
}

function duplicateExerciseFresh(e: Exercise): Exercise {
  return { ...e, id: nid("e"), sets: freshSets(e.sets), pairWith: undefined, groupId: undefined };
}

// GYM-F-05 (2026-09-05): every day copy in this file was rebuilt from an
// allow-list of three fields (id, name, exercises), so Duplicate Day,
// Duplicate Program, Duplicate & Bump and a cross-program Move Day all landed
// a day with no Pin Days, no Warm-Up card and no Cool-Down card, and with
// Row/Curl no longer A1/A2. A pair is a relationship BETWEEN two exercises in
// one day: copying both halves has to copy the link and point it at the new
// ids, which is what duplicateExerciseFresh (built for the single-exercise
// case, where the partner stays behind) could not do on its own.

/** Fresh ids for a whole day's exercises, with pairing remapped onto the
 *  copies. A half whose partner is not in this set keeps no link, because
 *  there is nothing in the copy for it to point at. */
function duplicateExercisesFresh(exercises: Exercise[]): Exercise[] {
  const idMap = new Map(exercises.map((e) => [e.id, nid("e")]));
  // UP-ATH-17 (2026-09-06): groups are remapped the same way pairs are, onto
  // fresh ids, so the copy's circuit is the COPY's circuit. Sharing a groupId
  // across two days would make editing one day's tri-set rearrange another's.
  const groupMap = new Map<string, string>();
  for (const e of exercises) if (e.groupId && !groupMap.has(e.groupId)) groupMap.set(e.groupId, nid("g"));
  return exercises.map((e) => {
    const copy: Exercise = { ...e, id: idMap.get(e.id)!, sets: freshSets(e.sets) };
    const partner = e.pairWith ? idMap.get(e.pairWith) : undefined;
    if (partner) copy.pairWith = partner;
    else delete copy.pairWith;
    const group = e.groupId ? groupMap.get(e.groupId) : undefined;
    if (group) copy.groupId = group;
    else delete copy.groupId;
    return copy;
  });
}

/** A whole day, copied: its blocks (own fresh ids, so editing one copy's
 *  warm-up never touches the other's), its budgeted minutes, its pins, and
 *  its exercises with pairing intact.
 *
 *  `keepPins` is false only for a copy landing in the SAME week, where two
 *  days pinned to one weekday would both claim that day on the calendar. */
export function duplicateDayFresh(d: ProgramDay, keepPins: boolean): ProgramDay {
  const copy: ProgramDay = { ...d, id: nid("d"), exercises: duplicateExercisesFresh(d.exercises) };
  if (d.warmUp) copy.warmUp = d.warmUp.map((b) => ({ ...b, id: nid("b") }));
  if (d.coolDown) copy.coolDown = d.coolDown.map((b) => ({ ...b, id: nid("b") }));
  if (!keepPins) delete copy.pinDays;
  return copy;
}

/** Duplicate a whole day -- "Push Day" becomes "Push Day 2" ready to edit
 *  (catalog §3.3), right after the original in the same week. */
export function duplicateDay(week: ProgramWeek, dayId: string): ProgramWeek {
  const i = week.days.findIndex((d) => d.id === dayId);
  if (i < 0) return week;
  const src = week.days[i]!;
  const copy: ProgramDay = { ...duplicateDayFresh(src, false), name: nextCopyName(src.name) };
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
      days: w.days.map((d) => duplicateDayFresh(d, true)),
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
      moved = { ...d.exercises[i]!, pairWith: undefined, groupId: undefined };
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
 *  item, own identity) but keeps it when reordering within the same one.
 *
 *  GYM-F-12 (2026-09-05): a week id this program does not have (the caller
 *  minted one because the target had no weeks) used to be a silent no-op,
 *  so the day was dropped while the toast said "Moved". The day now lands
 *  in a NEW week under that id instead. */
export function appendDayToWeek(weeks: ProgramWeek[], weekId: string, day: ProgramDay, freshId: boolean): ProgramWeek[] {
  const landing: ProgramDay = freshId ? duplicateDayFresh(day, true) : day;
  if (!weeks.some((w) => w.id === weekId)) {
    return [...weeks, { id: weekId, label: `Week ${weeks.length + 1}`, days: [landing] }];
  }
  return weeks.map((w) => (w.id === weekId ? { ...w, days: [...w.days, landing] } : w));
}

/** Move a day from one program to another: the two writes in the order that
 *  cannot lose it. GYM-F-12 (2026-09-05): GymFlow removed the day from the
 *  source first and appended it to the target second, with no catch, so a
 *  second write that failed on a flaky connection left the day in neither
 *  program and the toast never showed. The target is written first; the
 *  source is only touched once the day exists somewhere else. `write`
 *  resolves true when the program took the weeks (GymService.updateProgram's
 *  own contract) and may throw.
 *    "moved"  both writes landed
 *    "landed" the day is in the target AND still in the source (the second
 *             write failed): a duplicate to tidy, never a loss
 *    "failed" nothing changed */
export async function moveDayBetweenPrograms(
  write: (programId: string, weeks: ProgramWeek[]) => Promise<boolean>,
  source: { id: string; weeks: ProgramWeek[] },
  target: { id: string; weeks: ProgramWeek[] },
  dayId: string,
  targetWeekId: string,
): Promise<"moved" | "landed" | "failed"> {
  const { weeks: sourceLeft, day } = extractDay(source.weeks, dayId);
  if (!day) return "failed";
  try {
    if (!(await write(target.id, appendDayToWeek(target.weeks, targetWeekId, day, true)))) return "failed";
  } catch {
    return "failed";
  }
  try {
    if (!(await write(source.id, sourceLeft))) return "landed";
  } catch {
    return "landed";
  }
  return "moved";
}

/** Apply an ExerciseSheet draft onto the exercise it edited. The sheet owns
 *  every field it renders, so a cleared note or a switched-off ramp really is
 *  gone; `pairWith` and `groupId` are the Exercise fields the sheet has no
 *  state for at all (grouping is set from the row menu, catalog §4.2), so
 *  they ride through the edit untouched.
 *
 *  GYM-F-03 (2026-09-05): GymFlow.tsx:1224-1226 replaced the exercise with
 *  the bare draft, so changing the reps on either half of an A1/A2 pair
 *  silently unpaired it: the tags vanished, the session stopped alternating
 *  and offering Next/Switch, Unpair no longer offered itself on the edited
 *  half, and the partner was left pointing at an exercise that no longer
 *  pointed back. */
export function applyExerciseEdit(existing: Exercise, draft: Omit<Exercise, "id">): Exercise {
  return {
    ...draft,
    id: existing.id,
    ...(existing.pairWith ? { pairWith: existing.pairWith } : {}),
    // UP-ATH-17 (2026-09-06): groupId rides through an edit for exactly the
    // same reason pairWith does, and GYM-F-03 is the bug that happens when it
    // does not: editing one member of a circuit would drop it out of one.
    ...(existing.groupId ? { groupId: existing.groupId } : {}),
  };
}

// GYM-F-28 (2026-09-05): ensureExerciseKey had no caller. Keys are minted at
// creation in ExerciseSheet, and the identity readers (sameLiftAnyKind) fall
// back to the name for the pre-library exercises that carry none.

// ALSO UPDATE THE PROGRAM (Part 3 wave 5, 2026-09-13; Dave's 10a). A swap
// or an add inside a session changes that session only; this is the one
// explicit way to carry it into the program day. A swapped entry keeps the
// slot's own strip and settings and takes the new identity; an added one
// becomes a new exercise at the end of the day, with the plan and the
// settings the session gave it.
export function dayWithSessionEntry(
  day: ProgramDay,
  entry: { exerciseId: string; name: string; kind: Exercise["kind"]; unit?: string; timeUnit?: string; exerciseKey?: string; equipment?: string; counted?: Counted; sided?: boolean; plan?: SetEntry[]; program?: Partial<Pick<Exercise, "cond" | "restSec" | "ramp" | "muscleGroup" | "note">> },
  newId: () => string,
): ProgramDay {
  // THE CONVENTION COMES WITH IT (2026-09-16). "Also Update the Program"
  // carried a lift's name, kind and units into the program and left its
  // equipment, its reading and its reps axis behind -- so a dumbbell press
  // swapped in mid-session and kept landed in the plan as an unclassified
  // lift, and the next session started it stepping by 5 and calling its
  // number "Weight". loadFields is the one spelling of this copy.
  const identity = {
    name: entry.name, kind: entry.kind,
    ...(entry.unit ? { unit: entry.unit } : {}),
    ...(entry.timeUnit ? { timeUnit: entry.timeUnit } : {}),
    ...(entry.exerciseKey ? { exerciseKey: entry.exerciseKey } : {}),
    ...loadFields(entry),
  };
  const idx = day.exercises.findIndex((e) => e.id === entry.exerciseId);
  if (idx >= 0) {
    return { ...day, exercises: day.exercises.map((e, i) => (i === idx ? { ...e, ...identity } : e)) };
  }
  const added: Exercise = { id: newId(), ...identity, sets: (entry.plan ?? []).map((s) => ({ ...s, id: newSetId() })), ...(entry.program ?? {}) };
  return { ...day, exercises: [...day.exercises, added] };
}

/** MOVING A FINISHED SESSION TO ANOTHER DAY (Dave 2026-09-17: "should be able
 *  to fully edit completed workouts").
 *
 *  `date` is the local ISO day every chart, streak and weekly total reads,
 *  and `startedAt` / `endedAt` are the real clock stamps the duration is
 *  measured between. Rewriting the day without the stamps leaves a session
 *  dated Sep 14 that started at 6pm on Sep 17 -- the duration stays right and
 *  everything that prints a time is wrong.
 *
 *  So both stamps shift by the same whole number of days. The duration is
 *  untouched by construction (both ends move together), and the time of day
 *  the session was done is kept, which is the only honest reading of "this
 *  happened on Tuesday instead".
 *
 *  A patch, not a record: it returns only what changed, and nothing at all
 *  when the day is the same or either side is not a date.
 */
export function movedToDay(
  data: { date: string; startedAt?: number; endedAt?: number },
  nextDate: string,
): { date: string; startedAt?: number; endedAt?: number } | null {
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  if (!ISO.test(nextDate) || !ISO.test(data.date) || nextDate === data.date) return null;
  const at = (iso: string) => new Date(iso + "T12:00:00").getTime();
  const days = Math.round((at(nextDate) - at(data.date)) / 86_400_000);
  const by = days * 86_400_000;
  return {
    date: nextDate,
    ...(typeof data.startedAt === "number" ? { startedAt: data.startedAt + by } : {}),
    ...(typeof data.endedAt === "number" ? { endedAt: data.endedAt + by } : {}),
  };
}
