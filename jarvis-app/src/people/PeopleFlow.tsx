import { useCallback, useEffect, useState } from "react";
import { usePeople, useNotes, useCategories, useTasks, useSchedule } from "../data/NotesProvider";
import { openWith as openWithPerson, type MentionItem } from "./mentions";
import { todayISO } from "../tasks/grouping";
import type { Person } from "./types";
import { needsAdversarialReview, extractEmailFromNotes } from "./views";
import type { SheetCategoryOpt } from "./screens/PersonSheet";
import PeopleListPage from "./screens/PeopleListPage";
import PersonDetail from "./screens/PersonDetail";
import CallPrepSheet from "./CallPrepSheet";
import MessageDraftSheet from "./MessageDraftSheet";
import { useAI } from "../ai/useAI";
import PersonSheet, { type PersonDraft } from "./screens/PersonSheet";
import { usePushDepth } from "../shared/pushNav";
import { parseContactsFile, type ImportedContact } from "./importContacts";
import { showToast } from "../shared/toast";
import { createPortal } from "react-dom";

type Sheet = { kind: "closed" } | { kind: "new" } | { kind: "edit"; id: string };

export default function PeopleFlow({ onBack, openId: initialOpenId, onOpenNote, onOpenItem }: { onBack: () => void; openId?: string; onOpenNote?: (id: string) => void; onOpenItem?: (kind: string, id: string) => void }) {
  const people = usePeople();
  const notesSvc = useNotes();
  const catsSvc = useCategories();
  const [list, setList] = useState<Person[]>([]);
  const [categories, setCategories] = useState<SheetCategoryOpt[]>([]);
  useEffect(() => {
    let on = true;
    catsSvc.list().then((cs) => { if (on) setCategories(cs.map((c) => ({ id: c.id, name: c.data.name, color: c.data.color }))); });
    return () => { on = false; };
  }, [catsSvc]);
  const [openId, setOpenId] = useState<string | null>(initialOpenId ?? null);
  const [linkedNotes, setLinkedNotes] = useState<{ id: string; title: string; category: string }[]>([]);
  const [sheet, setSheet] = useState<Sheet>({ kind: "closed" });
  const [prepOpen, setPrepOpen] = useState(false);
  const [msgOpen, setMsgOpen] = useState(false);
  const ai = useAI();
  // B1: the open work and the time still ahead that name this person. Loaded
  // only while a card is open, because it is a property of THAT person and
  // not of the list.
  const tasksSvc = useTasks();
  const schedSvc = useSchedule();
  const [still, setStill] = useState<MentionItem[]>([]);

  // ONE list, everyone (the Inner Circle / Adversarial lists were removed
  // 2026-08-03; the facts they claimed to organize live on each person).
  const reload = useCallback(async () => {
    setList(await people.list());
  }, [people]);

  useEffect(() => { void reload(); }, [reload]);

  // Fetch notes linked to the open person for the Linked Notes section.
  useEffect(() => {
    setPrepOpen(false); // a different person is a different call
    setMsgOpen(false);
    if (!openId) { setLinkedNotes([]); return; }
    let on = true;
    notesSvc.notesLinkedTo(openId).then((n) => { if (on) setLinkedNotes(n); });
    return () => { on = false; };
  }, [openId, notesSvc]);

  const current = openId ? list.find((p) => p.id === openId) ?? null : null;

  // B1: what is still open with this person. Best effort and additive; a
  // failure here leaves the card exactly as it was before.
  const currentName = current?.data.name;
  useEffect(() => {
    if (!currentName) { setStill([]); return; }
    let on = true;
    void (async () => {
      try {
        const [ts, evs] = await Promise.all([tasksSvc.listTasks(), schedSvc.listEvents()]);
        if (!on) return;
        setStill(openWithPerson(
          { name: currentName },
          ts.map((t) => ({ id: t.id, text: t.data.text, done: t.data.done, due: t.data.due ?? null })),
          evs.map((e) => ({ id: e.id, title: e.data.title, date: e.data.date, start: e.data.start, location: e.data.location })),
          todayISO(),
        ));
      } catch { if (on) setStill([]); }
    })();
    return () => { on = false; };
  }, [currentName, tasksSvc, schedSvc]);

  const pushCls = usePushDepth(current ? 1 : 0);
  const editing = sheet.kind === "edit" ? list.find((p) => p.id === sheet.id) : undefined;

  const onSave = async (d: PersonDraft) => {
    const facts = {
      relationship: d.relationship || undefined,
      birthday: d.birthday || undefined,
      notes: d.notes || undefined,
      color: d.color,
      email: d.email || undefined,
      phone: d.phone || undefined,
      register: d.register,
      categoryIds: d.categoryIds.length ? d.categoryIds : undefined,
    };
    if (sheet.kind === "new") {
      // New people are always plain contacts; every fact is what the user
      // set in the sheet, nothing is inferred from where they tapped Add.
      await people.create({ name: d.name, group: "contacts", ...facts });
    } else if (sheet.kind === "edit") {
      await people.update(sheet.id, { name: d.name, ...facts });
    }
    setSheet({ kind: "closed" });
    await reload();
  };

  // Adversarial legacy review (consent-first): the flag now changes how the
  // app WRITES to a real person, so nobody gets flagged silently.
  const confirmFlag = async (p: Person) => {
    await people.update(p.id, { ...p.data, flagged: true });
    await reload();
  };
  const clearFlag = async (p: Person) => {
    await people.update(p.id, { ...p.data, flagged: false, group: "contacts" });
    await reload();
    showToast({ message: p.data.name + " moved to Contacts" });
  };
  const onDelete = async () => {
    if (sheet.kind !== "edit") return;
    await people.remove(sheet.id);
    setSheet({ kind: "closed" });
    setOpenId(null);
    await reload();
  };

  // Contact import (Dave 2026-07-30): parse a shared .vcf/.csv, dedupe by
  // name against everyone, preview the count, then create all on confirm.
  const [importPreview, setImportPreview] = useState<{ fresh: ImportedContact[]; dupes: number; bad: boolean } | null>(null);
  const [importing, setImporting] = useState(false);
  const [importedSoFar, setImportedSoFar] = useState(0);
  const onImportFile = async (file: File) => {
    const text = await file.text();
    const parsed = parseContactsFile(file.name, text);
    if (parsed.length === 0) { setImportPreview({ fresh: [], dupes: 0, bad: true }); return; }
    const existing = new Set(list.map((p) => p.data.name.trim().toLowerCase()));
    const fresh = parsed.filter((c) => !existing.has(c.name.trim().toLowerCase()));
    setImportPreview({ fresh, dupes: parsed.length - fresh.length, bad: false });
  };
  const [importError, setImportError] = useState<string | null>(null);
  const runImport = async () => {
    if (!importPreview || importing) return;
    setImporting(true);
    setImportedSoFar(0);
    setImportError(null);
    const n = importPreview.fresh.length;
    // Bulk insert in chunks of 100: one round trip per chunk, live count on
    // the button. 758 contacts lands in seconds instead of minutes. A network
    // failure mid-run can never strand the button on "Adding...": whatever
    // landed stays saved, the sheet reports it plainly, and tapping again
    // continues with only the remaining people (2026-07-30: the first version
    // had no error handling and froze at "Adding..." on one failed call).
    const CHUNK = 100;
    let added = 0;
    try {
      for (let i = 0; i < n; i += CHUNK) {
        const batch = importPreview.fresh.slice(i, i + CHUNK).map((c) => ({ name: c.name, group: "contacts" as const, birthday: c.birthday, notes: c.notes, email: c.email, phone: c.phone }));
        await people.createMany(batch);
        added = Math.min(n, i + CHUNK);
        setImportedSoFar(added);
      }
      setImporting(false);
      setImportPreview(null);
      await reload();
      showToast({ message: `Added ${n} ${n === 1 ? "person" : "people"}` });
    } catch {
      setImporting(false);
      const remaining = importPreview.fresh.slice(added);
      setImportPreview({ fresh: remaining, dupes: importPreview.dupes, bad: false });
      setImportError(`Stopped at ${added} of ${n} · Saved so far · Tap to finish`);
      await reload();
    }
  };

  const importEl = importPreview && createPortal(
    <div className="sheet-scrim" onClick={() => !importing && setImportPreview(null)}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Import Contacts</div></div>
        <div className="pad-x sheet-form">
          {importPreview.bad ? (
            <div className="plan-sub">Couldn't read that file · Use .vcf or .csv with names</div>
          ) : (
            <>
              <div className="plan-sub">
                Found {importPreview.fresh.length + importPreview.dupes} {importPreview.fresh.length + importPreview.dupes === 1 ? "person" : "people"}
                {importPreview.dupes > 0 && ` · Skipping ${importPreview.dupes} already here`}
                {importPreview.fresh.length > 0 && ` · Adding ${importPreview.fresh.length}`}
              </div>
              {importPreview.fresh.length > 0 && (
                <div className="input-help">{importPreview.fresh.slice(0, 5).map((c) => c.name).join(", ")}{importPreview.fresh.length > 5 ? ` and ${importPreview.fresh.length - 5} more` : ""}</div>
              )}
              {importError && <div className="input-note">{importError}</div>}
            </>
          )}
        </div>
        <div className="pad-x sheet-actions">
          {!importPreview.bad && importPreview.fresh.length > 0 && (
            <button className="btn btn-primary btn-block" disabled={importing} onClick={runImport}>
              {importing ? `Adding ${importedSoFar} of ${importPreview.fresh.length}...` : `Add ${importPreview.fresh.length} ${importPreview.fresh.length === 1 ? "Person" : "People"}`}
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
      initial={editing ? {
        ...editing.data,
        // Contact identity hid in notes for months (vCard import folded
        // EMAIL there). Surface it into the field when unambiguous; the user
        // sees it in the sheet before it saves.
        email: editing.data.email ?? extractEmailFromNotes(editing.data.notes) ?? undefined,
      } : undefined}
      categories={categories}
      onSave={onSave}
      onDelete={sheet.kind === "edit" ? onDelete : undefined}
      onCancel={() => setSheet({ kind: "closed" })}
    />
  );

  if (current) {
    return (
      <div className={pushCls} key={"d-" + current.id}>
        <PersonDetail person={current} onEdit={() => setSheet({ kind: "edit", id: current.id })} onBack={() => setOpenId(null)} linkedNotes={linkedNotes} onOpenNote={onOpenNote}
          onCallPrep={current.data.phone ? () => setPrepOpen(true) : undefined}
          onMessage={current.data.phone ? () => setMsgOpen(true) : undefined}
          categoryNames={(current.data.categoryIds ?? []).map((id) => categories.find((c) => c.id === id)?.name).filter((n): n is string => !!n)}
          openWith={still}
          onOpenItem={onOpenItem ? (kind, id) => onOpenItem(kind, id) : undefined} />
        {prepOpen && (
          <CallPrepSheet
            person={current}
            linkedNotes={linkedNotes}
            onCall={async () => {
              const out = await people.logCallAttempt(current.id);
              await reload();
              return out;
            }}
            onUndoCall={async (prior) => { await people.restoreCallAttempt(current.id, prior); await reload(); }}
            onCaptureNote={async (text) => {
              const noteId = await notesSvc.createNote("Call with " + current.data.name, "");
              if (!noteId) return false;
              await notesSvc.addBlock(noteId, { type: "text", text });
              await notesSvc.addConnection(noteId, "person", current.data.name, current.id);
              return true;
            }}
            onClose={() => setPrepOpen(false)}
          />
        )}
        {msgOpen && (
          <MessageDraftSheet person={current} ai={ai} onClose={() => setMsgOpen(false)} />
        )}
        {sheetEl}
      </div>
    );
  }

  return (
    <div className={pushCls} key="base">
      <PeopleListPage
        people={list}
        pendingReview={list.filter(needsAdversarialReview)}
        onConfirmFlag={(id) => { const p = list.find((x) => x.id === id); if (p) void confirmFlag(p); }}
        onClearFlag={(id) => { const p = list.find((x) => x.id === id); if (p) void clearFlag(p); }}
        onOpen={setOpenId}
        onAdd={() => setSheet({ kind: "new" })}
        onImportFile={onImportFile}
        onBack={onBack}
      />
      {sheetEl}
      {importEl}
    </div>
  );
}
