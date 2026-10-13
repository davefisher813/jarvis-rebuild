import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FormSheet, Group, Row, FieldRow, MenuRow, Note, DeleteRow, SwitchRow, Strip } from "../../shared/FormSheet";
import { FileText, Share as ShareIcon } from "../../shared/icons";
import { saveFile, canShareFiles } from "../../shared/saveFile";
import { shareText as shareOut } from "../../shared/shareText";
import { safeFilename } from "../exportDoc";
import { showToast } from "../../shared/toast";
import {
  type PageData, type PageRecord, type PageField,
  editableFields, fieldImpact, recordName, labelOf, KIND_NAME,
} from "./pageModel";
import { PAGE_FORMATS, buildPageFile, shareText, type PageFormat } from "./exportPage";

// THE SHEETS A TEMPLATE PAGE OPENS. Each is the app's FormSheet (the handle,
// Cancel and Save in the bar, caps groups) or its export sheet; nothing here
// is a new kind of sheet.

const noun = (page: PageData) => page.kind === "outreach" ? "Contact" : "Player";

/** One record, every field it has, typed in place. A value the import was not sure of is named under its group with
 *  the reason, and can be kept as it is in one tap. Nothing here makes a task, an event or a share: Outreach's Make a
 *  Task is its own row and runs only when tapped. */
export function RecordSheet({ page, record, isNew, onSave, onCancel, onRemove, onKeep, onMakeTask, onMove, taskMade }: {
  page: PageData;
  record: PageRecord | null;
  isNew: boolean;
  onSave: (values: Record<string, string>) => void;
  onCancel: () => void;
  onRemove?: () => void;
  onKeep?: (key: string) => void;
  onMakeTask?: (text: string) => void;
  onMove?: (by: -1 | 1) => void;
  taskMade?: boolean;
}) {
  const fields = editableFields(page);
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, record?.v[f.key] ?? ""])));
  const set = (k: string, v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const changed = () => Object.fromEntries(Object.entries(draft).filter(([k, v]) => (record?.v[k] ?? "") !== v));
  const flags = Object.entries(record?.flags ?? {});
  const title = page.kind === "lineup" ? "Lineup Spot" : (isNew ? "New " : "Edit ") + noun(page);
  const fieldRow = (f: PageField) => {
    if (f.type === "choice" && f.options?.length) {
      const opts = [...f.options, ...(draft[f.key] && !f.options.includes(draft[f.key]!) ? [draft[f.key]!] : [])];
      return <MenuRow key={f.key} tone="" glyph={null} label={f.label} value={draft[f.key] ?? ""} word={draft[f.key] ? undefined : "Choose"}
        options={[{ value: "", label: "None" }, ...opts.map((o) => ({ value: o, label: o }))]} onPick={(v) => set(f.key, v)} ariaLabel={f.label} />;
    }
    return <FieldRow key={f.key} label={f.label} ariaLabel={f.label} value={draft[f.key] ?? ""} onChange={(v) => set(f.key, v)}
      type={f.type === "date" ? "date" : "text"} inputMode={f.type === "number" ? "numeric" : undefined} error={!!record?.flags?.[f.key] && (record?.v[f.key] ?? "") === (draft[f.key] ?? "")} />;
  };
  return (
    <FormSheet title={title} saveLabel={isNew ? "Add" : "Save"} onCancel={onCancel} onSave={() => onSave(isNew ? draft : changed())}
      saveDisabled={isNew && !Object.values(draft).some((v) => v.trim())}>
      <Group label={page.kind === "lineup" ? "Player" : noun(page)}>
        {(page.kind === "lineup" ? fields.filter((f) => f.key === "position") : fields).map(fieldRow)}
      </Group>
      {page.kind === "lineup" && record && <Note><span data-user-text="">{[record.v.name, record.v.number ? "#" + record.v.number : ""].filter(Boolean).join(", ")}</span></Note>}
      {flags.length > 0 && onKeep && (
        <Group label="Not Sure">
          {flags.map(([k, why]) => (
            <Row key={k} label={`Keep ${labelOf(page, k)} as It Is`} meta={<span className="fact warn">{why}</span>} onClick={() => onKeep(k)} />
          ))}
        </Group>
      )}
      {onMakeTask && (
        <Group label="Next Step">
          {taskMade
            ? <Row label="A Task Was Made from This" />
            : <Row label="Make a Task from the Next Step" onClick={() => { const t = (draft.next ?? "").trim(); if (t) onMakeTask(t); }} />}
        </Group>
      )}
      {onMakeTask && !taskMade && !(draft.next ?? "").trim() && <Note>The Next Step Stays Text Unless You Make It a Task</Note>}
      {onMove && (
        <Group label="Order">
          <Row label="Move Up" onClick={() => onMove(-1)} />
          <Row label="Move Down" onClick={() => onMove(1)} />
        </Group>
      )}
      {onRemove && <Group><DeleteRow label={page.kind === "lineup" ? "Take Out of the Lineup" : "Remove " + noun(page)} onClick={onRemove} /></Group>}
    </FormSheet>
  );
}

/** Labels are his to name, any time, with nothing else moving. Adding a field costs nothing; removing one says what it
 *  would cost before it runs. */
export function FieldsSheet({ page, onSave, onCancel, onRemove }: {
  page: PageData;
  onSave: (labels: Record<string, string>, added: string) => void;
  onCancel: () => void;
  onRemove: (key: string) => void;
}) {
  const fields = editableFields(page);
  const [labels, setLabels] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, f.label])));
  const [added, setAdded] = useState("");
  const removable = fields.filter((f) => f.key !== (page.kind === "outreach" ? "who" : "name"));
  return (
    <FormSheet title="Fields" onCancel={onCancel} onSave={() => onSave(labels, added)}>
      <Group label="Names">
        {fields.map((f) => <FieldRow key={f.key} ariaLabel={"Name for " + f.label} value={labels[f.key] ?? ""} onChange={(v) => setLabels((l) => ({ ...l, [f.key]: v }))} />)}
      </Group>
      <Note>Renaming Changes Only the Label; Every Value Stays Put</Note>
      <Group label="Add a Field">
        <FieldRow ariaLabel="New field name" placeholder="Field Name" value={added} onChange={setAdded} />
      </Group>
      {removable.length > 0 && (
        <Group label="Remove a Field">
          {removable.map((f) => <Row key={f.key} label={f.label} onClick={() => onRemove(f.key)} chev />)}
        </Group>
      )}
    </FormSheet>
  );
}

/** THE CONSEQUENCE, SAID FIRST (the spec: structural changes explained before applying). */
export function ConfirmChange({ title, lines, action, onApply, onCancel }: {
  title: string; lines: string[]; action: string; onApply: () => void; onCancel: () => void;
}) {
  return (
    <FormSheet title={title} saveLabel={action} onCancel={onCancel} onSave={onApply}>
      {lines.map((l) => <Note key={l}>{l}</Note>)}
    </FormSheet>
  );
}

export function fieldRemovalLines(page: PageData, key: string): string[] {
  const n = fieldImpact(page, key);
  const who = noun(page) + (n === 1 ? "" : "s");
  return [
    n === 0 ? "No Record Has a Value Here" : `${n} ${who} Have a Value Here`,
    "A Snapshot Keeps Them First; See Snapshots in the Page Menu",
  ];
}

/** A NEW ROUND WITHOUT ARRANGING ANYTHING: a course if he wants one, 9 or 18, the players. Start goes straight to hole 1. */
export function StartRoundSheet({ onStart, onCancel }: { onStart: (o: { course: string; holes: 9 | 18; players: string[] }) => void; onCancel: () => void }) {
  const [course, setCourse] = useState("");
  const [holes, setHoles] = useState<9 | 18>(18);
  const [players, setPlayers] = useState<string[]>([""]);
  return (
    <FormSheet title="New Round" saveLabel="Start" onCancel={onCancel} onSave={() => onStart({ course, holes, players })}>
      <Group label="Course">
        <FieldRow ariaLabel="Course name" placeholder="Course Name" value={course} onChange={setCourse} />
      </Group>
      <Group label="Holes">
        <Strip>
          {([9, 18] as const).map((h) => (
            <button key={h} type="button" className={"chip" + (holes === h ? " active" : "")} aria-pressed={holes === h} onClick={() => setHoles(h)}>{h} Holes</button>
          ))}
        </Strip>
      </Group>
      <Group label="Players">
        {players.map((p, i) => (
          <FieldRow key={i} ariaLabel={`Player ${i + 1}`} placeholder={`Player ${i + 1}`} value={p} onChange={(v) => setPlayers((ps) => ps.map((x, j) => (j === i ? v : x)))} />
        ))}
        {players.length < 8 && <Row label="Add a Player" onClick={() => setPlayers((ps) => [...ps, ""])} />}
      </Group>
      <Note>Par Is 4 on Every Hole Until You Change It on the Hole</Note>
    </FormSheet>
  );
}

/** One line typed, Save: rename a page, a course, a date. */
export function OneFieldSheet({ title, label, value, type = "text", onSave, onCancel }: {
  title: string; label: string; value: string; type?: "text" | "date"; onSave: (v: string) => void; onCancel: () => void;
}) {
  const [v, setV] = useState(value);
  return (
    <FormSheet title={title} onCancel={onCancel} onSave={() => onSave(v)}>
      <Group>
        <FieldRow ariaLabel={label} placeholder={label} value={v} type={type} onChange={setV} onEnter={() => onSave(v)} />
      </Group>
    </FormSheet>
  );
}

// ---------------------------------------------------------------------------
// Export and share, on the page.

type Choice = PageFormat | "person";

/** SHEETS, EXCEL, PDF, OR A PERSON. The file is prepared the moment a format is picked, so the tap on Export is the
 *  share itself. A person gets a copy of only the rows and fields ticked here, as text: nothing else on the page goes,
 *  and nobody is given access to anything. */
export function PageShareSheet({ title, page, onClose, onExported }: {
  title: string;
  page: PageData;
  onClose: () => void;
  /** After a file left: the page is snapshotted and its values become the base a reimport compares against. */
  onExported: (format: PageFormat) => void;
}) {
  const [choice, setChoice] = useState<Choice>("csv");
  const [file, setFile] = useState<{ format: PageFormat; blob: Blob } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const fields = editableFields(page);
  const [pickFields, setPickFields] = useState<string[]>(() => fields.map((f) => f.key));
  const [pickRecords, setPickRecords] = useState<string[]>(() => page.records.map((r) => r.id));
  const gen = useRef(0);
  useEffect(() => {
    if (choice === "person") return;
    const mine = ++gen.current;
    setFile(null);
    setFailed(null);
    void buildPageFile(choice, title, page)
      .then((blob) => { if (gen.current === mine) setFile({ format: choice, blob }); })
      .catch((e: unknown) => { if (gen.current === mine) setFailed(e instanceof Error && e.message ? e.message : "The file could not be prepared"); });
  }, [choice, title, page]);
  const info = PAGE_FORMATS.find((f) => f.key === choice);
  const filename = info ? safeFilename(title || KIND_NAME[page.kind], info.ext) : "";
  const ready = choice === "person" ? pickRecords.length > 0 && (page.kind === "scorecard" || pickFields.length > 0) : !!file && file.format === choice;

  const run = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setFailed(null);
    try {
      if (choice === "person") {
        const r = await shareOut(shareText(title || KIND_NAME[page.kind], page, pickFields, pickRecords), title);
        if (r === false) return;
        showToast({ message: r === "shared" ? "Sent as a Copy" : "Copied" });
        onClose();
        return;
      }
      const result = await saveFile(file!.blob, filename, { title: title || "Page" });
      if (result === false) return;
      onExported(choice);
      showToast({ message: result === "shared" ? `${filename} Shared` : `${filename} Downloaded` });
      onClose();
    } catch (e) {
      setFailed(e instanceof Error && e.message ? e.message : "It did not leave the app");
    } finally {
      setBusy(false);
    }
  };
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const word = choice === "person" ? "Send a Copy" : canShareFiles() ? "Export File" : "Download File";
  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Export or Share</div></div>
        <div className="pad-x sheet-form">
          <div className="field">
            <div className="exp-formats" role="group" aria-label="Format">
              {[...PAGE_FORMATS.map((f) => ({ key: f.key as Choice, label: f.label, desc: f.desc })), { key: "person" as Choice, label: "A Person", desc: "Only the Rows and Fields You Pick" }].map((f) => (
                <button type="button" key={f.key} aria-pressed={choice === f.key} className={"exp-format" + (choice === f.key ? " on" : "")} onClick={() => setChoice(f.key)}>
                  {f.key === "person" ? <ShareIcon className="ic" /> : <FileText className="ic" />}
                  <span className="exp-t"><div className="exp-k">{f.label}</div><div className="exp-d">{f.desc}</div></span>
                  <span className="exp-ring" aria-hidden="true" />
                </button>
              ))}
            </div>
            {choice === "csv" || choice === "xlsx"
              ? <div className="input-hint">The First Column Is Each Row&rsquo;s ID; Keep It and the File Can Come Back</div>
              : choice === "person" ? <div className="input-hint">Sends a Copy; Nobody Gets Access to the Page</div> : null}
          </div>
          {choice === "person" && (
            <>
              {page.kind !== "scorecard" && (
                <details className="exp-more" open>
                  <summary>Fields</summary>
                  {fields.map((f) => <SwitchRow key={f.key} tone="grey" glyph={<FileText className="ic" />} label={f.label} on={pickFields.includes(f.key)} onToggle={() => setPickFields((l) => toggle(l, f.key))} ariaLabel={"Include " + f.label} />)}
                </details>
              )}
              <details className="exp-more" open={page.records.length <= 12}>
                <summary>{page.kind === "outreach" ? "Contacts" : "Players"}</summary>
                {page.records.map((r) => <SwitchRow key={r.id} tone="grey" glyph={<FileText className="ic" />} label={recordName(page, r) || "Unnamed"} on={pickRecords.includes(r.id)} onToggle={() => setPickRecords((l) => toggle(l, r.id))} ariaLabel={"Include " + (recordName(page, r) || "this row")} />)}
              </details>
            </>
          )}
          {failed && <div role="alert"><div className="input-error">{failed.replace(/[.\s]+$/, "")}; the page is unchanged, so retry or pick another format</div></div>}
          <div className="exp-acts">
            <button type="button" className="btn btn-primary" disabled={!ready || busy} onClick={() => void run()}>{busy ? "Sharing" : !ready && choice !== "person" ? "Preparing" : word}</button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
