import { FADE_AFTER_DAYS, daysSince } from "../recall";
import type { ReadinessState } from "../readiness";
import type { Strand } from "./types";

// THE STRAND'S STATE WORD (C-40, Astra, 2026-09-12). Derived here, every
// render, from fields the strand already carries; never stored, exactly as
// the schedule's state word is derived from the clock (schedule/stateWord.ts).
//
//   KNOWN    he said it: source told or asked.
//   LEARNED  JARVIS watched it happen (or read it from an upload) and the
//            fact is live.
//   FADING   a fact nobody has confirmed in a season (recall.ts's own
//            FADE_AFTER_DAYS), whichever way it arrived. C-47 gives the row
//            this word and a Still True capsule; the Needs Confirmation
//            filter is where these gather.
//
// WATCHING is not a strand state at all. It is a readiness row past
// CLOSE_SHARE of its gate, and it lives on the same list only under the
// Watching filter and in Needs You (see readinessWord below).
//
// A paused watched strand has no state word: the row says Paused as a plain
// fact instead, because "learned, but switched off" is not a state the closed
// vocabulary has a word for, and inventing one here would be a ruling.
export type StrandState = "KNOWN" | "LEARNED" | "FADING";

export const STRAND_STATE_LABEL: Record<StrandState, string> = {
  KNOWN: "Known", LEARNED: "Learned", FADING: "Fading",
};

export function stateForStrand(s: Strand, today: string): StrandState | null {
  if (s.data.status === "active" && daysSince(s.data.lastConfirmed, today) >= FADE_AFTER_DAYS) return "FADING";
  if (s.data.source === "told" || s.data.source === "asked") return "KNOWN";
  if ((s.data.source === "watched" || s.data.source === "uploaded") && s.data.status === "active") return "LEARNED";
  return null;
}

// The colour each word wears: sky for what he said (time-neutral, quiet
// certainty), purple for JARVIS-made knowledge (G7), warn for the one that
// asks something of him.
export function toneForStrandState(w: StrandState): "sky" | "purp" | "warn" {
  return w === "KNOWN" ? "sky" : w === "LEARNED" ? "purp" : "warn";
}

// THE FILTER BUCKETS (C-40). Choosers over the list: a strand sits in exactly
// one. Fading strands gather under Needs Confirmation whatever their source,
// because that filter is "what is JARVIS asking me", not "how did it arrive".
export type StrandBucket = "known" | "learned" | "needs";

export function bucketFor(s: Strand, today: string): StrandBucket {
  const st = stateForStrand(s, today);
  if (st === "FADING") return "needs";
  if (s.data.source === "told" || s.data.source === "asked") return "known";
  return "learned";
}

// THE READINESS WORD (C-39). One word per detector on What JARVIS Knows; the
// have/need sentences moved to the Learning Lab under Settings. ready folds
// into Close because both mean "at or past the gate and not yet a fact";
// muted folds into Waiting because from this panel's distance a detector that
// stopped offering and one that has not started look the same, and the Lab is
// where the difference is spelled out.
export type ReadinessWord = "Known" | "Close" | "Waiting";

export function readinessWord(state: ReadinessState): ReadinessWord {
  if (state === "known") return "Known";
  if (state === "ready" || state === "close") return "Close";
  return "Waiting";
}

export function toneForReadinessWord(w: ReadinessWord): "good" | "warn" | "gray" {
  return w === "Known" ? "good" : w === "Close" ? "warn" : "gray";
}

// A readiness row that is WATCHING: past CLOSE_SHARE of its gate (close), or
// past the gate itself and not yet accepted (ready). Both are "JARVIS is
// nearly sure"; known is already a fact and waiting is not yet a question.
export function isWatching(state: ReadinessState): boolean {
  return state === "close" || state === "ready";
}

// THE CONFIDENCE WORD (C-41), from the derivation's have and need: High at
// twice the gate, Medium at the gate, nothing below it. Told and asked
// strands get no word; the caller does not ask for one. The real count
// renders beside the word as a plain fact where the derivation owns one.
export type ConfidenceWord = "High" | "Medium";

export function confidenceWord(have: number, need: number): ConfidenceWord | null {
  if (need <= 0) return null;
  if (have >= 2 * need) return "High";
  if (have >= need) return "Medium";
  return null;
}
