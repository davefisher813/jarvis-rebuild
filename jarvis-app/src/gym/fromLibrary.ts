import type { Exercise } from "./types";
import { defaultUnit } from "./types";
import type { ClassStore } from "./classify";
import { newExerciseKey, type LibraryEntry } from "./library";
import { uniformStrip } from "./strip";

/**
 * ONE SPELLING OF "AN EXERCISE PICKED FROM THE LIBRARY" (2026-10-10, the
 * workout-first flow). The day builder's Add from Your Exercises had this
 * inline; the empty workout's Suggestions and its Add Exercise pick need the
 * same answer, so it lives here and both read it.
 *
 * Each pick lands carrying everything the library knows about it: its measure,
 * its unit, its last strip and, above all, its exerciseKey, so an exercise
 * added this way shares the history it already had rather than starting a
 * fork. The CLASSIFICATION comes with it too (the declared measurement, the
 * equipment and the reading), for this NEW sighting only; nothing already
 * logged is touched (classify.ts's first rule).
 */
export function exerciseFromEntry(e: LibraryEntry, classStore: ClassStore, newId: (prefix: string) => string): Exercise {
  const c = classStore[e.key] ?? classStore[e.exerciseKey ?? ""] ?? null;
  const kind = c?.measure ?? e.kind;
  // 2026-10-05: what the create sheet planned (rest, ramp, filler, note,
  // clock, strip) lands here too, as ExerciseSheet's pick does. Gated on the
  // measure still being the one it was planned under, like the unit: a clock
  // or a strip means nothing on another kind. A seed has no lastSets, so its
  // strip is the plan's.
  const p = kind === e.kind ? e.plan : undefined;
  const planSets = p?.sets?.length && e.lastSets.length === 0 ? p.sets : null;
  return {
    id: newId("e"),
    name: e.name,
    kind,
    // A declared measure the entry was not logged under brings its own default
    // unit: the old unit could be yards on a kind that measures seconds, and a
    // mismatched unit is a nonsense PR.
    ...(kind === e.kind ? (e.unit ? { unit: e.unit } : {}) : (defaultUnit(kind) ? { unit: defaultUnit(kind)! } : {})),
    ...(kind === e.kind && (e.timeUnit ?? p?.timeUnit) ? { timeUnit: (e.timeUnit ?? p?.timeUnit)! } : {}),
    ...(c?.equipment ? { equipment: c.equipment } : e.equipment ? { equipment: e.equipment as Exercise["equipment"] } : {}),
    ...(c?.counted ? { counted: c.counted } : e.counted ? { counted: e.counted } : {}),
    exerciseKey: e.exerciseKey ?? newExerciseKey(),
    ...(p?.restSec ? { restSec: p.restSec } : {}),
    ...(p?.ramp ? { ramp: true } : {}),
    ...(p?.filler ? { filler: true } : {}),
    ...(p?.note ? { note: p.note } : {}),
    ...(p?.cond ? { cond: p.cond } : {}),
    sets: kind === e.kind && e.lastSets.length > 0
      ? e.lastSets.map((s, i) => ({ ...s, id: `${newId("s")}${i}` }))
      : planSets
        ? planSets.map((s, i) => ({ ...s, id: `${newId("s")}${i}` }))
        : uniformStrip(3, { r: 8 }),
  };
}
