// "NOT THIS ONE" IS AN ANSWER, NOT A SURVEY RESPONSE.
//
// (Dave, 2026-09-15: "do the buttons really have any value to the user... the
// worst thing is for someone to click on something and it's pointless".)
//
// The Why sheet shipped with two buttons, That's Right and That's Wrong. Both
// emitted an event. The event lands in the month seal's suggestion tally
// (review/seal.ts) and in the AI context summary, and NOTHING re-ranks: you
// could tell JARVIS its pick was wrong and it would go on offering you the
// same task for the rest of the day. That is a complaint box wearing a button,
// and on the one screen that exists to tell you what to do next it is worse
// than nothing.
//
// This is the smallest thing that makes it real: the task steps out of the
// LEADING slot for the rest of today, and the next-ranked one takes it.
//
// THREE THINGS IT DELIBERATELY IS NOT:
//   - not a snooze: the task keeps its due date, its place in the deck and
//     its row everywhere else in the app. Only the headliner skips it.
//   - not a dismissal of the task: nothing is hidden, deferred or rescheduled,
//     and the Focus deck still counts it.
//   - not permanent: it is keyed to the day. Tomorrow deals it again, because
//     "not now" and "not ever" are different sentences and only one of them
//     was said.

const KEY = "jarvis.today.notThisOne.v1";

interface Row { id: string; day: string }

function read(): Row[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r): r is Row =>
      !!r && typeof r === "object"
      && typeof (r as Row).id === "string" && typeof (r as Row).day === "string");
  } catch {
    return [];
  }
}

/** The ids waved off for `today`. Yesterday's rows are dropped on read, so
 *  the list cannot grow without bound and a day genuinely starts clean. */
export function notThisOneToday(today: string): Set<string> {
  return new Set(read().filter((r) => r.day === today).map((r) => r.id));
}

/** Say it about one task. Best effort, like every other localStorage read in
 *  this folder: a private-mode failure costs the preference, never the tap. */
export function markNotThisOne(id: string, today: string): void {
  const next = [...read().filter((r) => r.day === today && r.id !== id), { id, day: today }];
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
}

/**
 * The deal, with the waved-off ones stepped over.
 *
 * FALLS BACK TO THE WHOLE LIST when every candidate has been waved off. The
 * alternative is Your Move going blank on a day with open tasks in it, for a
 * reason nothing on screen explains, which trades one dead control for a
 * missing card. Saying "not this one" to all of them is not the same as
 * saying there is nothing to do.
 */
export function dealFrom<T extends { id: string }>(ranked: T[], today: string): T[] {
  const skip = notThisOneToday(today);
  if (skip.size === 0) return ranked;
  const kept = ranked.filter((t) => !skip.has(t.id));
  return kept.length ? kept : ranked;
}
