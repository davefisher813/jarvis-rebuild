// DOC AI (build order 2026-10-23, Dave's six laws). Upload or photograph a document, JARVIS reads it, works out what it is, proposes the
// records it holds, and files them only when Dave confirms. These are the shapes every stage shares. Pure types, no behaviour.

/** Where a document is in its life. Forward-only except a manual retry. Plain words for each live in lifecycle.ts. */
export type DocState =
  | "uploading" | "stored" | "reading" | "read" | "read-partial" | "unreadable"
  | "extracting" | "proposed" | "filed" | "failed";

/** The closed list of document kinds (grown one at a time). `bill`, `schedule` and `general` are Phase 1. */
export type DocKind = "bill" | "schedule" | "task-list" | "letter" | "receipt" | "general";
export const PHASE1_KINDS: readonly DocKind[] = ["bill", "schedule", "general"];

/** LAW 4: every field says how it is known. Amounts and dates may never be "inferred". */
export type Basis = "stated" | "computed" | "inferred";

/** solid: every deterministic check passed. uncertain: kept out of the batch, with a reason. dropped: not shown as a fact at all. */
export type Tier = "solid" | "uncertain" | "dropped";

/** What the model returns for one field (LAW 5): a value, the exact words it came from, the page, and how it is known. */
export interface FieldEnvelope {
  key: string;
  value: string;
  quote: string;
  page: number | null;
  basis: Basis;
}

/** An envelope after the deterministic checks. `offsets` is where the quote sits in the document text (for the highlight). */
export interface VerifiedField extends FieldEnvelope {
  tier: Tier;
  /** Plain words for why a field is uncertain or dropped. Empty for a solid one. */
  reasons: string[];
  offsets: { start: number; end: number } | null;
}

/** One record the document holds: a bill, one event on a schedule, one dated item. */
export interface ExtractedItem {
  group: string;
  fields: VerifiedField[];
}

/** Two slices of a long document disagreed about a money or date field. Never resolved by code: Dave sees both. */
export interface FieldConflict {
  key: string;
  group: string;
  candidates: { value: string; quote: string; page: number | null }[];
}

export interface ExtractionResult {
  kind: DocKind;
  /** The model's honest answer to "is there anything here to do?". An empty result is a success. */
  actionable: boolean;
  items: ExtractedItem[];
  conflicts: FieldConflict[];
  /** Pages that were not extracted from (LAW 5: partial is stated as partial, with the pages named). */
  missingPages: number[];
  /** Fields the checks dropped, counted so abstention and hallucination can be measured apart. */
  droppedCount: number;
}

/** The text of a document, with where each page starts (so a quote finds its page by code, not by the model's word). */
export interface DocText {
  text: string;
  pages: { page: number; start: number; end: number }[];
  words: number;
  lane: "text-layer" | "device-ocr" | "ai-read";
  /** Pages that could not be read, named. Empty means the read is whole. */
  failedPages: number[];
}

/** The block that rides the file row (FileData.doc). */
export interface DocBlock {
  state: DocState;
  kind?: DocKind;
  /** Where it went, in words: "Bill in Money". Set only by filing. */
  filedTo?: string;
  proposalId?: string;
  /** A plain-language reason, shown on the row. */
  error?: string;
  /** A machine code the row's wording and retry rules key on. */
  errorCode?: DocErrorCode;
  pages?: number;
  words?: number;
  /** AI Off, the pin Off, or On Request: the document was read but not reviewed. */
  notReviewed?: boolean;
  /** The AI gate, caps or budget said not now. The job is pending, not failed. */
  waiting?: boolean;
  /** Pages the read or the extraction did not reach, named (law 5: partial is stated as partial). */
  missingPages?: number[];
}

export type DocErrorCode =
  | "CREDIT" | "OUTCOME_UNKNOWN" | "PARSER" | "STORAGE" | "SCHEMA" | "UPSTREAM" | "WORKER" | "NO_TEXT" | "BUSY" | "TOO_LARGE" | "ENCRYPTED";
