import type { Derived } from "./derive";

// THE NIGHTLY PASS (Brain build handoff 1.2 and item 2, decision x2).
//
// Real brains do most of their learning offline: the day's raw experience
// gets replayed, patterns kept, noise dropped (Klinzing, Niethard & Born,
// Nature Neuroscience 2019). The product version is not a metaphor and not
// marketing (Part 8: no neuroscience vocabulary on screen) - it is a
// scheduled review instead of a live threshold trip.
//
// What was wrong with the live trip: every candidate surfaced the instant a
// gate happened to cross while Today was on screen. Whether JARVIS noticed
// something depended on whether the app was open at the moment the tenth
// completion landed. A day the app was busy taught nothing.
//
// What this adds, and deliberately all it adds:
//   - ONE consolidation per local day. The first Today render after the day
//     turns over decides that day's set; every later render reuses it.
//   - UP TO THREE, ONLY WHEN EARNED (decision x3). The Aug 3 law capped
//     candidates at one a day, which was right when one module fed the log.
//     With more sources a single slot silently drops real, earned proposals.
//     Three is a ceiling, never a quota: a day with nothing to say still
//     says nothing, and that is the common case by design.
//   - The local-day boundary, anchored the way every other daily job in this
//     app anchors it. The handoff's own words: "the local_day lesson has now
//     bitten this codebase three times - do not repeat it a fourth."
//
// What it does NOT add: a new gate, a new store, or any path into the genome
// that skips the accept tap. The set this returns is the same candidates the
// same detectors produced under the same thresholds, decided once a day
// instead of whenever the screen happened to be open.

export const DAILY_PROPOSAL_CAP = 3;

const KEY = "jarvis.brain.nightly.v1";

interface Consolidation {
  /** Local YYYY-MM-DD the pass ran for. */
  day: string;
  /** The derivation keys chosen for that day, in order. */
  keys: string[];
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readConsolidation(): Consolidation | null {
  const s = storage();
  if (!s) return null;
  try {
    const c = JSON.parse(s.getItem(KEY) || "null") as Consolidation | null;
    return c && typeof c.day === "string" && Array.isArray(c.keys) ? c : null;
  } catch {
    return null;
  }
}

function writeConsolidation(c: Consolidation): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(KEY, JSON.stringify(c));
  } catch { /* the pass is a nicety; a private-mode device just re-runs it */ }
}

/**
 * The day's proposals: consolidated once per local day, capped at three.
 *
 * `moments` is what the detectors produced right now, already filtered by
 * brainMoments (accepted, muted and capped-out ones are gone before they get
 * here). This function only decides WHICH of them today's set is, and holds
 * that decision steady for the rest of the day.
 *
 * Holding it steady is the point. Without it, accepting one proposal in the
 * morning promotes a different one into view in the afternoon, so a quiet
 * Brain becomes a Brain that produces a fresh thing to answer every time the
 * home screen is opened. That is the nagging failure mode the one-a-day cap
 * was protecting against, and the cap is raised here, not removed.
 */
export function consolidate(moments: Derived[], today: string): Derived[] {
  // AN EMPTY SET IS NOT A DECISION. Writing one would let the first render
  // of the day lock the Brain shut until tomorrow, and the first render is
  // exactly when the set is least trustworthy: the window read is async and
  // best-effort, so a thin log, a cold cache or one offline moment all
  // arrive here as zero moments. Recording that as "today's answer" would
  // mean a transient failure silences a real, earned proposal for a day.
  // Nothing to say is just nothing to say; it is not worth remembering.
  if (moments.length === 0) return [];
  const prior = readConsolidation();
  if (prior?.day === today) {
    // Same day: the set was already decided. Anything since accepted or
    // dismissed has already been filtered out upstream, so this can shrink
    // during the day. It never grows.
    const chosen = prior.keys
      .map((k) => moments.find((m) => m.derivation === k))
      .filter((m): m is Derived => !!m);
    return chosen;
  }
  const picked = moments.slice(0, DAILY_PROPOSAL_CAP);
  writeConsolidation({ day: today, keys: picked.map((m) => m.derivation) });
  return picked;
}
