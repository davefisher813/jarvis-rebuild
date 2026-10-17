import { MUSCLE_GROUPS, type MuscleGroup } from "./muscles";

// THE PRELOADED EXERCISE LIBRARY (S9, Dave 2026-10-16). A new library should
// not open empty: the picker offers Dave's catalog of 111 exercises under the
// muscle they train, beside whatever the athlete has already made, and picking
// one makes it the athlete's own exercise with that primary and those
// secondary muscles already set.
//
// THE LIST IS DAVE'S, VERBATIM. Its source is the approved catalog "JARVIS
// Preloaded Exercise Library, Starter List" (Dave, 2026-10-16; docs under
// docs/jarvis-unified when it lands there): 111 names under the app's twelve
// primary groups, each with zero to three secondary groups, loaded name for
// name, group for group. Nothing is added, renamed, reordered or dropped here;
// a change to the list is a change to that file first, in Dave's words.
//
// THE RULES THE LIST KEEPS, held by laws/exerciseNames.test.ts and
// gym/starterLibrary.test.ts:
//   - a name never carries an equipment word (Barbell, Dumbbell, Cable,
//     Machine, Kettlebell, Free Weight, Band, Smith): equipment is a
//     classification the athlete sets, not part of the exercise's name, so
//     "Bench Press" is one exercise however it is loaded;
//   - a starter entry carries no equipment tag, for the same reason;
//   - every primary and secondary is one of the twelve muscle groups the app
//     counts sets by (gym/muscles.ts), the same twelve the muscle picker
//     offers: Chest, Back, Traps, Shoulders, Biceps, Triceps, Forearms,
//     Quads, Hamstrings, Glutes, Calves, Core; a secondary never repeats the
//     primary.

export interface StarterExercise {
  name: string;
  primary: MuscleGroup;
  /** Zero to three groups, in the catalog's order; empty when the catalog
   *  names none. */
  secondary: readonly MuscleGroup[];
}

/** The twelve groups a starter entry may name, in the order the picker's
 *  sections draw them. The app's own list (gym/muscles.ts), re-exported so a
 *  reader of this file sees the whole contract in one place. */
export const STARTER_MUSCLE_GROUPS: readonly MuscleGroup[] = MUSCLE_GROUPS;

/** The catalog: 111 exercises, in the catalog's own order (its twelve groups
 *  in the app's order, the names as Dave listed them under each). */
export const STARTER_EXERCISES: readonly StarterExercise[] = [

  // Chest
  { name: "Bench Press", primary: "chest", secondary: ["triceps", "shoulders"] },
  { name: "Incline Bench Press", primary: "chest", secondary: ["shoulders", "triceps"] },
  { name: "Decline Bench Press", primary: "chest", secondary: ["triceps"] },
  { name: "Floor Press", primary: "chest", secondary: ["triceps", "shoulders"] },
  { name: "Chest Press", primary: "chest", secondary: ["triceps", "shoulders"] },
  { name: "Fly", primary: "chest", secondary: ["shoulders"] },
  { name: "Push-Up", primary: "chest", secondary: ["triceps", "shoulders"] },
  { name: "Weighted Push-Up", primary: "chest", secondary: ["triceps", "shoulders"] },
  { name: "Dip", primary: "chest", secondary: ["triceps", "shoulders"] },

  // Back
  { name: "Deadlift", primary: "back", secondary: ["glutes", "hamstrings", "forearms"] },
  { name: "Bent Over Row", primary: "back", secondary: ["biceps", "shoulders"] },
  { name: "Pendlay Row", primary: "back", secondary: ["biceps", "shoulders"] },
  { name: "One Arm Row", primary: "back", secondary: ["biceps"] },
  { name: "Chest Supported Row", primary: "back", secondary: ["biceps"] },
  { name: "T-Bar Row", primary: "back", secondary: ["biceps"] },
  { name: "Seated Row", primary: "back", secondary: ["biceps"] },
  { name: "Pull-Up", primary: "back", secondary: ["biceps", "forearms"] },
  { name: "Chin-Up", primary: "back", secondary: ["biceps"] },
  { name: "Weighted Pull-Up", primary: "back", secondary: ["biceps", "forearms"] },
  { name: "Lat Pulldown", primary: "back", secondary: ["biceps"] },
  { name: "Straight Arm Pulldown", primary: "back", secondary: ["core"] },
  { name: "Pullover", primary: "back", secondary: ["chest", "triceps"] },
  { name: "Good Morning", primary: "back", secondary: ["hamstrings", "glutes"] },
  { name: "Back Extension", primary: "back", secondary: ["glutes", "hamstrings"] },
  { name: "Rowing", primary: "back", secondary: ["quads", "biceps"] },

  // Traps
  { name: "Shrug", primary: "traps", secondary: ["forearms", "shoulders"] },

  // Shoulders
  { name: "Overhead Press", primary: "shoulders", secondary: ["triceps"] },
  { name: "Seated Shoulder Press", primary: "shoulders", secondary: ["triceps"] },
  { name: "Standing Shoulder Press", primary: "shoulders", secondary: ["triceps", "core"] },
  { name: "Arnold Press", primary: "shoulders", secondary: ["triceps"] },
  { name: "Landmine Press", primary: "shoulders", secondary: ["chest", "triceps"] },
  { name: "Lateral Raise", primary: "shoulders", secondary: [] },
  { name: "Front Raise", primary: "shoulders", secondary: [] },
  { name: "Rear Delt Fly", primary: "shoulders", secondary: ["back"] },
  { name: "Face Pull", primary: "shoulders", secondary: ["back", "biceps"] },
  { name: "Upright Row", primary: "shoulders", secondary: ["biceps"] },
  { name: "Battle Ropes", primary: "shoulders", secondary: ["core"] },

  // Biceps
  { name: "Curl", primary: "biceps", secondary: ["forearms"] },
  { name: "Incline Curl", primary: "biceps", secondary: [] },
  { name: "Hammer Curl", primary: "biceps", secondary: ["forearms"] },
  { name: "Preacher Curl", primary: "biceps", secondary: [] },
  { name: "Concentration Curl", primary: "biceps", secondary: [] },
  { name: "Spider Curl", primary: "biceps", secondary: [] },
  { name: "Zottman Curl", primary: "biceps", secondary: ["forearms"] },

  // Triceps
  { name: "Close Grip Bench Press", primary: "triceps", secondary: ["chest", "shoulders"] },
  { name: "Overhead Triceps Extension", primary: "triceps", secondary: [] },
  { name: "Triceps Pushdown", primary: "triceps", secondary: [] },
  { name: "Skull Crusher", primary: "triceps", secondary: [] },
  { name: "Triceps Kickback", primary: "triceps", secondary: [] },
  { name: "Diamond Push-Up", primary: "triceps", secondary: ["chest"] },
  { name: "Bench Dip", primary: "triceps", secondary: ["chest", "shoulders"] },

  // Forearms
  { name: "Wrist Curl", primary: "forearms", secondary: [] },
  { name: "Reverse Wrist Curl", primary: "forearms", secondary: [] },
  { name: "Reverse Curl", primary: "forearms", secondary: ["biceps"] },
  { name: "Farmers Carry", primary: "forearms", secondary: ["shoulders", "core"] },
  { name: "Dead Hang", primary: "forearms", secondary: ["back"] },

  // Quads
  { name: "Back Squat", primary: "quads", secondary: ["glutes", "hamstrings"] },
  { name: "Front Squat", primary: "quads", secondary: ["glutes", "core"] },
  { name: "Goblet Squat", primary: "quads", secondary: ["glutes"] },
  { name: "Box Squat", primary: "quads", secondary: ["glutes", "hamstrings"] },
  { name: "Leg Press", primary: "quads", secondary: ["glutes", "hamstrings"] },
  { name: "Hack Squat", primary: "quads", secondary: ["glutes"] },
  { name: "Split Squat", primary: "quads", secondary: ["glutes"] },
  { name: "Bulgarian Split Squat", primary: "quads", secondary: ["glutes", "hamstrings"] },
  { name: "Walking Lunge", primary: "quads", secondary: ["glutes"] },
  { name: "Reverse Lunge", primary: "quads", secondary: ["glutes"] },
  { name: "Stationary Lunge", primary: "quads", secondary: ["glutes"] },
  { name: "Step-Up", primary: "quads", secondary: ["glutes"] },
  { name: "Sumo Squat", primary: "quads", secondary: ["glutes"] },
  { name: "Leg Extension", primary: "quads", secondary: [] },
  { name: "Adductor", primary: "quads", secondary: [] },
  { name: "Sled Push", primary: "quads", secondary: ["calves", "core"] },
  { name: "Box Jump", primary: "quads", secondary: ["calves", "glutes"] },
  { name: "Bike Sprint", primary: "quads", secondary: ["calves"] },

  // Hamstrings
  { name: "Romanian Deadlift", primary: "hamstrings", secondary: ["glutes", "back"] },
  { name: "Stiff Leg Deadlift", primary: "hamstrings", secondary: ["glutes", "back"] },
  { name: "Single Leg Deadlift", primary: "hamstrings", secondary: ["glutes", "core"] },
  { name: "Seated Leg Curl", primary: "hamstrings", secondary: [] },
  { name: "Lying Leg Curl", primary: "hamstrings", secondary: [] },
  { name: "Nordic Curl", primary: "hamstrings", secondary: [] },
  { name: "Glute Ham Raise", primary: "hamstrings", secondary: ["glutes", "calves"] },
  { name: "Sled Pull", primary: "hamstrings", secondary: ["back", "glutes"] },
  { name: "Sprint", primary: "hamstrings", secondary: ["calves", "glutes"] },

  // Glutes
  { name: "Hip Thrust", primary: "glutes", secondary: ["hamstrings"] },
  { name: "Glute Bridge", primary: "glutes", secondary: ["hamstrings"] },
  { name: "Abductor", primary: "glutes", secondary: [] },
  { name: "Curtsy Lunge", primary: "glutes", secondary: ["quads"] },
  { name: "Swing", primary: "glutes", secondary: ["hamstrings", "back"] },

  // Calves
  { name: "Standing Calf Raise", primary: "calves", secondary: [] },
  { name: "Seated Calf Raise", primary: "calves", secondary: [] },
  { name: "Leg Press Calf Raise", primary: "calves", secondary: [] },
  { name: "Jump Rope", primary: "calves", secondary: [] },
  { name: "Agility Ladder", primary: "calves", secondary: ["quads"] },

  // Core
  { name: "Plank", primary: "core", secondary: [] },
  { name: "Side Plank", primary: "core", secondary: [] },
  { name: "Dead Bug", primary: "core", secondary: [] },
  { name: "Bird Dog", primary: "core", secondary: ["glutes"] },
  { name: "Crunch", primary: "core", secondary: [] },
  { name: "Sit-Up", primary: "core", secondary: [] },
  { name: "Decline Sit-Up", primary: "core", secondary: [] },
  { name: "Hanging Leg Raise", primary: "core", secondary: ["forearms"] },
  { name: "Hanging Knee Raise", primary: "core", secondary: ["forearms"] },
  { name: "Russian Twist", primary: "core", secondary: [] },
  { name: "Woodchopper", primary: "core", secondary: ["shoulders"] },
  { name: "Pallof Press", primary: "core", secondary: [] },
  { name: "Ab Wheel Rollout", primary: "core", secondary: ["shoulders"] },
  { name: "Mountain Climber", primary: "core", secondary: ["shoulders"] },
  { name: "Hollow Hold", primary: "core", secondary: [] },
  { name: "Turkish Get-Up", primary: "core", secondary: ["shoulders", "glutes"] },
  { name: "Medicine Ball Slam", primary: "core", secondary: ["back", "shoulders"] },
  { name: "Medicine Ball Rotational Throw", primary: "core", secondary: ["shoulders"] },
];

/** One spelling of a name for matching: a starter entry is not offered when
 *  the athlete already has an exercise of that name, however it was typed.
 *  Case, surrounding space, runs of space and punctuation all fold. */
export function normalizeExerciseName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
