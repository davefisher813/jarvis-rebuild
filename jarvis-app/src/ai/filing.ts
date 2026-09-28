// Brain Manual v1 (Phase 1) - filing guards.
//
// Pure helpers the in-flow filing buttons share: the word counter, the
// voice-sample guardrails, and the note "File as…" text pick. Chat filing
// ("log it: …") was cut from v1 (Dave, 2026-09-28) and ships as the next
// follow-up, with its parser, schema and trigger list.
//
// Pure: no I/O. The payload build + write live in filingIntake.ts.

import { VOICE_MIN_WORDS } from "./brainMemory";

/** Shared word counter (also feeds the voice wordCount in filingIntake). */
export function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function normalizeSample(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

export type VoiceGuardResult = "ok" | "too-short" | "duplicate";

// Voice-sample guardrails (flow doc §4.4). An exact duplicate of an existing
// sample is skipped with a notice - it is answered first, because the
// caller's "save anyway" overrides only the length check and must never file
// a sample twice. Under VOICE_MIN_WORDS words there is not much to learn -
// the caller offers "save anyway". The 5-sample cap and 6th-sample
// replace-oldest rule live in filingIntake; this answers whether a candidate
// sample may be saved at all.
export function voiceGuard(text: string, existingSamples: string[]): VoiceGuardResult {
  const n = normalizeSample(text);
  if (n && existingSamples.some((s) => normalizeSample(s) === n)) return "duplicate";
  if (countWords(text) < VOICE_MIN_WORDS) return "too-short";
  return "ok";
}

/** "File as…": the selection when one exists, otherwise the whole note.
 *  Blank (whitespace-only) means the note menu item renders disabled --
 *  filing blank text is rejected client-side (flow-doc §6). */
export function pickFileText(selection: string | null, fullNote: string): string {
  if (selection) return selection.trim();
  return fullNote.trim();
}
