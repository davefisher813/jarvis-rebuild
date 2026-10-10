// Provenance (session addendum item 8, built first: Smart Paste, Where You
// Were, Auto-Sweep receipts, and the native seven all depend on it).
//
// Every AUTO-CREATED entity carries source {type, ref?, ts}: what created it,
// what it came from, and when. Hand-made entities carry no source and render
// no line. The line is one meta fact under the title; tapping it opens the
// source when ref resolves to something the app can show. Provenance lines
// are facts, not editable (editing coverage map, refusals).
//
// The field lives inside the entity's JSONB data, so no migration is needed
// (same precedent as projectId and bill on TaskData).

import { shortDateFromMs } from "./dateFormat";

export type SourceType =
  | "paste"
  | "note"
  | "email"
  | "recorder"
  | "chat"
  | "file"
  | "plan"
  // UP-CORE-08 (2026-09-05): a note made FOR a calendar event, from its row
  // or the Now card. Its ref is the event id, so the line opens the meeting.
  | "event"
  // TRACE-01 (2026-09-07): a calendar block Add to Schedule made out of a
  // task. The block already links back through sourceTaskId; this is the
  // half a person can read on the row, so an hour that appeared on Tuesday
  // says where it came from instead of looking hand-drawn.
  | "task"
  | "sweep"
  | "reflow"
  | "google_calendar"
  | "gmail"
  | "apple_health"
  // UP-ATH-10 (2026-09-06): a block, event, task or reminder the health
  // module's own offers made. The health screens are the one place in the
  // app that creates something on the athlete's behalf from a fact about
  // their week, so the row says where it came from.
  | "health"
  | "apple_calendar"
  | "apple_reminders"
  | "contacts"
  // Phase 0 D3 (2026-10-10): a record another app pushed through the VYZN
  // feed and the person approved from the inbox. ref is '<app>:<record_id>'.
  | "app"
  // Phase 0 D3: a bulk import (a contact file, a bank export) with no finer
  // origin to name. Neither of these has a route (openSource.ts): nothing in
  // the app to open, so the line is a plain fact.
  | "import";

export interface Source {
  type: SourceType;
  // Id of the originating entity or external record, when one exists.
  ref?: string;
  // Epoch ms at creation. Facts carry their time.
  ts: number;
  // Phase 0 D3 (2026-10-10): the fields a RULE filled in rather than the
  // person or the origin stating them (classifyLine guessing personId from a
  // first name). A fact, not a verdict: confidenceOf() derives the word.
  // Absent or empty means nothing was guessed.
  inferred?: string[];
}

/** The same stamp with the guessed fields recorded. An empty list leaves the
 *  stamp untouched, so a stamp that guessed nothing is byte identical to one
 *  made before this field existed (about 25 assertions pin madeBy("paste")). */
export function withInferred(source: Source, fields: readonly string[]): Source {
  return fields.length ? { ...source, inferred: [...fields] } : source;
}

// Phase 0 D3: the types that mean "this came from outside the app". The type
// is the fact; the word below is derived from it, never stored.
const IMPORTED: ReadonlySet<SourceType> = new Set<SourceType>([
  "app", "import", "google_calendar", "contacts", "gmail", "apple_calendar", "apple_reminders", "apple_health",
]);

/** How far to trust a source: a rule guessed part of it (inferred), it came
 *  from outside (imported), or the person or the origin stated it (stated).
 *  Nothing renders this word in Phase 0; the three display words stay Dave's. */
export function confidenceOf(source: Source): "stated" | "imported" | "inferred" {
  if (source.inferred && source.inferred.length > 0) return "inferred";
  if (IMPORTED.has(source.type)) return "imported";
  return "stated";
}

// Sentence-case labels (the line talks; it is not a button label). Feature
// names keep their proper casing.
const LABEL: Record<SourceType, string> = {
  paste: "From Smart Paste",
  note: "From a note",
  email: "From an email",
  recorder: "From the recorder",
  chat: "From chat",
  file: "From a file",
  plan: "From your day plan",
  task: "From a task",
  event: "From your calendar",
  sweep: "Moved by Auto-Sweep",
  reflow: "Moved by re-flow",
  google_calendar: "From Google Calendar",
  gmail: "From Gmail",
  apple_health: "From Apple Health",
  health: "From your health screens",
  apple_calendar: "From Apple Calendar",
  apple_reminders: "From Apple Reminders",
  contacts: "From Contacts",
  app: "From another app",
  import: "From an import",
};

// Phase 0 D3 (2026-10-10): ONE READ-TIME MAP FROM EVERY MODULE'S OWN SOURCE
// SHAPE TO THE ONE Source. Five modules grew their own way of saying where a
// row came from before this file existed, and BillDetailSheet.tsx converted
// one of them by hand to render a line. This is that conversion written once,
// for all five, so a second sheet cannot convert the same shape differently.
// Nothing is stamped or backfilled: the module shapes stay what they are and
// are read into Source here (no stamp on hand made rows; no backfill on the
// bulk imported persons, Dave 2026-09-28).
//
//   person          data.source: "email" | "calendar" | "event" | "import" | "manual"
//   brain_memory    data.source: BrainMemorySource (ai/brainMemory.ts)
//   decision_record data.source: DecisionSource {kind, entityId?, at}
//   money_bill, money_receipt, money_tx
//                   data.source: "manual" | "camera" | "import" | EmailSource {type, fingerprint, ref?}
//                   with the when read from history[0].at, as BillDetailSheet did
//   everything else data.source is already a Source and comes back as is
//
// A hand made row ("manual", a filing from the Brain tab or the plus menu, a
// receipt photographed by the person) answers undefined, the same way a hand
// typed task carries no source. A shape with no when (a person, a brain
// memory, a transaction without history) answers ts 0, the convention
// BillDetailSheet already used for a bill with no history; a caller that
// renders a when should treat 0 as none.
//
// Callers: BillDetailSheet.tsx (the first, by design choice). The next, when
// a surface needs the line: the person sheet, the memory detail, the decision
// Source card, the receipt and transaction sheets.
//
// The entity type literals here are pinned to the registry constants by
// provenance.test.ts, so this file stays free of module imports.
const PERSON_SOURCE: Record<string, SourceType | undefined> = {
  email: "email",
  calendar: "event",
  event: "event",
  import: "import",
  manual: undefined,
};
const BRAIN_SOURCE: Record<string, SourceType | undefined> = {
  "manual-chat": "chat",
  "plus-menu": undefined,
  brain: undefined,
  note: "note",
  email: "email",
  task: "task",
  event: "event",
};
const DECISION_SOURCE: Record<string, SourceType | undefined> = {
  chat: "chat",
  note: "note",
  email: "email",
  manual: undefined,
};

type Shape = Record<string, unknown>;

function isSource(v: unknown): v is Source {
  return !!v && typeof v === "object" && typeof (v as Shape).type === "string" && typeof (v as Shape).ts === "number";
}

function whenOf(iso: unknown): number {
  return typeof iso === "string" ? Date.parse(iso) || 0 : 0;
}

function stamp(type: SourceType | undefined, ref: unknown, ts: number): Source | undefined {
  if (!type) return undefined;
  return { type, ...(typeof ref === "string" && ref ? { ref } : {}), ts };
}

export function sourceOf(entityType: string, data: unknown): Source | undefined {
  if (!data || typeof data !== "object") return undefined;
  const src = (data as Shape).source;
  if (src === undefined || src === null) return undefined;
  switch (entityType) {
    case "person":
      return typeof src === "string" ? stamp(PERSON_SOURCE[src], undefined, 0) : undefined;
    case "brain_memory":
      return typeof src === "string" ? stamp(BRAIN_SOURCE[src], undefined, 0) : undefined;
    case "decision_record": {
      if (typeof src !== "object") return undefined;
      const d = src as Shape;
      return typeof d.kind === "string" ? stamp(DECISION_SOURCE[d.kind], d.entityId, whenOf(d.at)) : undefined;
    }
    case "money_bill":
    case "money_receipt":
    case "money_tx": {
      const history = (data as Shape).history;
      const first = Array.isArray(history) ? (history[0] as Shape | undefined) : undefined;
      const ts = whenOf(first?.at);
      if (src === "import") return stamp("import", undefined, ts);
      if (typeof src === "object" && (src as Shape).type === "email") return stamp("email", (src as Shape).ref, ts);
      // "manual" and "camera": the person made it.
      return undefined;
    }
    default:
      return isSource(src) ? src : undefined;
  }
}

// Build the source stamp for an auto-created entity, timestamped now.
export function madeBy(type: SourceType, ref?: string, now: () => number = Date.now): Source {
  return { type, ...(ref ? { ref } : {}), ts: now() };
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// UP-CORE-05 (2026-09-05): WHICH LINE A ROW SHOWS. A thing can carry both
// where it came from and an automated move, and they are different facts.
// Auto-Sweep moves are kept internal (for UI state) but never displayed;
// other moves made TODAY answer "why is this here?"; older moves are history,
// so the origin comes back. One rule, so a task row, an event row and a sheet
// cannot each answer it differently.
export function rowSource(source: Source | undefined, moved: Source | undefined, now: () => number = Date.now): Source | undefined {
  if (moved && moved.type !== "sweep" && sameDay(new Date(moved.ts), new Date(now()))) return moved;
  return source;
}

// The WHEN half of the fact: "2:14 PM" today, "Aug 12" earlier. Null exactly
// where sourceLabel() is null, so the two halves never disagree about whether
// a line exists. A rendered line puts this in its own `.fact.date` span beside
// the label; the separator between them is drawn by CSS, not typed (§AM F3).
export function sourceWhen(source: Source | undefined, now: () => number = Date.now): string | null {
  if (!sourceLabel(source) || !source) return null;
  const d = new Date(source.ts);
  return sameDay(d, new Date(now()))
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : shortDateFromMs(source.ts);
}

// There is no joined "label · when" string (2026-09-26). sourceLine() made
// one, and nothing but two tests called it: a formatter with a middot baked
// in, kept alive for text that never rendered. A line is sourceLabel() and
// sourceWhen() as two facts, the separator drawn by CSS (§AM F3), which is
// what ProvenanceLine does.

/** The same fact with the WHEN left off, for a row that has to share one line
 *  with everything else it carries (2026-09-09, when provenance moved onto the
 *  task row's meta line to stop being a third line).
 *  It is the cue's own bargain, one section over in TasksPage: the row carries
 *  the half you recognise at a glance and the sheet carries the sentence. "From
 *  an email" is what makes a row make sense; the date is what you check once,
 *  deliberately, and that is a sheet's job. It is also the difference between a
 *  fact that fits beside a category and one that does not -- measured at 390,
 *  "From an email · Sep 2" left the line and "From an email" stayed on it. */
export function sourceLabel(source: Source | undefined): string | null {
  // Auto-Sweep receipts render nothing. That a task moved is kept internal;
  // the row shows where it came from instead.
  if (!source || !LABEL[source.type]) return null;
  if (source.type === "sweep") return null;
  return LABEL[source.type];
}
