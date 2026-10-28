import { titleCase } from "../shared/casing";
import type { SavedEntity } from "./smartPaste";
import type { TasksService } from "../tasks/TasksService";
import type { ScheduleService } from "../schedule/ScheduleService";

// A CORRECTION EDITS THE ITEM JUST CAPTURED; IT IS NEVER A NEW ITEM (Dave, 2026-10-27). He captured "Text Josh Rudd", saw it filed under
// the wrong contact, typed "no, Josh Rudd", and the correction was saved as a second task. Right after a capture, a line that starts by
// rejecting or restating the filing is read here first, and the capture lane never sees it.
//
// What a correction can change, and nothing else:
//   - the person: the words after the lead-in are EXACTLY a contact's name or alias (a first name alone is not enough, and two contacts
//     that answer equally name nobody), or "no one" / "nobody" to take the person off;
//   - the title of a task, only when the lead-in itself says so ("I meant ...", "should be ...", "change it to ...");
//   - anything else is "unresolved": nothing is edited AND nothing is saved, so the thread says so and offers the manual Save buttons.

export type Correction =
  | { kind: "person"; personId: string; name: string }
  | { kind: "unlink" }
  | { kind: "retitle"; title: string }
  | { kind: "unresolved" };

export interface Lead { how: "reject" | "say"; rest: string }

const REJECT_WORD = "(?:no|nope|nah|wrong|not (?:him|her|them|that one|that person))";
// "no," / "No." / "nope -" : the punctuation is what makes it a rejection, so "No meeting Friday" stays a capture.
const REJECT = new RegExp(`^\\s*${REJECT_WORD}\\s*[,.:;!\\-]+\\s*(.*)$`, "is");
const REJECT_ALONE = new RegExp(`^\\s*${REJECT_WORD}\\s*[.!]*\\s*$`, "i");
const SAY = /^\s*(?:i meant|i mean|it should be|should be|should have been|should've been|change (?:it|that) to|make (?:it|that)|rename (?:it|that) to)\s*[,:]?\s+(.+)$/is;

/** Does this line open like a correction? Cheap and synchronous, so the caller reads the contacts only when it does. */
export function correctionLead(text: string): Lead | null {
  const t = (text ?? "").trim();
  if (!t || t.length > 140 || t.includes("\n")) return null;
  const say = SAY.exec(t);
  if (say) return { how: "say", rest: say[1]!.trim() };
  if (REJECT_ALONE.test(t)) return { how: "reject", rest: "" };
  const rej = REJECT.exec(t);
  if (rej) return { how: "reject", rest: rej[1]!.trim() };
  return null;
}

const NOBODY = /^(?:no ?one|nobody|none|no person|nothing)$/i;
const trimEnd = (s: string) => s.replace(/[\s.!?,;:]+$/g, "").trim();
const strip = (s: string) => trimEnd(s).replace(/^(?:it'?s|its|it is|that'?s|that is|for|with|about)\s+/i, "").trim();

export function resolveCorrection(lead: Lead, people: { id: string; name: string; aliases?: string[] }[]): Correction {
  const rest = trimEnd(lead.rest);
  if (!rest) return { kind: "unresolved" };
  if (NOBODY.test(rest)) return { kind: "unlink" };
  const said = strip(rest).toLowerCase();
  const hits = people.filter((p) => [p.name, ...(p.aliases ?? [])].some((n) => n.trim().toLowerCase() === said));
  if (hits.length === 1) return { kind: "person", personId: hits[0]!.id, name: hits[0]!.name };
  if (hits.length > 1) return { kind: "unresolved" };
  if (lead.how === "say") return { kind: "retitle", title: titleCase(rest) };
  return { kind: "unresolved" };
}

export interface FixDeps {
  tasks: Pick<TasksService, "setPerson" | "editText">;
  schedule: Pick<ScheduleService, "editPerson">;
}

export interface Fixed {
  entity: SavedEntity;
  /** The thread's line. */
  words: string;
  undo: () => Promise<void>;
}

/** Apply a resolved correction to the item it is about. Null when the item cannot take it (nothing was written). */
export async function applyCorrection(c: Correction, s: SavedEntity, deps: FixDeps): Promise<Fixed | null> {
  if (c.kind === "unresolved") return null;
  if (s.kind === "task") {
    const prevPerson = s.personId ?? null;
    if (c.kind === "person") {
      if (!(await deps.tasks.setPerson(s.id, c.personId))) return null;
      return { entity: { ...s, personId: c.personId }, words: `Fixed: ${s.title} · With ${c.name}`, undo: async () => { await deps.tasks.setPerson(s.id, prevPerson); } };
    }
    if (c.kind === "unlink") {
      if (!(await deps.tasks.setPerson(s.id, null))) return null;
      const { personId: _p, ...rest } = s;
      return { entity: rest, words: `Fixed: ${s.title} · Person Taken Off`, undo: async () => { await deps.tasks.setPerson(s.id, prevPerson); } };
    }
    const prevTitle = s.title;
    if (!(await deps.tasks.editText(s.id, c.title))) return null;
    return { entity: { ...s, title: c.title }, words: `Fixed: ${c.title}`, undo: async () => { await deps.tasks.editText(s.id, prevTitle); } };
  }
  if (s.kind === "event") {
    const prevPerson = s.personId ?? null;
    if (c.kind === "person") {
      if (!(await deps.schedule.editPerson(s.id, c.personId))) return null;
      return { entity: { ...s, personId: c.personId }, words: `Fixed: ${s.title} · With ${c.name}`, undo: async () => { await deps.schedule.editPerson(s.id, prevPerson); } };
    }
    if (c.kind === "unlink") {
      if (!(await deps.schedule.editPerson(s.id, null))) return null;
      const { personId: _p, ...rest } = s;
      return { entity: rest, words: `Fixed: ${s.title} · Person Taken Off`, undo: async () => { await deps.schedule.editPerson(s.id, prevPerson); } };
    }
  }
  return null;
}
