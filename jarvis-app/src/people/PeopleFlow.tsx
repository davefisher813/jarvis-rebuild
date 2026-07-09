import { useCallback, useEffect, useState } from "react";
import { usePeople, useNotes } from "../data/NotesProvider";
import type { Person, PersonGroup } from "./types";
import PeopleListPage from "./screens/PeopleListPage";
import PersonDetail from "./screens/PersonDetail";
import PersonSheet, { type PersonDraft } from "./screens/PersonSheet";

type Sheet = { kind: "closed" } | { kind: "new" } | { kind: "edit"; id: string };

export default function PeopleFlow({ group, onBack, openId: initialOpenId, onOpenNote }: { group: PersonGroup; onBack: () => void; openId?: string; onOpenNote?: (id: string) => void }) {
  const people = usePeople();
  const notesSvc = useNotes();
  const [list, setList] = useState<Person[]>([]);
  const [openId, setOpenId] = useState<string | null>(initialOpenId ?? null);
  const [linkedNotes, setLinkedNotes] = useState<{ id: string; title: string; category: string }[]>([]);
  const [sheet, setSheet] = useState<Sheet>({ kind: "closed" });

  const reload = useCallback(async () => {
    setList(await people.list(group));
  }, [people, group]);

  useEffect(() => { void reload(); }, [reload]);

  // Fetch notes linked to the open person for the Linked Notes section.
  useEffect(() => {
    if (!openId) { setLinkedNotes([]); return; }
    let on = true;
    notesSvc.notesLinkedTo(openId).then((n) => { if (on) setLinkedNotes(n); });
    return () => { on = false; };
  }, [openId, notesSvc]);

  const current = openId ? list.find((p) => p.id === openId) ?? null : null;
  const editing = sheet.kind === "edit" ? list.find((p) => p.id === sheet.id) : undefined;

  const onSave = async (d: PersonDraft) => {
    if (sheet.kind === "new") {
      await people.create({ name: d.name, group, relationship: d.relationship || undefined, birthday: d.birthday || undefined, notes: d.notes || undefined, color: d.color });
    } else if (sheet.kind === "edit") {
      await people.update(sheet.id, { name: d.name, relationship: d.relationship || undefined, birthday: d.birthday || undefined, notes: d.notes || undefined, color: d.color });
    }
    setSheet({ kind: "closed" });
    await reload();
  };
  const onDelete = async () => {
    if (sheet.kind !== "edit") return;
    await people.remove(sheet.id);
    setSheet({ kind: "closed" });
    setOpenId(null);
    await reload();
  };

  const sheetEl = sheet.kind !== "closed" && (
    <PersonSheet
      mode={sheet.kind === "new" ? "new" : "edit"}
      group={group}
      initial={editing?.data}
      onSave={onSave}
      onDelete={sheet.kind === "edit" ? onDelete : undefined}
      onCancel={() => setSheet({ kind: "closed" })}
    />
  );

  if (current) {
    return (
      <>
        <PersonDetail person={current} onEdit={() => setSheet({ kind: "edit", id: current.id })} onBack={() => setOpenId(null)} linkedNotes={linkedNotes} onOpenNote={onOpenNote} />
        {sheetEl}
      </>
    );
  }

  return (
    <>
      <PeopleListPage group={group} people={list} onOpen={setOpenId} onAdd={() => setSheet({ kind: "new" })} onBack={onBack} />
      {sheetEl}
    </>
  );
}
