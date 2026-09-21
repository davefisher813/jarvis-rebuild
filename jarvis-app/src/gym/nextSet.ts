import type { Exercise, SetEntry } from "./types";
import { duplicateEntry } from "./strip";

/** WHAT THE NEXT SET WILL LOG. ONE ANSWER, FOR EVERY DOOR THAT ASKS.
 *
 * Dave, 2026-09-21, on two screenshots of a live Push Day: "The wrong log
 * number is still always at the bottom", and "It should auto default to the
 * prior session numbers then the set before after that."
 *
 * Those are the same bug twice. The session screen had THREE places that each
 * decided, separately, what the next set was:
 *
 *   the strip's NOW card   planEx.sets.slice(workLogged)  -- the plan
 *   the big red button     plannedEntryAt(planEx, n)      -- the plan, again,
 *                          merged with a draft that is cleared on every write
 *   log()                  the same, plus a fallback to the last logged set
 *
 * So after logging set 1 the draft was wiped, the card showed one thing and
 * the button named another, and the button is the one your thumb is already
 * on. On his screen the card read 225 lb x 2 and the button read "Log 275 lb
 * x 5": the strip and the plan had drifted apart, and tapping the obvious
 * control would have written a number he was not looking at. A logging app
 * that writes a weight the athlete did not lift is worse than useless.
 *
 * And neither source was the right one anyway. The plan is a template written
 * weeks ago; what you actually want in the fields is what you actually did.
 * So the rule is his, stated plainly:
 *
 *   the first working set  -> what you did for this lift LAST session
 *   every set after it     -> what you just did, this session
 *   whatever you type      -> wins over both, always
 *   nothing to go on       -> the plan, which is what it is for
 *
 * The plan is the floor, not the default. It steps in for a lift with no
 * history, and it is what "Match" and the suggestion engine still work from.
 */
export function nextSetEntry(opts: {
  /** The plan for this exercise, already trimmed for the session. */
  plan: Exercise;
  /** What has been logged for it THIS session, in order. */
  logged: SetEntry[];
  /** The same lift's sets from the last session that had it, in order. */
  lastSession?: SetEntry[] | null;
  /** What the open set's fields say right now, or null before a keypress. */
  draft?: Partial<SetEntry> | null;
}): SetEntry | null {
  const { plan, logged, lastSession, draft } = opts;
  // A warm-up and a drop are not working sets and never advance the place in
  // the plan, which is the same reading workLogged already uses.
  const work = logged.filter((s) => !s.warmup && !s.drop);
  const i = work.length;

  // THE SET BEFORE, THIS SESSION. The moment there is one, it is the answer:
  // whatever you just lifted is what you are about to lift again.
  const before = work[work.length - 1];
  // LAST SESSION, POSITION FOR POSITION. Only for the first set, because
  // after that "the set before" is a better and fresher answer.
  const lastAt = lastSession?.[i];
  const planned = plan.sets.filter((s) => !s.warmup)[i] ?? null;

  const base = i > 0 && before ? before : (lastAt ?? planned);
  if (!base && !draft) return null;
  // duplicateEntry drops `at` and `moved`: the next set is a NEW event, and
  // it must not inherit the stamp or the grind mark of the one it copies.
  const seed = base ? duplicateEntry(base) : ({} as SetEntry);
  // A copy of last session's set is not last session's set; and a working set
  // never inherits a warm-up or drop flag from whatever it was seeded with.
  const { warmup: _w, drop: _d, skipped: _s, ...clean } = seed as SetEntry & { skipped?: boolean };
  return { ...(clean as SetEntry), ...(draft ?? {}) };
}
