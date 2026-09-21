import type { Exercise } from "./types";

/** THE DAY, WITH TODAY'S OWN PAIRS LAID OVER IT.
 *
 * Every group question the session screen asks -- what is this paired with,
 * what is the round rest, what comes next in the round, is there a filler --
 * is asked of the day's exercises through groups.ts. So a pair made for today
 * only needs to change ONE thing: the list those questions are asked of.
 *
 * No reader changes, no second code path, and a session with no pairs of its
 * own returns the day itself, object for object, because this sits on the
 * render path of a screen that re-renders on every keystroke of a weight.
 */
export function withLiveGroups(day: Exercise[], groups?: Record<string, string>): Exercise[] {
  if (!groups || Object.keys(groups).length === 0) return day;
  return day.map((e) => {
    const g = groups[e.id];
    if (g === undefined) return e;
    // THE EMPTY STRING IS A STATEMENT, NOT AN ABSENCE (2026-09-21). A pair
    // that came from the PROGRAM has no entry here to delete, so breaking it
    // for today has to be SAID rather than un-said: "" means "explicitly not
    // grouped today", and it is the only thing that lets today-only pairing
    // and today-only un-pairing be the same shape.
    return g === "" ? { ...e, groupId: undefined } : { ...e, groupId: g };
  });
}

/** The session-only pairing for `ids`, merged onto whatever is already there.
 *  Returns a NEW map; never mutates the session's own. */
export function groupForToday(
  current: Record<string, string> | undefined,
  ids: string[],
  newId: () => string,
): Record<string, string> {
  const next = { ...(current ?? {}) };
  if (ids.length < 2) return next;
  // Reuse a group any of these is already in today, so pairing a third lift
  // into an existing pair grows it rather than splitting it in two.
  const existing = ids.map((id) => next[id]).find(Boolean);
  const gid = existing ?? newId();
  for (const id of ids) next[id] = gid;
  return next;
}

/** Undo a pairing for today: every lift that shares this one's group is
 *  released. The exact inverse of groupForToday for a pair made today, and
 *  for a pair that came from the program it says so for today only, leaving
 *  the program exactly where it was.
 *
 *  `day` is what makes the second case possible: a program pair has nothing
 *  in this map to remove, so its members have to be read off the day and
 *  marked. Called without it, only today's own pairs can be broken. */
export function ungroupToday(
  current: Record<string, string> | undefined,
  id: string,
  day?: Exercise[],
): Record<string, string> {
  const next = { ...(current ?? {}) };
  const gid = next[id];
  if (gid) {
    for (const k of Object.keys(next)) if (next[k] === gid) delete next[k];
    return next;
  }
  const fromProgram = day?.find((e) => e.id === id)?.groupId;
  if (!day || !fromProgram) return next;
  for (const e of day) if (e.groupId === fromProgram) next[e.id] = "";
  return next;
}

/** Is this lift in a group that exists only for this session? The two cases
 *  read differently to the athlete -- breaking today's own pair changes
 *  nothing beyond today either way, but breaking the program's is a thing
 *  the screen has to say out loud. */
export function isLiveGroup(groups: Record<string, string> | undefined, id: string): boolean {
  return !!groups?.[id];
}
