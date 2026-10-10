// EQUIPMENT OUT OF THE NAME, ONCE, THROUGH THE RENAME DOOR (Dave 2026-10-09,
// pass-off item 5: "Chest Flys (Machine)" becomes "Chest Flys" with Machine as
// its equipment).
//
// Equipment is a property of the exercise now, tappable on the session's list
// rows and its header, so a name that also says it is saying it twice, and
// the two can disagree the day the equipment is changed. This plans the one
// cleanup that takes the word out of the name and keeps the answer.
//
// It is the library's own rename, nothing new: every sighting of the exercise
// takes the clean name through renameLift, which keeps (or stamps) the
// exerciseKey so history never forks, and the old name joins the aliases so it
// is still searchable. The classification takes the equipment ONLY when
// nothing has said one yet, so an answer the person gave is never replaced by
// one read out of a name.
//
// SAFE BY CONSTRUCTION:
//   - pure: it returns a plan (patches and the settings they need), and the
//     caller writes it through the existing services;
//   - idempotent: once a name is clean there is nothing to plan, so running it
//     on every visit costs one scan;
//   - convergent after a failed write: a lift with no key gets one derived
//     from its old identity, so a retry stamps the SAME key on what is left
//     rather than forking the history in two;
//   - it never merges: two exercises that land on the same name stay two, and
//     the duplicate review (the one door for a merge) offers them as a pair;
//   - it waits: an exercise in the workout in progress, or in one still
//     saving, is left for the next visit, and so is one a goal follows by
//     name alone (the goal would stop seeing it).

import type { Exercise, MeasureKind, Program, Workout } from "./types";
import { defaultCount, splitEquipmentSuffix, type Equipment } from "./equipment";
import { EMPTY_CLASS, type ClassStore } from "./classify";
import { renameLift, libraryKeyOf, aliasesAfterRename, type AliasMap, type LibraryPatch } from "./libraryEdit";
import type { CreatedLift } from "./settings";

export interface CleanupInput {
  workouts: Workout[];
  programs: Program[];
  createdLifts: CreatedLift[];
  store: ClassStore;
  aliases: AliasMap;
  favoriteKeys: string[];
  hiddenKeys: string[];
  dismissedDupes: string[];
  /** Lift goals, as the name and key they follow. */
  goals: { exercise: string; exerciseKey?: string }[];
  /** True for an exercise that must not be touched right now (in the live
   *  workout, or in a finished one still waiting to upload). */
  busy: (row: { key: string; exerciseKey?: string }) => boolean;
}

export interface CleanupRename {
  key: string;
  /** The key every sighting carries afterwards. */
  stampedKey: string;
  from: string;
  to: string;
  equipment: Equipment;
}

export interface CleanupPlan {
  renames: CleanupRename[];
  patch: LibraryPatch;
  store: ClassStore;
  aliases: AliasMap;
  favoriteKeys: string[];
  hiddenKeys: string[];
  dismissedDupes: string[];
  createdLifts: CreatedLift[];
}

/** A key for a lift that has none, derived from its old identity so the same
 *  lift always gets the same one (FNV-1a over the name-and-kind key). */
export function derivedKey(fallback: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < fallback.length; i++) {
    h ^= fallback.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `ekq${h.toString(36)}`;
}

interface Sighting { name: string; kind: MeasureKind; exerciseKey?: string; equipment?: string }

function sightings(input: CleanupInput): Sighting[] {
  const out: Sighting[] = [];
  for (const w of input.workouts) for (const e of w.data.exercises) out.push(e);
  for (const p of input.programs) for (const wk of p.data.weeks) for (const d of wk.days) for (const e of d.exercises) out.push(e);
  for (const c of input.createdLifts) out.push({ name: c.name, kind: c.kind, exerciseKey: c.key, ...(c.equipment ? { equipment: c.equipment } : {}) });
  return out;
}

/** Lay a patch over the lists, so the next rename is planned from what the
 *  last one left (two renames in one workout must not overwrite each other). */
function applyLocal(workouts: Workout[], programs: Program[], patch: LibraryPatch): { workouts: Workout[]; programs: Program[] } {
  const w = new Map(patch.workouts.map((x) => [x.id, x.exercises] as const));
  const p = new Map(patch.programs.map((x) => [x.id, x.weeks] as const));
  return {
    workouts: workouts.map((x) => (w.has(x.id) ? { ...x, data: { ...x.data, exercises: w.get(x.id)! } } : x)),
    programs: programs.map((x) => (p.has(x.id) ? { ...x, data: { ...x.data, weeks: p.get(x.id)! } } : x)),
  };
}

function mergePatch(into: LibraryPatch, add: LibraryPatch): LibraryPatch {
  const ws = new Map(into.workouts.map((x) => [x.id, x] as const));
  for (const x of add.workouts) ws.set(x.id, x);
  const ps = new Map(into.programs.map((x) => [x.id, x] as const));
  for (const x of add.programs) ps.set(x.id, x);
  return { workouts: [...ws.values()], programs: [...ps.values()] };
}

const swapKey = (list: string[], from: string, to: string): string[] =>
  list.includes(from) ? [...new Set(list.map((k) => (k === from ? to : k)))] : list;

/** Plan the cleanup. Null when there is nothing to do. */
export function planEquipmentCleanup(input: CleanupInput): CleanupPlan | null {
  const all = sightings(input);
  // Every identity that has at least one sighting whose name ends in an
  // equipment word, with the first such name and what it says.
  const dirty = new Map<string, { name: string; equipment: Equipment; exerciseKey?: string }>();
  for (const s of all) {
    const key = libraryKeyOf(s);
    if (dirty.has(key)) continue;
    const split = splitEquipmentSuffix(s.name);
    if (!split.equipment || split.name === s.name) continue;
    dirty.set(key, { name: s.name, equipment: split.equipment, ...(s.exerciseKey ? { exerciseKey: s.exerciseKey } : {}) });
  }
  if (dirty.size === 0) return null;

  let workouts = input.workouts;
  let programs = input.programs;
  let patch: LibraryPatch = { workouts: [], programs: [] };
  let store: ClassStore = { ...input.store };
  let aliases: AliasMap = { ...input.aliases };
  let favoriteKeys = input.favoriteKeys;
  let hiddenKeys = input.hiddenKeys;
  let dismissedDupes = input.dismissedDupes;
  let createdLifts = input.createdLifts;
  const renames: CleanupRename[] = [];

  for (const [key, d] of dirty) {
    if (input.busy({ key, ...(d.exerciseKey ? { exerciseKey: d.exerciseKey } : {}) })) continue;
    // A goal that follows this lift by its name alone would stop seeing it.
    if (input.goals.some((g) => !g.exerciseKey && g.exercise === d.name)) continue;
    const to = splitEquipmentSuffix(d.name).name;
    const stampedKey = d.exerciseKey ?? derivedKey(key);

    // 1. The records and the programs, through the library's own rename.
    const renamed = renameLift(workouts, programs, { key, name: d.name, exerciseKey: stampedKey }, to, () => stampedKey);
    // 2. A program exercise that never said its equipment takes it: that is
    //    what makes the next workout's steppers and plate maths right. Logged
    //    records keep the convention they were logged under (classify.ts,
    //    rule 1), so only the plan is touched.
    const withPlanEquipment: LibraryPatch = {
      workouts: renamed.workouts,
      programs: renamed.programs.map((p) => ({
        ...p,
        weeks: p.weeks.map((wk) => ({
          ...wk,
          days: wk.days.map((day) => ({
            ...day,
            exercises: day.exercises.map((e: Exercise) => (
              e.exerciseKey === stampedKey && e.kind === "weight_reps" && !e.equipment
                ? { ...e, equipment: d.equipment, counted: e.counted ?? defaultCount(d.equipment) }
                : e)),
          })),
        })),
      })),
    };
    ({ workouts, programs } = applyLocal(workouts, programs, withPlanEquipment));
    patch = mergePatch(patch, withPlanEquipment);

    // 3. Seeds (lifts created by hand and not done yet) carry their own name.
    let seedTouched = false;
    createdLifts = createdLifts.map((c) => {
      if (c.key !== key && c.key !== stampedKey) return c;
      const split = splitEquipmentSuffix(c.name);
      if (split.name === c.name) return c;
      seedTouched = true;
      return { ...c, key: stampedKey, name: split.name };
    });
    if (isEmptyPatch(withPlanEquipment) && !seedTouched) continue;

    // 4. The classification follows the key, and takes the equipment only
    //    when nothing anywhere has said one.
    const filed = store[key] ?? store[d.name] ?? store[stampedKey];
    if (filed) {
      if (key !== stampedKey) delete store[key];
      if (d.name !== stampedKey) delete store[d.name];
      store[stampedKey] = filed;
    }
    const said = !!filed?.equipment || all.some((s) => libraryKeyOf(s) === key && !!s.equipment);
    if (!said) {
      store[stampedKey] = { ...(filed ?? EMPTY_CLASS), equipment: d.equipment, counted: filed?.counted ?? defaultCount(d.equipment) };
    }

    // 5. Everything else filed under the old key moves with it.
    aliases = aliasesAfterRename(aliases, key, stampedKey, d.name, to);
    favoriteKeys = swapKey(favoriteKeys, key, stampedKey);
    hiddenKeys = swapKey(hiddenKeys, key, stampedKey);
    if (key !== stampedKey) {
      dismissedDupes = dismissedDupes.map((id) => {
        const [a, b] = id.split("|");
        if (a !== key && b !== key) return id;
        const x = a === key ? stampedKey : a!;
        const y = b === key ? stampedKey : b!;
        return x < y ? `${x}|${y}` : `${y}|${x}`;
      });
    }
    store = { ...store };
    renames.push({ key, stampedKey, from: d.name, to, equipment: d.equipment });
  }

  if (renames.length === 0) return null;
  return { renames, patch, store, aliases, favoriteKeys, hiddenKeys, dismissedDupes, createdLifts };
}

function isEmptyPatch(p: LibraryPatch): boolean {
  return p.workouts.length === 0 && p.programs.length === 0;
}
