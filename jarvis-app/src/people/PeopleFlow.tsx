import { useCallback, useEffect, useState } from "react";
import { usePeople, useNotes } from "../data/NotesProvider";
import type { Person, PersonGroup } from "./types";
import PeopleListPage from "./screens/PeopleListPage";
import PersonDetail from "./screens/PersonDetail";
import PersonSheet, { type PersonDraft } from "./screens/PersonSheet";
import { usePushDepth } from "../shared/pushNav";
import { parseContactsFile, type ImportedContact } from "./importContacts";
import { GROUP_TITLE } from "./types";
import { showToast } from "../shared/toast";
import { createPortal } from "react-dom";

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
  const pushCls = usePushDepth(current ? 1 : 0);
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

  // Contact import (Dave 2026-07-30): parse a shared .vcf/.csv, dedupe by name
  // against this group, preview the count, then create everyone on confirm.
  const [importPreview, setImportPreview] = useState<{ fresh: ImportedContact[]; dupes: number; bad: boolean } | null>(null);
  const [importing, setImporting] = useState(false);
  const onImportFile = async (file: File) => {
    const text = await file.text();
    const parsed = parseContactsFile(file.name, text);
    if (parsed.length === 0) { setImportPreview({ fresh: [], dupes: 0, bad: true }); return; }
    const existing = new Set(list.map((p) => p.data.name.trim().toLowerCase()));
    const fresh = parsed.filter((c) => !existing.has(c.name.trim().toLowerCase()));
    setImportPreview({ fresh, dupes: parsed.length - fresh.length, bad: false });
  };
  const runImport = async () => {
    if (!importPreview || importing) return;
    setImporting(true);
    const n = importPreview.fresh.length;
    for (const c of importPreview.fresh) {
      await people.create({ name: c.name, group, birthday: c.birthday, notes: c.notes });
    }
    setImporting(false);
    setImportPreview(null);
    await reload();
    showToast({ message: `Added ${n} ${n === 1 ? "person" : "people"}` });
  };

  const importEl = importPreview && createPortal(
    <div className="sheet-scrim" onClick={() => !importing && setImportPreview(null)}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Import Contacts</div></div>
        <div className="pad-x sheet-form">
          {importPreview.bad ? (
            <div className="plan-sub">I couldn't read people from that file. Share contacts from your phone as a .vcf, or use a .csv with a Name column.</div>
          ) : (
            <>
              <div className="plan-sub">
                Found {importPreview.fresh.length + importPreview.dupes} {importPreview.fresh.length + importPreview.dupes === 1 ? "person" : "people"}.
                {importPreview.dupes > 0 && ` ${importPreview.dupes} already in ${GROUP_TITLE[group]}, skipping ${importPreview.dupes === 1 ? "that one" : "those"}.`}
                {importPreview.fresh.length > 0 && ` Adding ${importPreview.fresh.length} to ${GROUP_TITLE[group]}.`}
              </div>
              {importPreview.fresh.length > 0 && (
                <div className="input-help">{importPreview.fresh.slice(0, 5).map((c) => c.name).join(", ")}{importPreview.fresh.length > 5 ? ` and ${importPreview.fresh.length - 5} more` : ""}</div>
              )}
            </>
          )}
        </div>
        <div className="pad-x sheet-actions">
          {!importPreview.bad && importPreview.fresh.length > 0 && (
            <button className="btn btn-primary btn-block" disabled={importing} onClick={runImport}>
              {importing ? "Adding..." : `Add ${importPreview.fresh.length} ${importPreview.fresh.length === 1 ? "Person" : "People"}`}
            </button>
          )}
          <button className="btn btn-secondary btn-block" disabled={importing} onClick={() => setImportPreview(null)}>
            {importPreview.bad || importPreview.fresh.length === 0 ? "Close" : "Cancel"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );

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
      <div className={pushCls} key={"d-" + current.id}>
        <PersonDetail person={current} onEdit={() => setSheet({ kind: "edit", id: current.id })} onBack={() => setOpenId(null)} linkedNotes={linkedNotes} onOpenNote={onOpenNote} />
        {sheetEl}
      </div>
    );
  }

  return (
    <div className={pushCls} key="base">
      <PeopleListPage group={group} people={list} onOpen={setOpenId} onAdd={() => setSheet({ kind: "new" })} onImportFile={onImportFile} onBack={onBack} />
      {sheetEl}
      {importEl}
    </div>
  );
}
