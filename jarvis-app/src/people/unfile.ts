import type { TasksService } from "../tasks/TasksService";
import type { DecisionService } from "../decisions/DecisionService";
import { linksOf } from "../decisions/types";

// WHAT DELETING A PERSON DOES TO THINGS POINTING AT THEM (2026-09-22).
//
// PeopleFlow's own onDelete comment (BRAIN-F-13) already named the failure
// mode -- "their linked notes... and any decision attached to them pointed
// at nothing" -- but only ever fixed it for the Undo path, by giving the
// recreated person back their own id. A delete that is never undone still
// leaves every task's personId, and every decision's link, aimed at a row
// that is gone. Linked Notes are the one exception and are deliberately NOT
// touched here: NotesFlow already marks a gone connection target rather
// than pretending it is live (targetGone, HMN-F-18), so a note's "person"
// connection to a deleted contact is handled by that existing, correct
// design and must not also be silently dropped here.

export interface UnfiledFromPerson {
  tasks: { id: string }[];
  decisions: { id: string; label: string }[];
}

/** Take the person off every task and decision that references them. */
export async function unfilePerson(
  personId: string,
  tasks: TasksService,
  decisions: DecisionService | null,
): Promise<UnfiledFromPerson> {
  const out: UnfiledFromPerson = { tasks: [], decisions: [] };
  if (!personId) return out;

  for (const t of await tasks.listTasks()) {
    if (t.data.personId !== personId) continue;
    out.tasks.push({ id: t.id });
    await tasks.setPerson(t.id, null);
  }

  if (decisions) {
    for (const d of await decisions.listAll()) {
      const links = linksOf(d.data);
      const link = links.find((l) => l.type === "person" && l.id === personId);
      if (!link) continue;
      out.decisions.push({ id: d.id, label: link.label });
      const nextLinks = links.filter((l) => !(l.type === "person" && l.id === personId));
      await decisions.update(d.id, {
        links: nextLinks.length ? nextLinks : undefined,
        linkedType: nextLinks[0]?.type,
        linkedId: nextLinks[0]?.id,
        linkedLabel: nextLinks[0]?.label,
      });
    }
  }

  return out;
}

/** Put back what unfilePerson took off, for Undo. */
export async function refilePerson(
  personId: string,
  prior: UnfiledFromPerson,
  tasks: TasksService,
  decisions: DecisionService | null,
): Promise<void> {
  for (const t of prior.tasks) await tasks.setPerson(t.id, personId);
  if (decisions) {
    for (const d of prior.decisions) {
      const rec = await decisions.get(d.id);
      if (!rec) continue;
      const nextLinks = [...linksOf(rec.data), { type: "person" as const, id: personId, label: d.label }];
      await decisions.update(d.id, {
        links: nextLinks,
        linkedType: nextLinks[0]?.type,
        linkedId: nextLinks[0]?.id,
        linkedLabel: nextLinks[0]?.label,
      });
    }
  }
}
