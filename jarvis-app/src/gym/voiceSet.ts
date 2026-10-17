// SAY THE SET, THEN CONFIRM IT (the Logging Standard, addendum 5, 2026-10-17;
// Dave delegated "Whatever is standard", Alfred ruled the same day). Voice set
// logging is built as a test: a DELIBERATE command phrase starts it ("Log",
// leading the words, never a bare "yes"), the app reads the weight and reps
// back, Dave confirms with one tap, and the receipt carries Undo. Tapping the
// big Log button stays the primary way to log a set.
//
// This file is the pure half: what was heard (or typed, or dictated through
// the keyboard's mic) against the exercise he is standing at, and either the
// set it means or the reason it is not one. It never writes anything. The
// grammar after "Log" is gym/parseSet.ts's, the same shapes the capture box
// reads, so there is one set grammar in the app and not two.
//
// Digits only for the numbers: the app has no number-word reader, and
// "two twenty five" is 225 or 2 and 25 depending on who says it. Both iOS
// dictation and the browser's recognizer write a weight as digits.

import type { Exercise, MeasureKind, SetEntry } from "./types";
import { parseSetPhrase } from "./parseSet";
import { duplicateEntry, newSetId } from "./strip";
import { formatSet } from "./measures";
import { lineCase } from "../shared/casing";

type Measure = Pick<Exercise, "kind" | "unit" | "timeUnit"> & { sided?: boolean };

/** A set the words mean, without its id: the id is minted at the confirm, so
 *  a read-back that is shown and never confirmed spends nothing. */
export type VoiceSet = Omit<SetEntry, "id">;

export type VoiceSetRead =
  | { ok: true; set: VoiceSet }
  | { ok: false; reason: string };

/** What to say for this kind of exercise, as the field's placeholder and the
 *  tail of a refusal. Digits, because that is what the parser reads. */
export function voiceExample(kind: MeasureKind): string {
  switch (kind) {
    case "weight_reps": return "Log 225 for 5";
    case "reps":
    case "rounds": return "Log 12";
    case "distance_time": return "Log 400 in 2";
    case "done": return "Log Done";
    default: return "Log 45";
  }
}

/** What a speech engine hands over, made into what the parser reads: lower
 *  case, the multiplication sign as an x, and the punctuation a recognizer
 *  adds ("Log, 225 for 5.") gone. A decimal point between digits, a clock's
 *  colon and the AMRAP plus are kept, because they are the numbers. */
export function normalizeHeard(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/×/g, " x ")
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .replace(/(?<!\d)\.|\.(?!\d)/g, " ")
    .replace(/(?<!\d):|:(?!\d)/g, " ")
    .replace(/[,!?;"“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Read one utterance against the exercise. `last` is the last WORKING set
 * already logged on it (never a warm-up), which is what "Log same" repeats
 * and where "Log 8 reps" takes its weight from, exactly as the capture box's
 * logToSession does.
 */
export function parseVoiceSet(raw: string, exercise: Measure, last?: SetEntry): VoiceSetRead {
  const text = normalizeHeard(raw);
  const example = voiceExample(exercise.kind);
  // THE COMMAND PHRASE. Without "Log" leading the words nothing is read at
  // all, so a bare "yes", "ok" or a number said to someone else never logs.
  const m = /^log\b ?(.*)$/.exec(text);
  if (!m) return { ok: false, reason: `Start With Log, Like ${example}` };
  const rest = (m[1] ?? "").trim();
  if (!rest) return { ok: false, reason: `Now Say the Set, Like ${example}` };
  const hit = parseSetPhrase(rest, exercise);
  // Null covers a unit this exercise does not use ("100 kilos" on a pound
  // lift) as well as words that are not a set: neither is guessed at.
  if (!hit) return { ok: false, reason: `Not a Set Yet, Try ${example}` };
  if (hit.kind === "skip") return { ok: false, reason: "Voice Logs Sets, Not Skips" };
  if (hit.kind === "same") {
    if (!last) return { ok: false, reason: "Nothing Logged Yet to Repeat" };
    // A repeat is a new event: duplicateEntry drops the stamp and the mark.
    const { id: _id, ...set } = duplicateEntry(last);
    void _id;
    return { ok: true, set };
  }
  if (hit.kind === "done") return { ok: true, set: { done: true } };
  // A rep count on its own inherits the weight from the last set, which is
  // what "8 reps" means standing at a loaded bar; with nothing to inherit
  // from, the set is exactly what was said.
  const set = hit.entry.w === undefined && last?.w !== undefined ? { ...hit.entry, w: last.w } : hit.entry;
  return { ok: true, set };
}

/** The read-back on screen: "Log 225 Lb × 5 on Bench Press". */
export function voiceReadBack(name: string, exercise: Measure, set: VoiceSet): string {
  if (exercise.kind === "done") return lineCase(`Mark ${name} Done`);
  return lineCase(`Log ${formatSet(exercise, set)} on ${name}`);
}

/** The read-back aloud: the same words, with the multiplication sign said
 *  the way he said it. */
export function voiceSpoken(name: string, exercise: Measure, set: VoiceSet): string {
  if (exercise.kind === "done") return `${name}, done`;
  return `${formatSet(exercise, set).replace(" × ", " for ")}, ${name}`;
}

/** The entry the confirm writes: a fresh id, and "reported", because he said
 *  it himself (addendum 1: planned is not done; a voice set is reported). */
export function voiceEntry(set: VoiceSet): SetEntry {
  return { ...set, id: newSetId(), state: "reported" };
}
