// Brain Manual v1 (Phase 1) - chat filing parse.
//
// Trigger detection + FILING_SCHEMA for the brain-chat "log it: …" flow
// (flow doc §4.1). The client watches chat text for FILING_TRIGGERS (owned
// by brainMemory.ts), strips the trigger with detectFilingTrigger, and sends
// the remainder to a small model with FILING_SCHEMA via the forced tool call
// in structured.ts. parseFiling is the belt to that suspender: it validates
// the reply the way parseCapture does, so a bad or partial reply degrades to
// a clarifying question instead of writing a bad memory.
//
// Pure: no I/O. The payload build + write live in filingIntake.ts.

import { noDashes } from "./suggestions";
import { stripTrigger, VOICE_MIN_WORDS, type BrainMemoryCategory } from "./brainMemory";

// The categories a filing can land in. Mirrors the BrainMemoryCategory union
// in brainMemory.ts; a JSON-schema enum cannot reference a type, so this is
// the single runtime source for the schema and for validation.
export const FILING_CATEGORIES = [
  "decision",
  "philosophy",
  "value",
  "voice",
  "fact",
] as const;

export interface FilingResult {
  category: BrainMemoryCategory;
  text: string;
  why?: string; // decisions: the reason behind the choice
  date?: string; // decisions: yyyy-mm-dd the choice was made (today when omitted)
}

// Structured-output schema (copies the CAPTURE_SCHEMA pattern): sent with the
// filing call so the proxy forces a tool reply in exactly this shape.
// parseFiling stays as the belt to this suspender: it still validates, still
// scrubs with noDashes, and still drops a malformed optional rather than
// rejecting the whole filing.
export const FILING_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    category: {
      type: "string",
      enum: [...FILING_CATEGORIES],
      description: "which brain category this belongs in",
    },
    text: {
      type: "string",
      description: "the memory in the user's own words, verbatim when quoted",
    },
    why: {
      type: "string",
      description: "the reason behind the choice (decisions only)",
    },
    date: {
      type: "string",
      description: "yyyy-mm-dd the decision was made; omit when today",
    },
  },
  required: ["category", "text"],
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseFiling(raw: unknown): FilingResult | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    const o = JSON.parse(cleaned) as Partial<FilingResult> | null;
    if (!o || typeof o !== "object") return null;
    // Required fields missing or wrong -> null: the caller asks one
    // clarifying question instead of filing (flow doc §4.1).
    const category = (FILING_CATEGORIES as readonly string[]).includes(o.category ?? "")
      ? (o.category as BrainMemoryCategory)
      : undefined;
    const text = typeof o.text === "string" ? o.text.trim() : "";
    if (!category || !text) return null;
    // A voice sample is the user's verbatim writing (decode.ts's argument:
    // rewriting quoted text is misquoting), so it skips the scrub; every
    // other category is model-authored app prose and follows the no-em-dash
    // law at its parse point, like parseCapture.
    const scrub = category === "voice" ? (s: string) => s : noDashes;
    const out: FilingResult = { category, text: scrub(text) };
    if (typeof o.why === "string" && o.why.trim()) out.why = scrub(o.why.trim());
    // Belt-and-suspenders like parseCapture's reminder/bill: a malformed
    // optional date is dropped, not fatal. Intake auto-fills today's date
    // for decisions.
    if (typeof o.date === "string" && DATE_RE.test(o.date.trim())) out.date = o.date.trim();
    return out;
  } catch {
    return null; // not JSON
  }
}

// The client watches every chat message with this. A non-null return is the
// text after the trigger - the remainder to send to the small-model filing
// call. Null means a normal message: never filed.
export function detectFilingTrigger(message: string): string | null {
  return stripTrigger(message);
}

// True when the parse left the filing unfileable: no result at all, or a
// result with no category or no text. The caller asks one clarifying
// question instead of writing a bad memory.
export function needsClarification(filing: FilingResult | null): boolean {
  return !filing || !filing.category || !filing.text.trim();
}

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
