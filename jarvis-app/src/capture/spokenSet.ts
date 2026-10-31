import { normalizeExerciseName } from "../gym/starterLibrary";

// A WORKOUT SET SAID IN WORDS (the speech box, 2026-10-31).
//
// The speech box test of 2026-10-28 filed both workout lines as Notes ("Log a
// set. Deadlift, 405 pounds, 5 reps." and "I did 3 sets of 10 kettlebell
// swings at 53 pounds."), and Dave's own "Most Recent Set: 540 Lbs X 3 Reps"
// landed as a Note on his phone the same night. The only text-to-set path was
// the live session's, and it reads "225 for 5" against the lift on screen; it
// never takes a lift's NAME, so a set said anywhere else had nowhere to go.
//
// This reads the whole sentence: which lift (matched against his own library
// and the starter list, never invented from nothing), the weight with its
// unit, the reps, and how many sets. It answers null unless a lift is named
// AND the line carries a set's own words (reps, sets, a unit, "log"), so a
// note that mentions a bench press is still a note.

export interface SpokenSet {
  /** The lift as he calls it: his own library's spelling when it matched one. */
  name: string;
  /** True when the name is one he has logged or created before, or a starter. */
  known: boolean;
  w?: number;
  r?: number;
  /** How many identical sets ("3 sets of 10"); 1 when not said. */
  sets: number;
  unit: "lb" | "kg";
}

const NUM_WORD: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  eleven: "11", twelve: "12", fifteen: "15", twenty: "20",
};
// Words a lift is often said with that no library name carries. Kept in front of a matched name so "kettlebell swings"
// is filed as Kettlebell Swing, not as a bare Swing.
const EQUIPMENT = /\b(kettlebell|dumbbell|barbell|cable|machine|smith|trap bar|ez bar|landmine|band)\s+$/;

const singular = (w: string): string => (w.length > 2 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const fold = (s: string): string => normalizeExerciseName(s).split(" ").map(singular).join(" ");

export function readSpokenSet(raw: string, names: readonly string[]): SpokenSet | null {
  let t = raw.toLowerCase().replace(/[.,;:!?]/g, " ");
  t = t.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\b/g, (w) => NUM_WORD[w] ?? w);
  t = t.replace(/\s+/g, " ").trim();
  if (!t) return null;
  // A set's own words. Without one of these a line naming a lift is talk about the lift, not a set.
  const setWords = /\b(sets?|reps?|log|logged|lbs?|pounds?|kgs?|kilos?|kilograms?)\b|\d+\s*(?:x|for|by)\s*\d+/.test(t);
  if (!setWords) return null;

  const unitKg = /\b\d+(?:\.\d+)?\s*(?:kgs?|kilos?|kilograms?)\b/.test(t);
  const unit: "lb" | "kg" = unitKg ? "kg" : "lb";
  let w: number | undefined;
  let r: number | undefined;
  let sets = 1;

  // "3 sets of 10": the number after "sets of" is reps, unless a unit follows it ("2 sets of 50 lb" names a weight).
  const setsOf = t.match(/\b(\d+)\s*sets?\b(?:\s*(?:of\s+)?(\d+)(?!\d)(?!\s*(?:lbs?|pounds?|kgs?|kilos?|kilograms?)\b)(?!\.\d))?/);
  if (setsOf) {
    sets = Math.min(20, Math.max(1, Number(setsOf[1])));
    if (setsOf[2]) r = Number(setsOf[2]);
  }
  const withUnit = t.match(/\b(\d+(?:\.\d+)?)\s*(?:lbs?|pounds?|kgs?|kilos?|kilograms?)\b/);
  if (withUnit) w = Number(withUnit[1]);
  const at = t.match(/\bat\s+(\d+(?:\.\d+)?)\b/);
  if (w === undefined && at) w = Number(at[1]);
  const repsWord = t.match(/\b(\d+)\s*reps?\b/);
  if (repsWord) r = Number(repsWord[1]);
  const pair = t.match(/\b(\d+(?:\.\d+)?)\s*(?:lbs?|pounds?|kgs?|kilos?)?\s*(?:x|for|by|times)\s*(\d+)\b/);
  if (pair) {
    if (w === undefined) w = Number(pair[1]);
    if (r === undefined) r = Number(pair[2]);
  }
  // "50 lb curls for 10": the weight came first, the reps follow "for" after the lift's name.
  if (r === undefined && w !== undefined) {
    const forR = t.match(/\b(?:for|x|times)\s+(\d+)(?!\d)(?!\s*(?:lbs?|pounds?|kgs?|kilos?|min|mins|minutes|sec|secs|seconds|miles?|meters?)\b)/);
    if (forR) r = Number(forR[1]);
  }
  if (r === undefined && w === undefined) return null;

  // Which lift. The longest library or starter name whose words all appear in the line, singular or plural.
  const line = " " + fold(t) + " ";
  let best: string | null = null;
  for (const n of names) {
    const f = fold(n);
    if (!f) continue;
    if (line.includes(" " + f + " ") && (!best || f.length > fold(best).length)) best = n;
  }
  if (!best) return null;
  // "Kettlebell swings": keep the equipment word he said in front of a name that does not carry it.
  const at0 = line.indexOf(" " + fold(best) + " ");
  const before = line.slice(0, at0 + 1);
  const eq = before.match(EQUIPMENT);
  const name = eq && !fold(best).includes(eq[1]!) ? titleWords(eq[1]! + " " + best) : best;
  return { name, known: name === best, ...(w !== undefined ? { w } : {}), ...(r !== undefined ? { r } : {}), sets, unit };
}

function titleWords(s: string): string {
  return s.split(" ").map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
}
