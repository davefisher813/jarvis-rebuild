// Brain Manual v1 (Phase 1): shared contracts.
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
  | "event"
  // Filed from a Brain tab page itself (the empty-state sheets, the
  // philosophy/value/voice lists). The closest existing value would be
  // "plus-menu", but the detail screen's "Filed from" line should say where
  // the row really came from.
  | "brain";

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
  // Supersede links (Decisions Revisit). The old row is archived, never
  // deleted: it carries supersededBy -> the new row's id, and the new row
  // carries supersedes -> the old row's id. Readers show the live row and
  // reach the archived one through the link.
  supersededBy?: string;
  supersedes?: string;
}

/** A brain_memory row: table fields + data payload. */
export interface BrainMemoryRow {
  id: string;
  data: BrainMemoryData;
  created_at: string;
  updated_at: string;
}

/** Triage fields merged into a person row's `data` jsonb.
 *
 * NOTE on `roles`: person rows already carry `roles` for the per-area role
 * editor (PersonRole[]: {categoryId, role}). The triage roles (BRAIN_ROLES
 * strings) share the same key, so a row can hold both shapes at once and
 * every reader must discriminate with `typeof r === "string"`. The triage
 * screen preserves the object entries when it writes; the person sheet
 * preserves the string entries when it saves. */
export interface PersonTriageData {
  roles: string[];
  roleNote?: string;
  triageState: TriageState;
  // "event": a guest added from a calendar event (the Schedule "Who Is
  // This?" flow). Distinct from "calendar" (a contact that arrived with a
  // calendar import) the way BrainMemorySource keeps both.
  source?: "email" | "calendar" | "event" | "import" | "manual";
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

/** "Philosophy", "Values", ...: used in toasts and page headers. */
export function categoryLabel(c: BrainMemoryCategory): string {
  return CATEGORY_LABELS[c];
}

/** "Saved to Philosophy ✓" */
export function filedToastText(c: BrainMemoryCategory): string {
  return `Saved to ${categoryLabel(c)} ✓`;
}

// "Who Is This?" ends on a contact, not a brain_memory row, but the same
// confirm-toast shape applies -- shared so every surface names it once.
export function filedContactToastText(): string {
  return "Saved to Contacts ✓";
}

/** Title Case source labels for the memory detail screen's "Filed from" line. */
export const BRAIN_SOURCE_LABEL: Record<BrainMemorySource, string> = {
  "manual-chat": "Brain Chat",
  "plus-menu": "Quick Add",
  note: "A Note",
  email: "An Email",
  task: "A Task",
  event: "An Event",
  brain: "The Brain Tab",
};

/** "Filed From Brain Chat" -- the detail screen's provenance line. */
export function filedFromLabel(source: BrainMemorySource): string {
  return BRAIN_SOURCE_LABEL[source] ?? "The Brain Tab";
}

/** The em-dash code point, built numerically: the no-em-dash law bans the
 *  character itself in source, but users still type em dashes, so the
 *  trigger parser has to strip them. */
const EM_DASH = String.fromCharCode(0x2014);

/** Strip the trigger phrase from a chat message, returning the remainder. */
export function stripTrigger(message: string): string | null {
  const lower = message.trim().toLowerCase();
  for (const t of FILING_TRIGGERS) {
    if (lower.startsWith(t)) {
      const rest = message.trim().slice(t.length).trim().replace(new RegExp(`^[:\\-–${EM_DASH}]\\s*`), "");
      return rest;
    }
  }
  return null;
}

/** True when a chat message asks to file something. */
export function isFilingMessage(message: string): boolean {
  return stripTrigger(message) !== null;
}
