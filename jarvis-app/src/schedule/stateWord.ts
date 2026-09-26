import { modeOf } from "../routine/types";

// THE STATE VOCABULARY (C-28, Astra pass, Dave's picks 2026-09-12).
//
// Every row on a day carries one word for what KIND of time it is, and the
// vocabulary is closed: seven words, no synonyms, one derivation. Before
// this, the same fact was said three ways on three surfaces ("Focus time",
// a sky kicker, nothing at all on Today), so a person could not learn the
// language by using it.
//
// Nothing here is stored. A word is derived from the row every time it is
// drawn, which is the whole reason COMPLETED is allowed to exist at all:
// see below.
export type StateWord = "FIXED" | "FOCUS" | "PROTECTED" | "FLEXIBLE" | "PROPOSED" | "LIVE" | "COMPLETED";

// The tone each word wears, as the .fact.st variant it renders in
// (styles/components.css). LIVE is the only red, on the Now rule alone;
// COMPLETED is good; everything else is quiet.
//
// FOCUS AND PROTECTED ARE QUIET NOW (§AM Colour Key, 2026-09-26). They were
// sky, for saying something about the shape of the day rather than its
// status. The key gives sky one meaning, an estimate the app worked out, and
// the sky fact variant was retired on 2026-09-21, so "fact st sky" painted
// nothing and the two words inherited the line's grey by accident. Caps is
// what sets a state word apart (§AK), so the quiet tone loses nothing.
export type StateTone = "red" | "good" | "gray";

export function toneFor(word: StateWord): StateTone {
  if (word === "LIVE") return "red";
  if (word === "COMPLETED") return "good";
  return "gray";
}

const toMin = (hhmm: string): number => {
  const p = hhmm.split(":");
  return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0);
};

/**
 * A committed event. FIXED unless the clock has already passed it.
 *
 * COMPLETED IS THE CLOCK, NOT AN OUTCOME (the one carve-out of do-not-touch
 * item 2, and the reason it is a carve-out at all). It says the time went by.
 * It does not say the thing happened, went well, or was worth doing, and no
 * event entity gains a `done`, `completed` or `outcome` field to back it:
 * asking the clock costs nothing and can never be wrong about the past. A
 * row on another day is never COMPLETED, however old, because this is a
 * statement about today.
 */
export function stateForEvent(
  e: { date: string; start: string; end?: string | null },
  now: { today: string; nowMin: number } | null,
): StateWord {
  if (now && e.date === now.today) {
    const end = e.end ? toMin(e.end) : toMin(e.start) + 60;
    if (end < now.nowMin) return "COMPLETED";
  }
  return "FIXED";
}

/**
 * A block from Your Routine. Soft comes first on purpose: a soft block is a
 * preference whatever its mode, and saying PROTECTED about time the planner
 * is allowed to route through would be the row lying about the wall.
 */
export function stateForBlock(b: { label?: string; kind?: string; mode?: string; soft?: boolean }): StateWord {
  if (b.soft) return "FLEXIBLE";
  const mode = modeOf(b);
  if (mode === "holds") return "FOCUS";
  if (mode === "protects") return "PROTECTED";
  return "FLEXIBLE";
}

/** A drafted pick, before anyone accepted it. */
export function stateForProposed(): StateWord {
  return "PROPOSED";
}
