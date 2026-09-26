// MERGING TWO EXERCISES, THE WHOLE WAY THROUGH.
//
// (Dave, 2026-09-14: "The current merge action reportedly neither clears the
// suggestion nor confirms completion. Inspect both persistence and interface
// updates.")
//
// It did write. What it did not do was finish: the review card rendered
// inline at the bottom of a long scroller, Merge ran through a shared
// applyPatch helper that toasted and moved on, the duplicate suggestion was
// recomputed from names that had just been rewritten (so it usually vanished,
// and sometimes did not), a second tap could run the whole thing again on
// stale rows, and a failure halfway through left the library part-merged with
// a toast that said nothing about it. Every one of those is the same defect
// in a different costume: THE WRITE AND THE SCREEN WERE NOT THE SAME EVENT.
//
// So the merge is a state machine now, and this file owns it:
//
//   idle -> reviewing -> pending -> merged
//                          \-> failed -> (retry) -> pending ...
//
// Four rules the shape enforces:
//
//   1. NOTHING SAYS SUCCESS BEFORE PERSISTENCE. `merged` is only reachable
//      from a write that returned. A failed write lands in `failed`, which
//      KEEPS the review item and offers Retry.
//   2. PENDING IS A REAL STATE. While it is on, the button is disabled and
//      the plan is frozen, so a double tap is one merge.
//   3. RETRY IS SAFE BECAUSE THE PATCH IS IDEMPOTENT. Rewriting a sighting to
//      the survivor's name and key a second time produces the identical
//      record. A partial write plus a retry converges on the same result as
//      one clean run, which is the honest version of "transactional" on a
//      store with no transactions: no rollback, but no half-state that a
//      retry cannot close. `applied` is carried across so a retry can say
//      what is left rather than starting its count over.
//   4. UNDO IS OFFERED ONLY WHEN IT IS STILL SAFE. The inverse patch is a
//      pre-image captured before the write. If anything has touched those
//      records since -- another merge, an edited session, a renamed lift --
//      applying it would silently throw away the newer work. The signature
//      below is how that is detected, and merge history keeps the RECORD of
//      the merge even once the undo is withdrawn.

import type { Program, Workout } from "./types";
import type { Goal } from "../life/types";
import type { LiftMeasure } from "./goalMeasures";
import { libraryKeyOf, patchSummary, type LibraryPatch, type LibraryRow } from "./libraryEdit";
import { sameLiftAnyKind } from "./identity";
import type { Classification } from "./classify";

// --- WHAT A MERGE WILL DO --------------------------------------------------

/** One half of the pair, with everything the review has to show about it.
 *  The classification travels with the row because step 2 asks for "both
 *  exercises with complete names, equipment, classifications, and actual
 *  record counts" -- all four in one object, so the sheet cannot render a
 *  name from one side and an equipment from the other. */
export interface MergeSide {
  row: LibraryRow;
  classification: Classification;
}

export interface MergePlan {
  keep: MergeSide;
  fold: MergeSide;
  patch: LibraryPatch;
  /** The pre-image of everything the patch touches, for Undo. */
  inverse: LibraryPatch;
  /** Distinct finished sessions rewritten, and program days rewritten. */
  sessions: number;
  programDays: number;
  /** Individual logged sets moving across. Nothing is deduplicated and
   *  nothing is dropped: two identical 225 x 5 sets on the same day are two
   *  sets that happened, and a merge is not a reason to decide otherwise
   *  ("Never discard sets merely because their weights and reps match"). */
  sets: number;
  /** Goals whose lift is the folded one; they follow it across, so a goal
   *  set on "Bench" is still a goal after Bench folds into Bench Press. */
  goals: Goal[];
  /** The survivor's key after the merge -- freshly minted when it had none,
   *  because a merged pair where only one side carries a key still reads as
   *  two lifts. */
  survivorKey: string;
  /** What the records looked like the moment this plan was built. */
  signature: string;
}

/** Every logged set on one lift, warm-ups and all: the review is about what
 *  MOVES, and a warm-up set moves too. */
function setsOf(workouts: Workout[], keys: Set<string>): number {
  let n = 0;
  for (const w of workouts) {
    for (const e of w.data.exercises) if (keys.has(libraryKeyOf(e))) n += e.sets.length;
  }
  return n;
}

/**
 * A FINGERPRINT OF EVERYTHING A PATCH TOUCHES.
 *
 * Cheap, stable, and enough to answer the only question Undo has to ask: are
 * these records still exactly as my merge left them? Any later edit, by any
 * door in the app, changes the exercise list of a touched workout or the
 * weeks of a touched program, and the signature moves with it.
 */
export function patchSignature(patch: LibraryPatch, workouts: Workout[], programs: Program[]): string {
  const byW = new Map(workouts.map((w) => [w.id, w] as const));
  const byP = new Map(programs.map((p) => [p.id, p] as const));
  const parts: string[] = [];
  for (const w of [...patch.workouts].sort((a, b) => a.id.localeCompare(b.id))) {
    parts.push("w:" + w.id + ":" + JSON.stringify(byW.get(w.id)?.data.exercises ?? null));
  }
  for (const p of [...patch.programs].sort((a, b) => a.id.localeCompare(b.id))) {
    parts.push("p:" + p.id + ":" + JSON.stringify(byP.get(p.id)?.data.weeks ?? null));
  }
  return parts.join("|");
}

/** Goals that belong to the lift being folded away. Matched by identity, not
 *  by name string, so a goal set before a rename still comes with it. */
export function goalsOnLift(goals: Goal[], row: Pick<LibraryRow, "name" | "exerciseKey">): Goal[] {
  return goals.filter((g) => {
    if (g.data.measure?.kind !== "lift") return false;
    const m = g.data.measure as LiftMeasure;
    return sameLiftAnyKind({ name: m.exercise, exerciseKey: m.exerciseKey }, row);
  });
}

/** The goal, repointed at the survivor. The TARGET is untouched: a goal is a
 *  number the athlete chose, and a merge is not permission to move it. */
export function repointGoal(g: Goal, keep: Pick<LibraryRow, "name">, survivorKey: string): Goal["data"] {
  const m = g.data.measure as LiftMeasure;
  return {
    ...g.data,
    measure: { ...m, exercise: keep.name, exerciseKey: survivorKey },
  };
}

/** Build the whole plan, including its own pre-image and fingerprint. The
 *  patch builder is injected so this file stays free of the mint-a-key
 *  concern that belongs to the caller. */
export function planMerge(args: {
  keep: MergeSide;
  fold: MergeSide;
  patch: LibraryPatch;
  inverse: LibraryPatch;
  survivorKey: string;
  workouts: Workout[];
  programs: Program[];
  goals: Goal[];
}): MergePlan {
  // WHAT MOVES IS THE FOLDED SIDE, NOT THE PATCH'S SIZE.
  //
  // The patch touches every sighting of BOTH exercises, because the survivor's
  // own rows are stamped with its key in the same sweep. Counting the patch
  // would tell the athlete that eleven sessions are moving when one is, which
  // is the kind of number that makes a reviewed merge less trustworthy than no
  // review at all. `totalWrites` is the patch's size and is used where the
  // patch's size is the honest answer: the Retry count.
  const moving = new Set([args.fold.row.key]);
  const { programDays } = patchSummary(args.patch, args.programs, moving);
  const sessions = args.fold.row.sessions;
  return {
    keep: args.keep,
    fold: args.fold,
    patch: args.patch,
    inverse: args.inverse,
    sessions,
    programDays,
    sets: setsOf(args.workouts, new Set([args.fold.row.key])),
    goals: goalsOnLift(args.goals, args.fold.row),
    survivorKey: args.survivorKey,
    signature: patchSignature(args.patch, args.workouts, args.programs),
  };
}

/** THE SUMMARY, IN ONE LINE OF PLAIN COUNTS (step 5: "a concise summary of
 *  what will move"). Only the parts that exist are spoken -- a lift with no
 *  sessions does not get "0 sessions", which reads as a warning about
 *  nothing. */
export function movesLine(plan: MergePlan): string {
  const bits: string[] = [];
  if (plan.sessions) bits.push(`${plan.sessions} ${plan.sessions === 1 ? "session" : "sessions"}`);
  if (plan.sets) bits.push(`${plan.sets} ${plan.sets === 1 ? "set" : "sets"}`);
  if (plan.programDays) bits.push(`${plan.programDays} program ${plan.programDays === 1 ? "day" : "days"}`);
  if (plan.goals.length) bits.push(`${plan.goals.length} ${plan.goals.length === 1 ? "goal" : "goals"}`);
  if (!bits.length) return "Nothing logged under it yet, so only the name moves";
  // Commas, never a middle dot: a separator is the stylesheet's to draw, and
  // a string that carries its own is a facts line baked into a sentence.
  return bits.join(", ");
}

// --- THE STATE MACHINE -----------------------------------------------------

export type MergeStage = "reviewing" | "pending" | "failed";

export interface MergeState {
  plan: MergePlan;
  stage: MergeStage;
  /** Which conflicting fields the athlete chose to take from the folded
   *  exercise rather than the survivor. */
  take: string[];
  /** Writes that landed before a failure, so a retry can say what is left
   *  instead of starting its count over. */
  applied: number;
}

export function totalWrites(plan: MergePlan): number {
  return plan.patch.workouts.length + plan.patch.programs.length;
}

/** What Retry has left to do. A partial write is not a failed one, and saying
 *  "3 of 11 saved" beats a bare "Merge failed" the athlete cannot act on.
 *  The failure card's ONE line (§AK, 2026-09-26): it used to be three, and
 *  said Retry in all of them. */
export function remainingLine(state: MergeState): string | null {
  if (state.stage !== "failed") return null;
  const total = totalWrites(state.plan);
  if (state.applied <= 0) return "Nothing was changed, both exercises are exactly as they were";
  if (state.applied >= total) return "Everything saved, but the last step did not confirm";
  return `${state.applied} of ${total} saved and nothing was deleted, Retry finishes the rest`;
}

/** WHAT THE RECORDS SHOULD LOOK LIKE ONCE THE PATCH HAS LANDED.
 *
 *  The patch IS the post-merge image of every record it touches, so this is
 *  the same string patchSignature will produce from the store afterwards --
 *  as long as nothing else has edited them since. Written in the same format,
 *  deliberately, because two formats that have to agree eventually will not. */
export function expectedSignature(patch: LibraryPatch): string {
  const parts: string[] = [];
  for (const w of [...patch.workouts].sort((a, b) => a.id.localeCompare(b.id))) {
    parts.push("w:" + w.id + ":" + JSON.stringify(w.exercises));
  }
  for (const p of [...patch.programs].sort((a, b) => a.id.localeCompare(b.id))) {
    parts.push("p:" + p.id + ":" + JSON.stringify(p.weeks));
  }
  return parts.join("|");
}

/** Can this merge still be safely reversed? Only when every record it touched
 *  is still exactly as the merge left it.
 *
 *  BOTH ARGUMENTS MUST BE READ FROM DIFFERENT PLACES for this to mean
 *  anything: `afterSignature` from the records as they stand RIGHT NOW, and
 *  `expected` from the patch. Handing it the same reading twice makes it
 *  return true always, which is a check that has stopped checking. */
export function undoSafe(plan: MergePlan, afterSignature: string, expected: string): boolean {
  return afterSignature === expected && expected.length > 0 && plan.inverse.workouts.length + plan.inverse.programs.length > 0;
}
