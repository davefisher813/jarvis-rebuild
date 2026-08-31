import type { Exercise } from "./types";

// PAIRS & FILLERS (catalog §4.2). An exercise carries `pairWith`, the id of
// another exercise in the SAME day it alternates with; pairing is symmetric
// (both sides carry the other's id). A pair marked `filler` on one side is
// offered during the rest of its parent lift instead of standing around.

/** Labels each paired exercise "A1"/"A2", "B1"/"B2"... in the order the
 *  first member of each pair appears in the day. An exercise with no
 *  pairing, or whose partner does not point back (a stale half-link left by
 *  a delete), gets no label at all. */
export function pairLabels(exercises: Exercise[]): Map<string, string> {
  const out = new Map<string, string>();
  const byId = new Map(exercises.map((e) => [e.id, e]));
  let letterCode = 65; // 'A'
  const seen = new Set<string>();
  for (const e of exercises) {
    if (seen.has(e.id) || !e.pairWith) continue;
    const partner = byId.get(e.pairWith);
    if (!partner || partner.pairWith !== e.id) continue; // must be symmetric
    const letter = String.fromCharCode(letterCode++);
    out.set(e.id, `${letter}1`);
    out.set(partner.id, `${letter}2`);
    seen.add(e.id);
    seen.add(partner.id);
  }
  return out;
}

/** The filler exercise offered during THIS exercise's rest, if its paired
 *  partner is marked as one. Null when unpaired, the link is stale, or the
 *  partner is not actually a filler (an ordinary A1/A2 pair alternates --
 *  it does not offer either half during the other's rest). */
export function fillerFor(exercise: Exercise, exercises: Exercise[]): Exercise | null {
  if (!exercise.pairWith) return null;
  const partner = exercises.find((e) => e.id === exercise.pairWith);
  return partner && partner.pairWith === exercise.id && partner.filler ? partner : null;
}

/** Pair two exercises within a day, replacing whichever pairing either side
 *  already had (a pair is always exactly two). Returns the whole exercise
 *  list with both links updated. */
export function pairExercises(exercises: Exercise[], aId: string, bId: string): Exercise[] {
  return exercises.map((e) => {
    if (e.id === aId) return { ...e, pairWith: bId };
    if (e.id === bId) return { ...e, pairWith: aId };
    // Anyone who was paired with either side loses that pairing -- a pair
    // is always exactly two, never a chain.
    if (e.pairWith === aId || e.pairWith === bId) { const { pairWith: _drop, ...rest } = e; return rest; }
    return e;
  });
}

/** Undo a pairing on both sides. */
export function unpairExercise(exercises: Exercise[], id: string): Exercise[] {
  const target = exercises.find((e) => e.id === id);
  const partnerId = target?.pairWith;
  return exercises.map((e) => {
    if (e.id === id || e.id === partnerId) { const { pairWith: _drop, ...rest } = e; return rest; }
    return e;
  });
}

/**
 * SUPERSET FLOW (D8-C). Which exercise the session should offer next after a
 * set of `exercise`, or null to stay put. A true A1/A2 pair alternates: if
 * the partner is behind on sets, it is next. A filler is NOT this -- it is
 * offered during rest by fillerFor and never takes the pair's turn.
 *
 * `logged` is how many sets each exercise id has recorded this session, so
 * this stays a pure function of the plan plus a count.
 */
export function nextInPair(
  exercise: Exercise,
  exercises: Exercise[],
  logged: Record<string, number>,
): string | null {
  if (!exercise.pairWith) return null;
  const partner = exercises.find((e) => e.id === exercise.pairWith);
  if (!partner || partner.pairWith !== exercise.id) return null; // stale half-link
  if (partner.filler) return null;                                // rest's job, not the pair's
  const mine = logged[exercise.id] ?? 0;
  const theirs = logged[partner.id] ?? 0;
  if (theirs >= mine) return null;                                // they are caught up
  if (theirs >= partner.sets.length) return null;                 // nothing left to offer
  return partner.id;
}
