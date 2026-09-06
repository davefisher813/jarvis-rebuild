// UP-ATH-17 (2026-09-06): CIRCUITS. ONE GROUP PRIMITIVE.
//
// pairs.ts says it plainly: "a pair is always exactly two, never a chain".
// That was a real decision when supersets were the feature, and it means
// every coach's sheet with a tri-set or a five-station circuit on it cannot
// be typed into this app at all. A2 and A3 have no way to exist.
//
// So an exercise carries `groupId`, and a group is however many exercises
// share one. A PAIR IS A GROUP OF TWO: nothing migrates, and every function
// here reads a symmetric `pairWith` as a two-member group, so a program
// written last month keeps its A1/A2 labels and its alternating flow with no
// write of any kind. New groups are made with groupId; old ones keep working
// until something edits them.
//
// Order inside a group is the order the members appear in the DAY, not a
// stored sequence: the day's list is the one place order lives (that is what
// drag-to-reorder edits), and a second copy of it would be a second thing
// that can disagree.

import type { Exercise } from "./types";

/** The members of the group `exercise` belongs to, in day order, including
 *  itself. A single exercise (no group, or a stale half-link) answers with
 *  just itself, which is what makes every caller below safe to write as if
 *  a group always exists. */
export function groupOf(exercise: Exercise, exercises: Exercise[]): Exercise[] {
  if (exercise.groupId) {
    const members = exercises.filter((e) => e.groupId === exercise.groupId);
    return members.length > 1 ? members : [exercise];
  }
  if (exercise.pairWith) {
    const partner = exercises.find((e) => e.id === exercise.pairWith);
    // Symmetric or nothing: a stale half-link left by a delete is not a pair.
    if (partner && partner.pairWith === exercise.id) {
      return exercises.filter((e) => e.id === exercise.id || e.id === partner.id);
    }
  }
  return [exercise];
}

/** A stable key for whatever kind of grouping this exercise has, or null.
 *  Legacy pairs key on the two ids sorted, so both halves agree. */
function keyOf(exercise: Exercise, exercises: Exercise[]): string | null {
  if (exercise.groupId) {
    return exercises.some((e) => e.id !== exercise.id && e.groupId === exercise.groupId)
      ? "g:" + exercise.groupId
      : null;
  }
  if (exercise.pairWith) {
    const partner = exercises.find((e) => e.id === exercise.pairWith);
    if (partner && partner.pairWith === exercise.id) return "p:" + [exercise.id, partner.id].sort().join("|");
  }
  return null;
}

/** Labels every grouped exercise "A1"/"A2"/"A3", "B1"/"B2"... The LETTER
 *  comes from the order each group's first member appears in the day; the
 *  NUMBER from the member's own order inside it. An ungrouped exercise, and
 *  one whose only link is stale, gets no label at all -- the same silence
 *  pairLabels kept, for the same reason. */
export function groupLabels(exercises: Exercise[]): Map<string, string> {
  const out = new Map<string, string>();
  const letters = new Map<string, string>();
  let letterCode = 65; // 'A'
  const counts = new Map<string, number>();
  for (const e of exercises) {
    const key = keyOf(e, exercises);
    if (!key) continue;
    if (!letters.has(key)) letters.set(key, String.fromCharCode(letterCode++));
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    out.set(e.id, letters.get(key)! + n);
  }
  return out;
}

/** The filler exercise offered during THIS exercise's rest, when a member of
 *  its group is marked as one. Unchanged in meaning from pairs.ts: a filler
 *  is offered during rest, it never takes a turn in the rotation. */
export function fillerFor(exercise: Exercise, exercises: Exercise[]): Exercise | null {
  const members = groupOf(exercise, exercises);
  if (members.length < 2) return null;
  return members.find((e) => e.id !== exercise.id && e.filler) ?? null;
}

/**
 * Which exercise the session offers next after a set of `exercise`, or null
 * to stay put. The group rotates in day order: the next member is the one
 * with the fewest logged working sets, and ties go to whoever comes first
 * after this exercise, so A1 A2 A3 A1 A2 A3 falls out of the counts rather
 * than out of a stored pointer.
 *
 * `logged` is how many working sets each exercise id has recorded this
 * session, so this stays a pure function of the plan plus a count. A filler
 * never takes a turn; a member with nothing left to do is skipped.
 */
export function nextInGroup(
  exercise: Exercise,
  exercises: Exercise[],
  logged: Record<string, number>,
): string | null {
  const members = groupOf(exercise, exercises).filter((e) => !e.filler);
  if (members.length < 2) return null;
  const mine = logged[exercise.id] ?? 0;
  // Rotate from the position after this one, so a three-member group offers
  // A2 after A1 rather than jumping to whichever member happens to be lowest.
  const i = members.findIndex((e) => e.id === exercise.id);
  if (i < 0) return null;
  const order = [...members.slice(i + 1), ...members.slice(0, i)];
  const behind = order.filter((e) => (logged[e.id] ?? 0) < mine && (logged[e.id] ?? 0) < e.sets.length);
  if (behind.length === 0) return null;
  let best = behind[0]!;
  for (const e of behind) if ((logged[e.id] ?? 0) < (logged[best.id] ?? 0)) best = e;
  return best.id;
}

/** Put `ids` (plus `anchorId`) into one group, dropping whatever grouping any
 *  of them had. Two ids is a pair, three is a tri-set, and the code path is
 *  the same one. A legacy `pairWith` on anyone joining is cleared on both
 *  sides, so a program never holds both kinds of link at once. */
export function groupExercises(exercises: Exercise[], anchorId: string, ids: string[], newId: () => string): Exercise[] {
  const members = new Set([anchorId, ...ids]);
  const gid = newId();
  // Everyone the joiners were paired with, so a half-link is never left behind.
  const orphaned = new Set<string>();
  for (const e of exercises) if (members.has(e.id) && e.pairWith) orphaned.add(e.pairWith);
  const moved = exercises.map((e) => {
    if (members.has(e.id)) { const { pairWith: _drop, ...rest } = e; return { ...rest, groupId: gid }; }
    if (orphaned.has(e.id) && e.pairWith && members.has(e.pairWith)) { const { pairWith: _drop, ...rest } = e; return rest; }
    return e;
  });
  // A group the joiners left behind with one member is no group any more, so
  // its last link is cleared too rather than lingering as a field that means
  // nothing and would silently re-form if a third exercise ever took that id.
  const counts = new Map<string, number>();
  for (const e of moved) if (e.groupId) counts.set(e.groupId, (counts.get(e.groupId) ?? 0) + 1);
  return moved.map((e) => {
    if (!e.groupId || (counts.get(e.groupId) ?? 0) > 1) return e;
    const { groupId: _g, ...bare } = e;
    return bare;
  });
}

/** Take one exercise out of its group. The rest of the group stays together,
 *  and a group left with a single member is no group at all, so its last
 *  link is cleared too rather than leaving a label on one lonely row. */
export function ungroupExercise(exercises: Exercise[], id: string): Exercise[] {
  const target = exercises.find((e) => e.id === id);
  if (!target) return exercises;
  const members = groupOf(target, exercises);
  const rest = members.filter((e) => e.id !== id);
  const clear = new Set<string>([id, ...(rest.length < 2 ? rest.map((e) => e.id) : [])]);
  return exercises.map((e) => {
    if (!clear.has(e.id)) return e;
    const { pairWith: _p, groupId: _g, ...bare } = e;
    return bare;
  });
}
