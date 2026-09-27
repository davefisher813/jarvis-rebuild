// Brain Manual v1 (Phase 1) — shared contracts.
//
// One place for the brain-memory data shapes, constants, and category
// metadata. Pure: no I/O, no Supabase imports. The memory assembler,
// filing parse, filing intake, and all Brain UI import from here so the
// category list, budget, and guards stay identical everywhere.
//
// Storage: Supabase `item` table, `entity_type = 'brain_memory'`, payload
// in the `data` jsonb column. `BrainMemoryData` is the shape of `data`;
// row-level fields (id, created_at, updated_at) live on the table.

export const BRAIN_MEMORY_ENTITY = "brain_memory";
export const PERSON_ENTITY = "person";

export type BrainMemoryCategory =
  | "decision"
  | "philosophy"
  | "value"
  | "voice"
  | "fact";

export type BrainMemoryState = "LEARNED"; // 'PROPOSED' reserved for Phase 2

export type BrainMemorySource =
  | "manual-chat"
  | "plus-menu"
  | "note"
  | "email"
  | "task"
  | "event";

export type DecisionStatus = "active" | "reversed" | "archived";

export type TriageState = "sorted" | "unsorted";

export interface BrainMemoryData {
  category: BrainMemoryCategory;
  state: BrainMemoryState;
  text: string;
  why?: string; // decisions, optional
  date?: string; // yyyy-mm-dd, decisions (auto-filled)
  status?: DecisionStatus; // decisions; default 'active'
  linkedItemIds?: string[]; // decisions filed from a task/event
  source: BrainMemorySource;
  wordCount?: number; // voice only
  pinned?: boolean;
}

/** A brain_memory row: table fields + data payload. */
export interface BrainMemoryRow {
  id: string;
  data: BrainMemoryData;
  created_at: string;
  updated_at: string;
}

/** Triage fields merged into a person row's `data` jsonb. */
export interface PersonTriageData {
  roles: string[];
  roleNote?: string;
  triageState: TriageState;
  source?: "email" | "calendar" | "import" | "manual";
}

export const BRAIN_ROLES = [
  "family",
  "friend",
  "work",
  "bridge",
  "vendor",
  "other",
] as const;
export type BrainRole = (typeof BRAIN_ROLES)[number];

/** Chat trigger phrases for "log it: …". Ordered longest-first so the
 *  longest match wins. Matching is case-insensitive, prefix of message. */
export const FILING_TRIGGERS = [
  "log this decision",
  "file this as",
  "save this as",
  "remember that",
  "remember this",
  "log this",
  "log it",
] as const;

/** Whole memory block budget, chars (~4 chars/token). Spec §3.5. */
export const MEMORY_BUDGET_CHARS = 12000;
/** Philosophy / values are always included in full up to these caps. */
export const PHILOSOPHY_CAP_CHARS = 2000;
export const VALUES_CAP_CHARS = 2000;
/** Voice samples: cap count, minimum words to be worth saving. */
export const VOICE_SAMPLE_CAP = 5;
export const VOICE_MIN_WORDS = 50;
/** Retrieval: keyword-overlap score needed to surface a decision/person. */
export const RETRIEVAL_MIN_SCORE = 2;
export const RETRIEVAL_TOP_K = 3;
/** Confirm-toast Undo window. */
export const UNDO_MS = 8000;

const CATEGORY_LABELS: Record<BrainMemoryCategory, string> = {
  decision: "Decisions",
  philosophy: "Philosophy",
  value: "Values",
  voice: "How You Write",
  fact: "What JARVIS Knows",
};

/** "Philosophy", "Values", … — used in toasts and page headers. */
export function categoryLabel(c: BrainMemoryCategory): string {
  return CATEGORY_LABELS[c];
}

/** "Saved to Philosophy ✓" */
export function filedToastText(c: BrainMemoryCategory): string {
  return `Saved to ${categoryLabel(c)} ✓`;
}

/** Strip the trigger phrase from a chat message, returning the remainder. */
export function stripTrigger(message: string): string | null {
  const lower = message.trim().toLowerCase();
  for (const t of FILING_TRIGGERS) {
    if (lower.startsWith(t)) {
      const rest = message.trim().slice(t.length).trim().replace(/^[:\-–—]\s*/, "");
      return rest;
    }
  }
  return null;
}

/** True when a chat message asks to file something. */
export function isFilingMessage(message: string): boolean {
  return stripTrigger(message) !== null;
}
