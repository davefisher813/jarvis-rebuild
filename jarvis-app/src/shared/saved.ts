// THE ONE BODY OF "DID JARVIS SAVE WHAT I GAVE IT?" (Phase 0 D4, 2026-10-10).
//
// Dave, 2026-09-28, on the brain filing: "a filing never says Saved before it
// reaches the server". ai/brainMemory.ts obeyed it for two surfaces with two
// ternaries; every other Store backed door said Saved the moment the Store
// accepted the write, which offline means the row is in localStorage on one
// phone and nowhere else. This module is the rule written once, so a door
// cannot carry its own copy of the words and drift.
//
// The landed form is the door's own existing words, passed in unchanged, so
// nothing is restyled. The held form is built here and never contains a
// landed word: Filed says the phone has it, Will Sync says the server does
// not yet. The savedLaw (laws/savedLaw.test.ts) scans every toast for this.
//
// Pure: no React, no Store, no flag. The caller decides what pending means
// (Store.pending(), behind trust_v1) and passes the answer.

/** The held toast. "Filed · Will Sync", "Filed to Philosophy · Will Sync",
 *  "Filed 3 Items · Will Sync". `place` is already a label in the app's Title
 *  Case voice (a category, a filter, a tab); it is not recased here. A count
 *  of one is a plain filing: "Filed 1 Items" is not a sentence anyone says. */
export function heldText(place?: string, count?: number): string {
  if (count !== undefined && count > 1) return `Filed ${count} Items · Will Sync`;
  if (place) return `Filed to ${place} · Will Sync`;
  return "Filed · Will Sync";
}

/** The toast a door shows after a write: its own landed words while the Store
 *  is not pending, the held words while it is. `landed` is passed through byte
 *  for byte, which is what keeps every door's existing copy exactly as it was. */
export function savedToastText(landed: string, held: string, pending: boolean): string {
  return pending ? held : landed;
}
