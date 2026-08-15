// Apple Health workout dedupe (native seven, item 1). Pure logic, fully
// tested now; the HealthKit bridge feeds it later.
//
// The rule: a JARVIS-native gym session that overlaps a HealthKit workout's
// window means ONE record, and JARVIS wins. The richer record (sets, reps,
// how it felt) beats the watch's duration-and-calories view of the same
// hour. Only workouts with no overlapping native session import, stamped
// with apple_health provenance so the card reads "From Apple Health".

import { madeBy, type Source } from "../shared/provenance";
import type { HealthWorkoutRecord } from "./bridge";

export interface NativeSessionWindow {
  id: string;
  // Epoch ms.
  start: number;
  end: number;
}

export interface SuppressedWorkout {
  workout: HealthWorkoutRecord;
  // The JARVIS session that won.
  keptSessionId: string;
}

export interface HealthDedupeResult {
  imports: HealthWorkoutRecord[];
  suppressed: SuppressedWorkout[];
}

// Strict interval overlap. Touching endpoints (one ends exactly when the
// other starts) is NOT overlap: back-to-back cardio after a logged lift is
// two real workouts, not one.
export function windowsOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

// Split incoming HealthKit workouts into imports and suppressions. Already
// imported uids are the caller's job to exclude (idempotence lives at the
// sync layer, keyed on source.ref).
export function dedupeHealthWorkouts(
  workouts: HealthWorkoutRecord[],
  sessions: NativeSessionWindow[],
): HealthDedupeResult {
  const imports: HealthWorkoutRecord[] = [];
  const suppressed: SuppressedWorkout[] = [];
  for (const w of workouts) {
    const winner = sessions.find((s) => windowsOverlap(w, s));
    if (winner) suppressed.push({ workout: w, keptSessionId: winner.id });
    else imports.push(w);
  }
  return { imports, suppressed };
}

// Provenance stamp for an imported workout: type apple_health, ref the
// HealthKit uid, so re-sync can recognize its own imports and the card can
// render the source line.
export function healthProvenance(w: HealthWorkoutRecord, now: () => number = Date.now): Source {
  return madeBy("apple_health", w.uid, now);
}
