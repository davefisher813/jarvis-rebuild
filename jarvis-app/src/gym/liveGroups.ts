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
  return day.map((e) => (groups[e.id] ? { ...e, groupId: groups[e.id] } : e));
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

/** Undo a session-only pairing: every id that shares this lift's group today
 *  is released, which is the exact inverse of groupForToday. */
export function ungroupToday(
  current: Record<string, string> | undefined,
  id: string,
): Record<string, string> {
  const next = { ...(current ?? {}) };
  const gid = next[id];
  if (!gid) return next;
  for (const k of Object.keys(next)) if (next[k] === gid) delete next[k];
  return next;
}
