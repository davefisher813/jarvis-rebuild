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
  | "contacts";

export interface Source {
  type: SourceType;
  // Id of the originating entity or external record, when one exists.
  ref?: string;
  // Epoch ms at creation. Facts carry their time.
  ts: number;
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
};

// Build the source stamp for an auto-created entity, timestamped now.
export function madeBy(type: SourceType, ref?: string, now: () => number = Date.now): Source {
  return { type, ...(ref ? { ref } : {}), ts: now() };
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// UP-CORE-05 (2026-09-05): WHICH LINE A ROW SHOWS. A thing can carry both
// where it came from and an automated move, and they are different facts.
// A move made TODAY is the one that answers the question the person is
// actually asking ("why is this here?"); an older move is history nobody is
// looking for, so the origin comes back. One rule, so a task row, an event
// row and a sheet cannot each answer it differently.
export function rowSource(source: Source | undefined, moved: Source | undefined, now: () => number = Date.now): Source | undefined {
  if (moved && sameDay(new Date(moved.ts), new Date(now()))) return moved;
  return source;
}

// "From Smart Paste · 2:14 PM" today, "From Smart Paste · Aug 12" earlier.
// Null for a missing or unknown source so callers can render nothing.
export function sourceLine(source: Source | undefined, now: () => number = Date.now): string | null {
  if (!source || !LABEL[source.type]) return null;
  const d = new Date(source.ts);
  const when = sameDay(d, new Date(now()))
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : shortDateFromMs(source.ts);
  return `${LABEL[source.type]} · ${when}`;
}
