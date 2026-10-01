// DELETING AN EXERCISE FOR REAL (2026-10-01).
//
// Archive was the only way an exercise could leave the Exercises page, and
// archive is not delete: the row survives behind the Archived chip, a hand-made
// exercise nobody will ever use stays in the library, and a mistyped one counts
// for ever. This is the true delete, and it is built to the same shape as the
// merge beside it: pure functions that PLAN, a patch that WRITES, and an
// inverse patch captured BEFORE the write so Undo puts back exactly what was
// there (ids and all).
//
// Three situations, because they ask three different questions of the athlete:
//
//   unused    -- nothing logged, nothing planned. Only the library entry and
//                its saved settings go. One plain confirm.
//   programs  -- planned in one or more program days (archived programs too).
//                Removed from each of them; no session is touched.
//   history   -- logged in past sessions. The athlete is asked in so many
//                words: delete the exercise AND its history, or archive it
//                instead. Never decided for them.
//
// Nothing here writes. GymFlow owns the writes (and the guard against an
// exercise that is in the workout in progress), exactly as it owns the merge's.

import type { Goal } from "../life/types";
import type { LiveSession } from "./liveSession";
import type { Program, Workout, WorkoutData, WorkoutExercise, Exercise } from "./types";
import type { CreatedLift, GymSettings } from "./settings";
import { capAfterNumber } from "../shared/casing";
import { fallbackKey } from "./library";
import { ungroupExercise } from "./groups";
import { sameLiftAnyKind } from "./identity";
import { libraryKeyOf, type LibraryPatch, type LibraryRow } from "./libraryEdit";
import { expectedSignature, patchSignature } from "./merge";
import type { LiftMeasure, TrainingMeasure } from "./goalMeasures";

export type DeleteTier = "unused" | "programs" | "history";

/** What the confirm sheet says, every number computed from the records. */
export interface DeletePlan {
  row: Pick<LibraryRow, "key" | "name" | "kind" | "exerciseKey">;
  /** Every identity key this exercise answers to in a workout or a program. */
  keys: string[];
  tier: DeleteTier;
  /** Past sessions that carry the exercise, and the logged sets in them. */
  sessions: number;
  sets: number;
  /** Sessions that would be left with no exercise at all, and so go too. */
  emptied: number;
  /** Program days that carry it, across every program, archived included. */
  programDays: number;
  /** Lift and training goals pointed at it. They are the athlete's own and
   *  stay where they are. */
  goals: number;
  /** The saved settings that go with it, in the words the sheet uses. */
  clears: string[];
}

/** The writes. `workouts` and `programs` are the rewritten records (the same
 *  shape a rename or a merge produces), and `remove` is every session the
 *  deletion leaves empty, whole, so Undo can put it back under its own id. */
export interface DeletePatch extends LibraryPatch {
  remove: Workout[];
}

/** Its inverse: the pre-image of everything the patch touched, and the removed
 *  sessions to bring back. */
export interface RestorePatch extends LibraryPatch {
  restore: Workout[];
}

function keySet(row: Pick<LibraryRow, "key" | "exerciseKey">): Set<string> {
  return new Set([row.key, ...(row.exerciseKey ? [row.exerciseKey] : [])]);
}

function logged(e: WorkoutExercise): number {
  return e.sets.filter((s) => !s.skipped).length;
}

/** Take the exercise out of a day's list. A member of a superset leaves the
 *  group through the same door every other removal uses, so the rest of the
 *  group stays together and a group of one is no group at all. */
function withoutKeys(list: Exercise[], keys: Set<string>): Exercise[] {
  let out = list;
  for (const e of list) if (keys.has(libraryKeyOf(e))) out = ungroupExercise(out, e.id);
  return out.filter((e) => !keys.has(libraryKeyOf(e)));
}

/**
 * Build the patch. `withHistory` false leaves every past session alone (the
 * unused and programs cases); true also takes the exercise out of each session
 * that carries it, and removes the session when that leaves it empty.
 *
 * Only touched records come back, so deleting one exercise costs one write per
 * session and program that actually held it.
 */
export function deletePatch(workouts: Workout[], programs: Program[], row: Pick<LibraryRow, "key" | "exerciseKey">, withHistory: boolean): DeletePatch {
  const keys = keySet(row);
  const out: DeletePatch = { workouts: [], programs: [], remove: [] };
  if (withHistory) {
    for (const w of workouts) {
      if (!w.data.exercises.some((e) => keys.has(libraryKeyOf(e)))) continue;
      const exercises = w.data.exercises.filter((e) => !keys.has(libraryKeyOf(e)));
      if (exercises.length === 0) out.remove.push(w);
      else out.workouts.push({ id: w.id, exercises });
    }
  }
  for (const p of programs) {
    let touched = false;
    const weeks = p.data.weeks.map((wk) => ({
      ...wk,
      days: wk.days.map((d) => {
        if (!d.exercises.some((e) => keys.has(libraryKeyOf(e)))) return d;
        touched = true;
        return { ...d, exercises: withoutKeys(d.exercises, keys) };
      }),
    }));
    if (touched) out.programs.push({ id: p.id, weeks });
  }
  return out;
}

/** The pre-image, read from the records as they stand BEFORE the patch lands.
 *  Applying it puts every program, every rewritten session and every removed
 *  session back exactly. */
export function invertDeletePatch(patch: DeletePatch, workouts: Workout[], programs: Program[]): RestorePatch {
  const byW = new Map(workouts.map((w) => [w.id, w] as const));
  const byP = new Map(programs.map((p) => [p.id, p] as const));
  return {
    workouts: patch.workouts.flatMap((w) => { const cur = byW.get(w.id); return cur ? [{ id: w.id, exercises: cur.data.exercises }] : []; }),
    programs: patch.programs.flatMap((p) => { const cur = byP.get(p.id); return cur ? [{ id: p.id, weeks: cur.data.weeks }] : []; }),
    restore: patch.remove,
  };
}

// --- SETTINGS ---------------------------------------------------------------

/** Every GymSettings field that hangs off a library key. `merges` is not one:
 *  it is the record of what happened, and a record of a merge stays true after
 *  one of its exercises is gone. */
const KEYED = ["createdLifts", "hiddenKeys", "favoriteKeys", "aliases", "classByKey", "muscleByKey", "dismissedDupes"] as const;
export type KeyedSettings = Pick<GymSettings, (typeof KEYED)[number]>;

function dropKeys<T>(rec: Record<string, T> | undefined, keys: Set<string>): Record<string, T> | undefined {
  if (!rec || !Object.keys(rec).some((k) => keys.has(k))) return undefined;
  return Object.fromEntries(Object.entries(rec).filter(([k]) => !keys.has(k)));
}

/** The seeds that would stand in for this exercise: the one made with its key,
 *  and any whose name and measurement match it, because library.withCreated
 *  drops a seed that a real sighting shadows. Left behind, that shadowed seed
 *  would walk back into the list the moment the sighting was deleted. */
function seedsFor(created: CreatedLift[] | undefined, row: Pick<LibraryRow, "name" | "kind">, keys: Set<string>): CreatedLift[] {
  const fb = fallbackKey(row.name, row.kind);
  return (created ?? []).filter((c) => keys.has(c.key) || fallbackKey(c.name, c.kind) === fb);
}

function pairTouches(id: string, keys: Set<string>): boolean {
  for (const k of keys) if (id.startsWith(k + "|") || id.endsWith("|" + k)) return true;
  return false;
}

/** What the settings look like without this exercise, as ONLY the fields that
 *  change. A field with nothing to remove is absent from the result, so the
 *  caller's write leaves it exactly as it was (byte for byte, including a
 *  field that was never there). */
export function settingsWithout(s: GymSettings, row: Pick<LibraryRow, "key" | "exerciseKey" | "name" | "kind">): Partial<KeyedSettings> {
  const keys = keySet(row);
  const out: Partial<KeyedSettings> = {};
  const seeds = seedsFor(s.createdLifts, row, keys);
  if (seeds.length) out.createdLifts = (s.createdLifts ?? []).filter((c) => !seeds.includes(c));
  if ((s.hiddenKeys ?? []).some((k) => keys.has(k))) out.hiddenKeys = (s.hiddenKeys ?? []).filter((k) => !keys.has(k));
  if ((s.favoriteKeys ?? []).some((k) => keys.has(k))) out.favoriteKeys = (s.favoriteKeys ?? []).filter((k) => !keys.has(k));
  const aliases = dropKeys(s.aliases, keys);
  if (aliases) out.aliases = aliases;
  const cls = dropKeys(s.classByKey, keys);
  if (cls) out.classByKey = cls;
  const muscles = dropKeys(s.muscleByKey, keys);
  if (muscles) out.muscleByKey = muscles;
  if ((s.dismissedDupes ?? []).some((id) => pairTouches(id, keys))) out.dismissedDupes = (s.dismissedDupes ?? []).filter((id) => !pairTouches(id, keys));
  return out;
}

/** The pre-image of the fields `settingsWithout` is about to change, for
 *  Undo. `undefined` marks a field that was not there, so restoring it removes
 *  it again instead of leaving an empty list where nothing used to be. */
export function settingsBefore(s: GymSettings, changed: Partial<KeyedSettings>): Partial<Record<keyof KeyedSettings, unknown>> {
  const out: Partial<Record<keyof KeyedSettings, unknown>> = {};
  for (const k of Object.keys(changed) as (keyof KeyedSettings)[]) out[k] = s[k];
  return out;
}

/** The settings with those fields replaced. Only the fields named change, and
 *  each keeps its place in the object, so a write after this and a write after
 *  `settingsRestore` serialise to the same bytes the store held to begin with. */
export function settingsApply(s: GymSettings, fields: Partial<Record<keyof KeyedSettings, unknown>>): GymSettings {
  return { ...s, ...fields } as GymSettings;
}

/** Put the pre-image back. A field that was not there is removed again rather
 *  than left as an empty list. */
export function settingsRestore(s: GymSettings, before: Partial<Record<keyof KeyedSettings, unknown>>): GymSettings {
  const next = { ...s } as Record<string, unknown>;
  for (const [k, v] of Object.entries(before)) {
    if (v === undefined) delete next[k]; else next[k] = v;
  }
  return next as unknown as GymSettings;
}

/** What gets cleared, in the sheet's words. Only what exists is named. */
function clearsFor(s: GymSettings, row: Pick<LibraryRow, "key" | "exerciseKey" | "name" | "kind">): string[] {
  const keys = keySet(row);
  const has = (r: Record<string, unknown> | undefined) => !!r && Object.keys(r).some((k) => keys.has(k));
  const out: string[] = [];
  if (has(s.classByKey) || has(s.muscleByKey)) out.push("its muscles and details");
  if ((s.favoriteKeys ?? []).some((k) => keys.has(k))) out.push("its favorite mark");
  if ((s.hiddenKeys ?? []).some((k) => keys.has(k))) out.push("its hidden mark");
  if (has(s.aliases)) out.push("its old names");
  return out;
}

// --- THE PLAN ---------------------------------------------------------------

/** Goals pointed at this exercise: a lift goal on it, or a training goal that
 *  counts only sessions of it. */
export function goalsOnExercise(goals: Goal[], row: Pick<LibraryRow, "name" | "exerciseKey">): Goal[] {
  return goals.filter((g) => {
    const m = g.data.measure;
    if (!m) return false;
    if (m.kind === "lift") {
      const lm = m as LiftMeasure;
      return sameLiftAnyKind({ name: lm.exercise, exerciseKey: lm.exerciseKey }, row);
    }
    if (m.kind === "training") {
      const tm = m as TrainingMeasure;
      return !!tm.exercise && sameLiftAnyKind({ name: tm.exercise, exerciseKey: tm.exerciseKey }, row);
    }
    return false;
  });
}

export function planDelete(args: {
  row: Pick<LibraryRow, "key" | "name" | "kind" | "exerciseKey">;
  workouts: Workout[];
  programs: Program[];
  goals?: Goal[];
  settings?: GymSettings;
}): DeletePlan {
  const { row, workouts, programs } = args;
  const keys = keySet(row);
  let sessions = 0;
  let sets = 0;
  for (const w of workouts) {
    const mine = w.data.exercises.filter((e) => keys.has(libraryKeyOf(e)));
    if (!mine.length) continue;
    sessions++;
    for (const e of mine) sets += logged(e);
  }
  const history = deletePatch(workouts, programs, row, true);
  let programDays = 0;
  for (const p of programs) for (const wk of p.data.weeks) for (const d of wk.days) {
    if (d.exercises.some((e) => keys.has(libraryKeyOf(e)))) programDays++;
  }
  return {
    row,
    keys: [...keys],
    tier: sessions > 0 ? "history" : programDays > 0 ? "programs" : "unused",
    sessions,
    sets,
    emptied: history.remove.length,
    programDays,
    goals: goalsOnExercise(args.goals ?? [], row).length,
    clears: args.settings ? clearsFor(args.settings, row) : [],
  };
}

/** Can this delete still be safely undone? Only when every record it touched
 *  is still exactly as the delete left it, and every session it removed is
 *  still gone. Anything edited since would be thrown away by the pre-image,
 *  the same reasoning (and the same signature) the merge's Undo uses. Read
 *  `now` from the records AT THE TAP, not from when the delete ran. */
export function deleteUndoSafe(patch: DeletePatch, now: { workouts: Workout[]; programs: Program[] }): boolean {
  const rewrites: LibraryPatch = { workouts: patch.workouts, programs: patch.programs };
  if (patchSignature(rewrites, now.workouts, now.programs) !== expectedSignature(rewrites)) return false;
  const have = new Set(now.workouts.map((w) => w.id));
  return patch.remove.every((w) => !have.has(w.id));
}

// --- THE GUARD --------------------------------------------------------------

/** Is the exercise in a workout that is happening, or one finished and still
 *  being saved? Deleting under either would break it: the session screen reads
 *  its exercises from the live record, and a pending workout lands in the
 *  history after the delete and brings the exercise straight back. */
export function inProgressOf(
  row: Pick<LibraryRow, "key" | "exerciseKey">,
  live: Pick<LiveSession, "exercises"> | null,
  pending: Pick<WorkoutData, "exercises">[] = [],
): "live" | "pending" | null {
  const keys = keySet(row);
  const has = (list: WorkoutExercise[]) => list.some((e) => keys.has(libraryKeyOf(e)));
  if (live && has(live.exercises)) return "live";
  if (pending.some((p) => has(p.exercises))) return "pending";
  return null;
}

// --- THE WORDS --------------------------------------------------------------

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "5 sessions, 14 sets": what is logged under it. Absent when nothing is. */
export function historyLine(plan: DeletePlan): string | null {
  if (plan.sessions === 0) return null;
  return plural(plan.sessions, "session", "sessions") + (plan.sets > 0 ? `, ${plural(plan.sets, "set", "sets")}` : "");
}

/** "Used in 3 program days". Absent when it is in none. */
export function programLine(plan: DeletePlan): string | null {
  return plan.programDays > 0 ? `Used in ${plural(plan.programDays, "program day", "program days")}` : null;
}

/** The lines of "What Goes", each one a true statement about this delete. */
export function goesLines(plan: DeletePlan): string[] {
  const out = ["It leaves your Exercises list"];
  if (plan.programDays > 0) out.push(`It comes out of ${plural(plan.programDays, "program day", "program days")}`);
  if (plan.tier === "history") {
    out.push(`Its ${plural(plan.sessions, "session", "sessions")} come${plan.sessions === 1 ? "s" : ""} out of your history`);
    if (plan.emptied > 0) out.push(`${plural(plan.emptied, "session", "sessions")} left empty ${plan.emptied === 1 ? "is" : "are"} removed`);
  }
  if (plan.clears.length) out.push(`It also clears ${joinWords(plan.clears)}`);
  // A line that opens on a number hands its capital to the word behind it.
  return out.map(capAfterNumber);
}

function joinWords(list: string[]): string {
  if (list.length <= 1) return list[0] ?? "";
  return list.slice(0, -1).join(", ") + " and " + list[list.length - 1];
}

/** What stays, said once: the athlete's goals are theirs. */
export function staysLine(plan: DeletePlan): string | null {
  if (plan.goals === 0) return null;
  return capAfterNumber(plan.goals === 1 ? `${plan.goals} goal on it stays as it is` : `${plan.goals} goals on it stay as they are`);
}
