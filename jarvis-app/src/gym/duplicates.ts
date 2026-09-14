import type { LibraryRow } from "./libraryEdit";

// NEAR-DUPLICATE LIFTS (Dave, 2026-09-14: "the app should be able to suggest
// when workouts are duplicates and merge them. Ex: bench and bench press").
//
// The library is free text by design, and free text forks: one day it is
// "Bench", the next "Bench Press", and now one lift has two histories, two
// chart lines and two sets of PRs. Merge has existed since Part 3 wave 1, but
// only if you already knew the fork was there and went looking for it. This
// file is the looking.
//
// IT SUGGESTS, IT NEVER MERGES. Merging rewrites every workout and every
// program day the loser appears in, which is the most destructive write in
// the gym. A guess good enough to put a card on a screen is nowhere near good
// enough to run that unasked, so nothing here writes anything: it returns
// pairs, the page offers them, and the existing reviewed merge flow does the
// work with the athlete's own tap.
//
// AND IT WOULD RATHER MISS THAN LIE. A false positive here proposes welding
// two genuinely different lifts together, so every rule below is written to
// fail closed: one qualifying word anywhere in the difference and the pair is
// dropped, no matter how similar the rest of it looks.

/** Words that abbreviate to the same lift. Expanded before anything is
 *  compared, so "DB Press" and "Dumbbell Press" are one name. */
const EXPAND: Record<string, string> = {
  db: "dumbbell", dbs: "dumbbell", bb: "barbell", kb: "kettlebell",
  dl: "deadlift", rdl: "romanian deadlift", sldl: "stiff leg deadlift",
  ohp: "overhead press", bp: "bench press", ohe: "overhead extension",
  bw: "bodyweight", ez: "ezbar", "e-z": "ezbar",
  lats: "lat", pulldown: "pull down", pullup: "pull up", pullups: "pull up",
  chinup: "chin up", chinups: "chin up", pushup: "push up", pushups: "push up",
  situp: "sit up", situps: "sit up", extensions: "extension", curls: "curl",
  presses: "press", raises: "raise", rows: "row", squats: "squat",
  flyes: "fly", flys: "fly", flies: "fly", lunges: "lunge", dips: "dip",
};

/** Words that carry no meaning of their own in a lift's name. Dropped, so
 *  "Barbell Bench Press" and "Bench Press (Barbell)" do not differ over
 *  punctuation and a filler word. */
const NOISE = new Set(["the", "a", "an", "of", "with", "on", "and", "exercise", "variation"]);

/** WORDS THAT MAKE IT A DIFFERENT LIFT. If any of these appears on one side
 *  of a pair and not the other, the two are NOT duplicates, however alike
 *  they look. Incline bench and bench are not the same lift and never will
 *  be; nor are front squat and squat, or close grip bench and bench.
 *
 *  This list is the whole safety margin of the feature, so it is written
 *  broad on purpose: a modifier wrongly included here costs one suggestion
 *  that never appears, and a modifier wrongly left out costs a lifter their
 *  merged, unrecoverable history. */
const MODIFIERS = new Set([
  "incline", "decline", "flat", "seated", "standing", "kneeling", "lying", "prone", "supine",
  "close", "wide", "narrow", "grip", "neutral", "supinated", "pronated", "reverse", "underhand", "overhand",
  "front", "back", "side", "lateral", "rear", "high", "low", "mid",
  "romanian", "stiff", "sumo", "conventional", "deficit", "block", "pin", "board",
  "single", "one", "double", "two", "unilateral", "alternating", "offset", "staggered", "split", "bulgarian",
  "left", "right", "paused", "pause", "tempo", "explosive", "speed", "isometric",
  "assisted", "weighted", "banded", "machine", "cable", "smith", "hammer", "landmine", "trap", "hex", "safety",
  "barbell", "dumbbell", "kettlebell", "ezbar", "bodyweight",
  "overhead", "behind", "neck", "chest", "bar", "eccentric", "negative",
  "feet", "up", "down", "elevated", "floor", "half", "quarter", "full",
  "goblet", "zercher", "hack", "sissy", "bulgarian", "nordic", "good", "morning",
]);

/** The name as the matcher sees it: lowercase, punctuation gone,
 *  abbreviations expanded, filler dropped, plurals folded. */
export function normalizeName(name: string): string[] {
  const raw = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out: string[] = [];
  for (const w of raw) {
    const expanded = EXPAND[w] ?? w;
    for (const part of expanded.split(" ")) {
      const t = singular(part);
      if (t && !NOISE.has(t)) out.push(t);
    }
  }
  return out;
}

/** Just enough plural folding to stop "Curl" and "Curls" being two lifts.
 *  Deliberately shallow: a real stemmer would fold words this list must keep
 *  apart, and the EXPAND table already handles the irregulars that matter. */
function singular(w: string): string {
  if (w.length > 3 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 3 && w.endsWith("ses")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/** Edit distance, capped: anything past `max` stops early and returns max+1,
 *  since the only question ever asked here is "is this within two?". */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
      row.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length]!;
}

export type DuplicateReason = "same" | "contained" | "typo";

export interface DuplicatePair {
  /** The lift with more history. Offered as the survivor, because merging
   *  the bigger side into the smaller one is the expensive mistake. */
  keep: LibraryRow;
  /** The lift with less. Offered as the one that folds in. */
  fold: LibraryRow;
  reason: DuplicateReason;
  /** Plain words for the card, never a score or a percentage. */
  why: string;
}

/** The stable id of a pair, either way round, so a dismissal sticks whichever
 *  order the two happen to be in next time the page is built. */
export function pairId(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function verdict(a: string[], b: string[]): { reason: DuplicateReason; why: string } | null {
  const A = new Set(a);
  const B = new Set(b);
  const onlyA = a.filter((w) => !B.has(w));
  const onlyB = b.filter((w) => !A.has(w));

  // Identical once normalized: "DB Press" and "Dumbbell press".
  if (onlyA.length === 0 && onlyB.length === 0) {
    return { reason: "same", why: "The same name, written two ways" };
  }

  // ONE QUALIFYING WORD AND WE STOP. Incline bench is not bench.
  const diff = [...onlyA, ...onlyB];
  if (diff.some((w) => MODIFIERS.has(w))) return null;

  // One name is the other plus a word that changes nothing: "Bench" and
  // "Bench Press". Require something substantive in common, so two one-word
  // lifts do not pair off on an empty overlap.
  const shared = a.filter((w) => B.has(w));
  if (shared.length > 0 && (onlyA.length === 0 || onlyB.length === 0)) {
    const extra = diff.join(" ");
    return { reason: "contained", why: `One is the other plus “${extra}”` };
  }

  // A typo, and only in a name long enough for two characters to be a slip
  // rather than the whole difference: "Deadlfit" and "Deadlift".
  const ja = a.join(" ");
  const jb = b.join(" ");
  if (ja.length >= 6 && jb.length >= 6 && editDistance(ja, jb, 2) <= 2) {
    return { reason: "typo", why: "A letter or two apart" };
  }
  return null;
}

/**
 * Every pair of lifts in the library that looks like one lift written twice.
 *
 * Only ever pairs lifts that LOG THE SAME WAY, because merge itself refuses
 * to cross measures (libraryEdit.mergeLifts) and offering a merge that will
 * be rejected is worse than offering nothing. Lifts already known to each
 * other through an alias -- a rename or an earlier merge -- are skipped:
 * that fork has been dealt with, and proposing it again is the app nagging
 * about a decision the athlete already made. `dismissed` does the same for
 * pairs waved off by hand.
 */
export function findDuplicates(rows: LibraryRow[], dismissed: string[] = []): DuplicatePair[] {
  const skip = new Set(dismissed);
  const norm = new Map<string, string[]>();
  for (const r of rows) norm.set(r.key, normalizeName(r.name));

  const out: DuplicatePair[] = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i]!;
      const b = rows[j]!;
      if (a.kind !== b.kind) continue;
      if (skip.has(pairId(a.key, b.key))) continue;
      // Already reconciled once: an alias means one of these two used to be
      // called the other.
      const known = (a.aliases ?? []).some((x) => x.toLowerCase() === b.name.toLowerCase())
        || (b.aliases ?? []).some((x) => x.toLowerCase() === a.name.toLowerCase());
      if (known) continue;

      const v = verdict(norm.get(a.key)!, norm.get(b.key)!);
      if (!v) continue;
      // The one with more sessions survives; ties fall to the one done more
      // recently, and then to the longer name, which is usually the fuller
      // one ("Bench Press" over "Bench").
      const aWins = a.sessions !== b.sessions
        ? a.sessions > b.sessions
        : (a.lastDate ?? "") !== (b.lastDate ?? "")
          ? (a.lastDate ?? "") > (b.lastDate ?? "")
          : a.name.length >= b.name.length;
      out.push({ keep: aWins ? a : b, fold: aWins ? b : a, reason: v.reason, why: v.why });
    }
  }
  // Surest first: an exact match written two ways, then a contained name,
  // then a guess at a typo.
  const rank: Record<DuplicateReason, number> = { same: 0, contained: 1, typo: 2 };
  return out.sort((x, y) => rank[x.reason] - rank[y.reason] || x.fold.name.localeCompare(y.fold.name));
}
