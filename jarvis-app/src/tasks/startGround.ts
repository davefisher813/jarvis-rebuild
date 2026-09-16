import type { TaskData } from "../notes/types";
import type { StartContext, StartSource, StartTarget, StartDestination } from "./startAction";
import { fmtTime } from "../schedule/calendar";
import { dayPhrase } from "../money/bills";

// THE GROUNDING (Start Now, 2026-09-16).
//
// startAction.ts is pure and refuses to invent. This is the layer that goes
// and reads the real records, so what it hands over is the difference
// between "Editable message ready" and a sentence the app made up.
//
// Everything here is derived, never guessed:
//   - the linked record is a record whose id is stored ON the task, and the
//     caller has already confirmed it loaded
//   - a draft's lines are the event's real day and time and the sender's
//     real name, and a field the record does not carry becomes a NAMED HOLE
//     rather than a plausible invention
//   - nothing is written, by anything in this file
//
// The named-hole rule is the one that matters. The alternative, filling in
// "at the usual place", is how an app ends up sending eleven people to the
// wrong field.

/** What a caller managed to load. Every field is optional because every one
 *  of them is a link that may be dangling, and a dangling link is a hole,
 *  never a reason to make something up. */
export interface StartRecords {
  note?: { id: string; title: string } | null;
  event?: { id: string; title: string; date: string; start?: string; location?: string } | null;
  thread?: { id: string; subject: string; fromEmail?: string } | null;
  project?: { id: string; title: string } | null;
  /** Who this is about, when the task carries a real contact id. */
  person?: { id: string; name: string } | null;
}

/** Which links a task claims to have. The caller loads exactly these and no
 *  more, so a start never fetches the world to open one text box. */
export function linksOf(data: TaskData | undefined): {
  noteId?: string; eventId?: string; threadId?: string; projectId?: string; personId?: string;
} {
  if (!data) return {};
  return {
    ...(data.fromNote ? { noteId: data.fromNote } : {}),
    ...(data.eventId ? { eventId: data.eventId } : {}),
    ...(data.fromThread ? { threadId: data.fromThread } : {}),
    ...(data.projectId ? { projectId: data.projectId } : {}),
    ...(data.personId ? { personId: data.personId } : {}),
  };
}

/**
 * The record this task should OPEN, when opening beats writing.
 *
 * Order is by how much of the work the record actually carries: the note
 * somebody wrote about it, then the event it hangs off, then the thread it
 * came from, then the bill's own pay page. A project is deliberately not in
 * here: a task's project is context on the screen, not somewhere to be sent
 * instead of doing the task.
 *
 * Null when the task is a thing to WRITE rather than a thing to open, which
 * is what sends the resolver on to the draft.
 */
export function resourceFor(
  data: TaskData | undefined,
  records: StartRecords,
  shapeIsComms: boolean,
): { kind: StartDestination["kind"]; id: string; label: string } | null {
  if (records.note) return { kind: "note", id: records.note.id, label: records.note.title };
  // A message task that hangs off an event wants the event's FACTS, not the
  // event's screen: it is grounding for the draft, and groundingFor takes
  // it from here. Anything else about an event opens the event.
  if (records.event && !shapeIsComms) {
    return { kind: "event", id: records.event.id, label: records.event.title };
  }
  if (records.thread && !shapeIsComms) {
    return { kind: "thread", id: records.thread.id, label: records.thread.subject };
  }
  const payUrl = data?.bill?.payUrl;
  if (payUrl) return { kind: "url", id: payUrl, label: "The pay page" };
  return null;
}

/**
 * The prepared message, out of records only.
 *
 * It states what the linked event really says and leaves a NAMED hole for
 * anything it does not. The holes travel separately so the screen can show
 * them as what they are, rather than burying "[location]" in a paragraph
 * and hoping somebody notices before they hit send.
 */
export function groundingFor(
  target: StartTarget,
  records: StartRecords,
  today: string,
): { lines: string[]; sources: StartSource[]; missing: string[] } {
  const lines: string[] = [];
  const sources: StartSource[] = [];
  const missing: string[] = [];

  const ev = records.event;
  if (ev) {
    sources.push({ kind: "event", id: ev.id, label: "Source: " + ev.title });
    const when = ev.start
      ? dayPhrase(ev.date, today) + " at " + fmtTime(ev.start).time + " " + fmtTime(ev.start).ap
      : dayPhrase(ev.date, today);
    lines.push("Hi everyone,");
    lines.push(capitalize(ev.title) + " is " + lowerFirst(when) + ".");
    if (ev.location) lines.push("Where: " + ev.location);
    else missing.push("Location still needed");
  } else if (records.note) {
    sources.push({ kind: "note", id: records.note.id, label: "Source: " + records.note.title });
  }

  if (records.person) {
    sources.push({ kind: "person", id: records.person.id, label: "To " + records.person.name });
  } else if (isGroupSend(target.title)) {
    // A task that says "team" names no one person, and guessing a roster is
    // exactly the fabrication this file exists to refuse.
    missing.push("Recipients still needed");
  }

  return { lines, sources, missing };
}

/** "Send team practice details" is a send to a group the app does not hold
 *  a list for. Deliberately narrow: only the words that plainly mean many. */
const GROUP = /\b(team|everyone|group|squad|parents|class|staff|all)\b/i;
export function isGroupSend(title: string): boolean {
  return GROUP.test(title);
}

/**
 * The whole context for one task, assembled from what a caller loaded.
 * Pure: give it the same records twice and it answers the same way twice.
 */
export function contextFor(
  target: StartTarget,
  opts: {
    records?: StartRecords;
    saved?: StartContext["saved"];
    children?: StartContext["children"];
    today: string;
    shapeIsComms: boolean;
  },
): StartContext {
  const records = opts.records ?? {};
  const resource = resourceFor(target.data, records, opts.shapeIsComms);
  const grounding = groundingFor(target, records, opts.today);
  return {
    saved: opts.saved ?? null,
    ...(opts.children?.length ? { children: opts.children } : {}),
    resource,
    ...(records.thread?.fromEmail ? { fromEmailAddress: records.thread.fromEmail } : {}),
    grounding,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
