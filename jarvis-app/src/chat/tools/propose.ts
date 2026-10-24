// THE TIER 1 TOOLS, AS PROPOSALS (chat box order, 2026-10-24). When the model asks for a write, this is what answers: it reads the record as it
// is NOW, checks the request against it, and returns the content of a card. It changes nothing, and it is handed nothing that could: ProposeDeps
// is two read functions. Making the change is execute.ts, which a proposal reaches only through the person's tap (proposals.ts, approve).
//
// A proposal is judged against the record, not against the model's account of it. An update to a task that is gone or already done, or that
// would change nothing, is refused here with the reason, and the model is told so it can say so instead of putting up a card that cannot work.

import type { TaskData } from "../../notes/types";
import { ToolFailure } from "./dispatcher";
import { plain, type Priority, type ProposalContent } from "./proposals";
import type { WriteToolName } from "./registry";

export interface ProposeDeps {
  task(id: string): Promise<TaskData | null>;
  person(id: string): Promise<{ name: string } | null>;
}

export type Proposer = (input: Record<string, unknown>) => Promise<ProposalContent>;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day, not just something shaped like one (2026-02-31). */
function realDay(s: string): boolean {
  if (!DAY.test(s)) return false;
  const d = new Date(s + "T12:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// New words are made plain before they are hashed (proposals.ts, plain): the card shows exactly what would be saved.
function clean(s: unknown): string {
  return typeof s === "string" ? plain(s) : "";
}

// "task:abc" -> "abc", only for the kind asked for.
function idOf(ref: unknown, kind: string): string {
  const s = typeof ref === "string" ? ref : "";
  const i = s.indexOf(":");
  if (i < 0 || s.slice(0, i) !== kind) throw new ToolFailure("bad_ref", `That ref is not a ${kind}.`);
  return s.slice(i + 1);
}

export function makeProposers(deps: ProposeDeps): Record<WriteToolName, Proposer> {
  const create_task: Proposer = async (input) => {
    const text = clean(input.text);
    if (!text) throw new ToolFailure("bad_input", "The task has no words.");
    const due = input.due === undefined ? undefined : String(input.due);
    if (due !== undefined && !realDay(due)) throw new ToolFailure("bad_input", "That is not a real date.");
    const priority = input.priority === "high" || input.priority === "low" ? (input.priority as Priority) : undefined;
    let personId: string | undefined;
    let personName: string | undefined;
    if (input.person_ref !== undefined) {
      personId = idOf(input.person_ref, "person");
      const p = await deps.person(personId);
      if (!p) throw new ToolFailure("not_found", "That person is no longer in Contacts.");
      personName = p.name;
    }
    return { kind: "create_task", text, ...(due ? { due } : {}), ...(priority ? { priority } : {}), ...(personId ? { personId, personName } : {}) };
  };

  const update_task: Proposer = async (input) => {
    const taskId = idOf(input.ref, "task");
    const t = await deps.task(taskId);
    if (!t) throw new ToolFailure("not_found", "That task no longer exists.");
    if (t.done) throw new ToolFailure("already_done", "That task is already done.");
    // A bill is paid and moved in Money, and a reminder is ticked, snoozed and skipped from the Reminders list: each has writes of its own that a
    // plain task edit would go around (a payment has to file its transaction). Chat leaves both to the screens that own them.
    if (t.bill) throw new ToolFailure("is_bill", "That task is a bill, and bills are changed in Money.");
    if (t.reminder) throw new ToolFailure("is_reminder", "That task is a reminder, and reminders are changed from the Reminders list.");
    if (input.due !== undefined && input.clear_due === true) throw new ToolFailure("bad_input", "Give a new due date or clear it, not both.");
    if (input.mark_done === false) throw new ToolFailure("bad_input", "mark_done can only be true.");

    const basis = { text: t.text, due: t.due ?? null, done: false, priority: (t.priority ?? null) as Priority | null };
    const change: { due?: string | null; done?: true; text?: string; priority?: Priority | null } = {};
    if (input.mark_done === true) change.done = true;
    if (input.due !== undefined) {
      const due = String(input.due);
      if (!realDay(due)) throw new ToolFailure("bad_input", "That is not a real date.");
      if (due !== basis.due) change.due = due;
    }
    if (input.clear_due === true && basis.due !== null) change.due = null;
    if (input.text !== undefined) {
      const text = clean(input.text);
      if (!text) throw new ToolFailure("bad_input", "The new words are empty.");
      if (text !== basis.text) change.text = text;
    }
    if (input.priority !== undefined) {
      const p = input.priority === "none" ? null : (input.priority as Priority);
      if (p !== basis.priority) change.priority = p;
    }
    // A change that is already true is not a change. If nothing is left the card would do nothing, so there is no card.
    if (Object.keys(change).length === 0) throw new ToolFailure("nothing_to_change", "That would not change anything about this task.");
    return { kind: "update_task", taskId, title: t.text, basis, change };
  };

  const capture_decision: Proposer = async (input) => {
    const decision = clean(input.decision);
    if (!decision) throw new ToolFailure("bad_input", "The decision has no words.");
    const why = clean(input.why);
    const ruledOut = clean(input.ruled_out);
    return { kind: "capture_decision", decision, ...(why ? { why } : {}), ...(ruledOut ? { ruledOut } : {}) };
  };

  return { create_task, update_task, capture_decision };
}
