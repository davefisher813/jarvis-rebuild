// UP-ATH-18 (2026-09-06, option A): SAY THE SET TO THE BAR.
//
// Hands are chalky, the phone is on the floor, and the JARVIS bar is the one
// input on every screen. While a session is live, "225 for 5" typed into it
// logs a set on the exercise the athlete is standing in front of, instead of
// becoming a task called "225 For 5".
//
// DETERMINISTIC, AND NARROW ON PURPOSE. No AI call: these are the shapes
// people actually type, and a model in the path would cost money and latency
// to be less predictable. Everything this file is not certain about returns
// null, and null falls straight through to the normal capture routing, so a
// note that happens to start with a number is still a note. A MIS-PARSE MUST
// NEVER SILENTLY LOG: that is the whole reason for the refusals below.
//
// This is also the parser the microphone will feed when the native speech
// phase lands (option B). Same shapes, different input device.

import type { Exercise, SetLog } from "./types";
import { unitsFor, TIME_UNITS } from "./types";

/** What a phrase meant. `set` carries the numbers; the other three are the
 *  words that stand for an action rather than a measurement. */
export type SetPhrase =
  | { kind: "set"; entry: SetLog }
  | { kind: "same" }
  | { kind: "done" }
  | { kind: "skip" };

// The words, and only these. "again" is included because it is what people
// say; "more" is not, because "5 more" is a set and not a repeat.
const SAME = /^(same|same again|again|repeat)$/;
const DONE = /^(done|finished|complete|completed)$/;
const SKIP = /^(skip|skip it|pass)$/;

// Unit words to the app's own unit codes. Only the words for units THIS
// exercise actually measures in are ever looked for, which is what keeps the
// connector in "400 m in 65 sec" from being read as inches, and it is why a
// unit is only recognised directly after a number.
//
// A phrase that names a unit the exercise does not use is REFUSED rather than
// converted: GYM-F-06 normalises units that were already logged, and silently
// reading "100 kilos" onto a lb exercise would be inventing a number nobody
// typed.
const WORDS_FOR: Record<string, string[]> = {
  lb: ["lbs", "lb", "pounds", "pound"],
  kg: ["kgs", "kg", "kilograms", "kilogram", "kilos", "kilo"],
  sec: ["secs", "sec", "seconds", "second"],
  min: ["mins", "min", "minutes", "minute"],
  yd: ["yds", "yd", "yards", "yard"],
  m: ["meters", "meter", "metres", "metre", "m"],
  mi: ["miles", "mile", "mi"],
  ft: ["feet", "foot", "ft"],
  in: ["inches", "inch", "in"],
  cm: ["centimeters", "centimeter", "cm"],
};

const NUM = "(\\d+(?:\\.\\d+)?)";

function num(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** Every unit code this exercise can legally carry. distance_time carries
 *  two: a distance and a time. */
function allowedCodes(ex: Pick<Exercise, "kind" | "unit" | "timeUnit">): string[] {
  const base = [...unitsFor(ex.kind)];
  if (ex.kind === "distance_time") base.push(...TIME_UNITS);
  return base;
}

/** null when the phrase names no unit, the stripped phrase when every unit it
 *  names is one this exercise uses, and undefined when it names one that is
 *  not, which is a refusal. */
function readUnits(text: string, ex: Pick<Exercise, "kind" | "unit" | "timeUnit">): string | undefined {
  let out = text;
  for (const code of allowedCodes(ex)) {
    for (const word of WORDS_FOR[code] ?? []) {
      const re = new RegExp("(\\d)\\s*" + word + "\\b", "g");
      if (!re.test(out)) continue;
      const own = TIME_UNITS.includes(code as typeof TIME_UNITS[number]) && ex.kind === "distance_time"
        ? (ex.timeUnit ?? "min")
        : ex.unit;
      if (own && code !== own) return undefined;
      out = out.replace(new RegExp("(\\d)\\s*" + word + "\\b", "g"), "$1");
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Read one typed phrase against the exercise the session is on. Null means
 * "this is not a set", and the caller must then treat the text exactly as it
 * would have without this feature.
 */
export function parseSetPhrase(raw: string, exercise: Pick<Exercise, "kind" | "unit" | "timeUnit">): SetPhrase | null {
  const text = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!text) return null;
  if (SAME.test(text)) return { kind: "same" };
  if (SKIP.test(text)) return { kind: "skip" };
  // "done" is only ever a MARK, so a done-kind exercise logs it and every
  // other kind falls through: "done" on a bench press means the athlete
  // finished, which is the Finish button, not a set of nothing.
  if (DONE.test(text)) return exercise.kind === "done" ? { kind: "done" } : null;

  const bare = readUnits(text, exercise);
  if (bare === undefined) return null; // named a unit this exercise does not use

  if (exercise.kind === "weight_reps") {
    // "225 for 5", "225 x 5", "225 by 5": weight first, the way it is said.
    let m = new RegExp("^" + NUM + " ?(?:for|x|\\*|by) ?" + NUM + "$").exec(bare);
    if (m) return { kind: "set", entry: { w: num(m[1]), r: num(m[2]) } };
    // "5 at 225", "5 reps at 225": reps first, weight after the preposition.
    m = new RegExp("^" + NUM + " ?(?:reps? )?(?:at|@) ?" + NUM + "$").exec(bare);
    if (m) return { kind: "set", entry: { r: num(m[1]), w: num(m[2]) } };
    // "8 reps": the weight is whatever the plan already says, so only the
    // rep count is stated and the caller fills the rest from the last set.
    m = new RegExp("^" + NUM + " reps?$").exec(bare);
    if (m) return { kind: "set", entry: { r: num(m[1]) } };
    // A bare number on a weight exercise is genuinely ambiguous (is 225 the
    // weight or a rep count nobody could do), so it is refused.
    return null;
  }

  if (exercise.kind === "reps" || exercise.kind === "rounds") {
    // "7 rounds + 12" is an AMRAP score: the reps past the last full round.
    let m = new RegExp("^" + NUM + " ?(?:reps?|rounds?)? ?\\+ ?" + NUM + "$").exec(bare);
    if (m) return { kind: "set", entry: { r: num(m[1]), extra: num(m[2]) } };
    m = new RegExp("^" + NUM + "(?: (?:reps?|rounds?))?$").exec(bare);
    if (m) return { kind: "set", entry: { r: num(m[1]) } };
    return null;
  }

  if (exercise.kind === "distance_time") {
    const m = new RegExp("^" + NUM + " ?(?:in|at) ?" + NUM + "$").exec(bare);
    if (m) return { kind: "set", entry: { v: num(m[1]), t: num(m[2]) } };
    return null;
  }

  // time_faster, time_longer, distance, height: one magnitude, and a bare
  // number is unambiguous here because there is only one field to fill.
  if (exercise.kind !== "done") {
    // "1:30" is a minutes-and-seconds time, which is how a clock is read out.
    const clock = /^(\d+):([0-5]\d)$/.exec(bare);
    if (clock && (exercise.kind === "time_faster" || exercise.kind === "time_longer")) {
      const mins = Number(clock[1]);
      const secs = Number(clock[2]);
      return { kind: "set", entry: { v: exercise.unit === "min" ? mins + secs / 60 : mins * 60 + secs } };
    }
    const m = new RegExp("^" + NUM + "$").exec(bare);
    if (m) return { kind: "set", entry: { v: num(m[1]) } };
    return null;
  }

  return null;
}
