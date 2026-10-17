import { MUSCLE_GROUPS, type MuscleGroup } from "./muscles";

// THE PRELOADED EXERCISE LIBRARY (S9, Dave 2026-10-16). A new library should
// not open empty: the picker offers a catalog of about 110 common exercises
// under the muscle they train, beside whatever the athlete has already made,
// and picking one makes it the athlete's own exercise with that primary and
// secondary muscle already set.
//
// THIS FILE IS THE PLUMBING, NOT THE LIST. The names come from the approved
// catalog, which has not been handed over yet; nothing here invents one. The
// array below is empty on purpose and fills in from that catalog, name for
// name, when it arrives. Everything that reads it (gym/libraryView.pickerRows,
// the picker's merge and the law in laws/exerciseNames.test.ts) already works
// against the shape, so landing the list is a data change and nothing else.
//
// THE RULES THE LIST MUST KEEP, held by laws/exerciseNames.test.ts:
//   - a name never carries an equipment word (Barbell, Dumbbell, Cable,
//     Machine, Kettlebell, Free Weight, Band, Smith): equipment is a
//     classification the athlete sets, not part of the exercise's name, so
//     "Bench Press" is one exercise however it is loaded;
//   - a starter entry carries no equipment tag, for the same reason;
//   - every primary and secondary is one of the twelve muscle groups the app
//     counts sets by (gym/muscles.ts), the same twelve the muscle picker
//     offers: Chest, Back, Traps, Shoulders, Biceps, Triceps, Forearms,
//     Quads, Hamstrings, Glutes, Calves, Core.

export interface StarterExercise {
  name: string;
  primary: MuscleGroup;
  secondary: MuscleGroup | null;
}

/** The twelve groups a starter entry may name, in the order the picker's
 *  sections draw them. The app's own list (gym/muscles.ts), re-exported so a
 *  reader of this file sees the whole contract in one place. */
export const STARTER_MUSCLE_GROUPS: readonly MuscleGroup[] = MUSCLE_GROUPS;

/** The catalog. EMPTY until the approved list of about 110 names arrives;
 *  do not fill it from memory. */
export const STARTER_EXERCISES: readonly StarterExercise[] = [];

/** One spelling of a name for matching: a starter entry is not offered when
 *  the athlete already has an exercise of that name, however it was typed.
 *  Case, surrounding space, runs of space and punctuation all fold. */
export function normalizeExerciseName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
