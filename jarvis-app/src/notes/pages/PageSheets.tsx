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
import { templateDef } from "./templateDefs";
import { SPORTS, SPORT_GROUPS } from "./scoreboard";
import { suggestedFor } from "./templateLogic";
import { RowCheck } from "./TemplateViews";
import RowActionSheet from "../../shared/RowActionSheet";
import { PAGE_FORMATS, buildPageFile, shareText, type PageFormat } from "./exportPage";

// THE SHEETS A TEMPLATE PAGE OPENS. Each is the app's FormSheet (the handle,
// Cancel and Save in the bar, caps groups) or its export sheet; nothing here
// is a new kind of sheet.

const noun = (page: PageData) => templateDef(page.kind)?.noun ?? (page.kind === "outreach" ? "Contact" : "Player");

/** One record, every field it has, typed in place. A value the import was not sure of is named under its group with
 *  the reason, and can be kept as it is in one tap. Nothing here makes a task, an event or a share: Outreach's Make a
 *  Task is its own row and runs only when tapped. */
export function RecordSheet({ page, record, isNew, onSave, onCancel, onRemove, onKeep, onMakeTask, onMove, taskMade, onConfirm, confirmedWord, defaultSection, initial, carried }: {
  page: PageData;
  record: PageRecord | null;
  isNew: boolean;
  /** The heading whose Add opened this sheet: a new row starts under it. */
  defaultSection?: string;
  /** Values a new row starts with (a 1:1's follow-ups carried from the last meeting). Prefilled, so typing replaces them. */
  initial?: Record<string, string>;
  /** The line that says where a prefilled value came from. */
  carried?: string;
  /** The values changed (all of them for a new row) and, when the page has headings, the heading it was put under (null: above every heading). */
  onSave: (values: Record<string, string>, section?: string | null) => void;
  onCancel: () => void;
  onRemove?: () => void;
  onKeep?: (key: string) => void;
  onMakeTask?: (text: string) => void;
  onMove?: (by: -1 | 1) => void;
  taskMade?: boolean;
  /** A sensitive page: the person says this row is still true. Their tap alone sets it. */
  onConfirm?: () => void;
  confirmedWord?: string;
}) {
  const fields = editableFields(page);
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, record?.v[f.key] ?? (isNew ? initial?.[f.key] : undefined) ?? ""])));
  const set = (k: string, v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const changed = () => Object.fromEntries(Object.entries(draft).filter(([k, v]) => (record?.v[k] ?? "") !== v));
  const sections = page.sections ?? [];
  // A new row lands under the heading whose Add was tapped; failing that, under the heading the last row went under (else the
  // first), so adding a run of rows is a run of taps.
  const [sec, setSec] = useState<string>(record ? record.sec ?? "" : (defaultSection && sections.some((x) => x.key === defaultSection) ? defaultSection : undefined) ?? [...page.records].reverse().find((r) => r.sec && sections.some((x) => x.key === r.sec))?.sec ?? sections[0]?.key ?? "");
  const secChanged = isNew ? !!sec : sec !== (record?.sec ?? "");
  const flags = Object.entries(record?.flags ?? {});
  const title = page.kind === "lineup" ? "Lineup Spot" : (isNew ? "New " : "Edit ") + noun(page);
  const fieldRow = (f: PageField) => {
    if (f.type === "check") {
      // A done mark leads its row, at the left, like every checkbox in the app.
      const on = draft[f.key] === "1";
      return <Row key={f.key} lead={<RowCheck on={on} label={f.label} onToggle={() => set(f.key, on ? "" : "1")} />} label={f.label} onClick={() => set(f.key, on ? "" : "1")} />;
    }
    if (f.type === "choice" && f.options?.length) {
      const opts = [...f.options, ...(draft[f.key] && !f.options.includes(draft[f.key]!) ? [draft[f.key]!] : [])];
      return <MenuRow key={f.key} tone="" glyph={null} label={f.label} value={draft[f.key] ?? ""} word={draft[f.key] ? undefined : "Choose"}
        options={[{ value: "", label: "None" }, ...opts.map((o) => ({ value: o, label: o }))]} onPick={(v) => set(f.key, v)} ariaLabel={f.label} />;
    }
    return <FieldRow key={f.key} label={f.label} ariaLabel={f.label} value={draft[f.key] ?? ""} onChange={(v) => set(f.key, v)}
      type={f.type === "date" ? "date" : "text"} inputMode={f.type === "number" ? "numeric" : f.type === "money" ? "decimal" : undefined} error={!!record?.flags?.[f.key] && (record?.v[f.key] ?? "") === (draft[f.key] ?? "")} />;
  };
  return (
    <FormSheet title={title} saveLabel={isNew ? "Add" : "Save"} onCancel={onCancel} onSave={() => onSave(isNew ? draft : changed(), sections.length && (isNew || secChanged) ? (sec || null) : undefined)}
      saveDisabled={isNew && !Object.values(draft).some((v) => v.trim())}>
      <Group label={page.kind === "lineup" ? "Player" : noun(page)}>
        {(page.kind === "lineup" ? fields.filter((f) => f.key === "position") : fields).map(fieldRow)}
      </Group>
      {isNew && carried && <Note>{carried}</Note>}
      {sections.length > 0 && (
        <Group label="Heading">
          <MenuRow tone="" glyph={null} label="Under" value={sec} word={sec ? undefined : "Above Every Heading"}
            options={[{ value: "", label: "Above Every Heading" }, ...sections.map((x) => ({ value: x.key, label: x.label }))]} onPick={setSec} ariaLabel="Heading" />
        </Group>
      )}
      {page.kind === "lineup" && record && <Note><span data-user-text="">{[record.v.name, record.v.number ? "#" + record.v.number : ""].filter(Boolean).join(", ")}</span></Note>}
      {flags.length > 0 && onKeep && (
        <Group label="Not Sure">
          {flags.map(([k, why]) => (
            <Row key={k} label={`Keep ${labelOf(page, k)} as It Is`} meta={<span className="fact warn">{why}</span>} onClick={() => onKeep(k)} />
          ))}
        </Group>
      )}
      {onConfirm && (
        <Group label="Last Confirmed">
          <Row label="Confirm Still True" meta={confirmedWord ? <span className="fact">{confirmedWord}</span> : <span className="fact warn">Not Confirmed</span>} onClick={onConfirm} />
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
export function FieldsSheet({ page, onSave, onCancel, onRemove, onMove, onSuggest }: {
  page: PageData;
  onSave: (labels: Record<string, string>, added: string) => void;
  onCancel: () => void;
  onRemove: (key: string) => void;
  /** Reorder a field (a column) in place. */
  onMove?: (key: string, by: -1 | 1) => void;
  /** Add one of the template's suggested fields. */
  onSuggest?: (key: string) => void;
}) {
  const [orderFor, setOrderFor] = useState<string | null>(null);
  const suggested = onSuggest ? suggestedFor(page) : [];
  const fields = editableFields(page);
  const [labels, setLabels] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, f.label])));
  const [added, setAdded] = useState("");
  const headline = templateDef(page.kind)?.headline ?? (page.kind === "outreach" ? "who" : "name");
  const removable = fields.filter((f) => f.key !== headline);
  return (
    <FormSheet title="Fields" onCancel={onCancel} onSave={() => onSave(labels, added)}>
      <Group label="Names">
        {fields.map((f) => <FieldRow key={f.key} ariaLabel={"Name for " + f.label} value={labels[f.key] ?? ""} onChange={(v) => setLabels((l) => ({ ...l, [f.key]: v }))} />)}
      </Group>
      <Note>Renaming Changes Only the Label; Every Value Stays Put</Note>
      <Group label="Add a Field">
        <FieldRow ariaLabel="New field name" placeholder="Field Name" value={added} onChange={setAdded} />
      </Group>
      {suggested.length > 0 && (
        <Group label="Suggested">
          {suggested.map((x) => <Row key={x.key} label={"Add " + x.label} onClick={() => onSuggest!(x.key)} />)}
        </Group>
      )}
      {onMove && fields.length > 1 && (
        <Group label="Order">
          {fields.map((f) => <Row key={f.key} label={f.label} onClick={() => setOrderFor(f.key)} chev />)}
        </Group>
      )}
      {orderFor && onMove && (
        <RowActionSheet title={labelOf(page, orderFor)} onCancel={() => setOrderFor(null)}
          actions={[{ label: "Move Up", onPick: () => onMove(orderFor, -1) }, { label: "Move Down", onPick: () => onMove(orderFor, 1) }]} />
      )}
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

/** WHICH GAME: every sport in one list, on the page's own shelves. Picking one is all the arranging there is: the columns, the way a total is worked out and
 *  who is ahead all follow from it. */
export function StartGameSheet({ onStart, onCancel }: { onStart: (sportKey: string) => void; onCancel: () => void }) {
  const [pick, setPick] = useState("basketball");
  return (
    <FormSheet title="Pick the Game" saveLabel="Start" onCancel={onCancel} onSave={() => onStart(pick)}>
      {SPORT_GROUPS.map((g) => (
        <Group key={g} label={g}>
          {SPORTS.filter((s) => s.group === g).map((s) => (
            <Row key={s.key} label={s.name} onClick={() => setPick(s.key)}
              lead={<RowCheck on={pick === s.key} label={s.name} onToggle={() => setPick(s.key)} />} />
          ))}
        </Group>
      ))}
    </FormSheet>
  );
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
  title: string; label: string; value: string; type?: "text" | "date" | "time"; onSave: (v: string) => void; onCancel: () => void;
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
  const ready = choice === "person" ? pickRecords.length > 0 && (page.kind === "scorecard" || page.kind === "scoreboard" || page.kind === "standings" || pickFields.length > 0) : !!file && file.format === choice;

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
              ? templateDef(page.kind)?.derived
                ? <div className="input-hint">Read From Money Each Time; Corrections Belong in Money</div>
                : <div className="input-hint">The First Column Is Each Row&rsquo;s ID; Keep It and the File Can Come Back</div>
              : choice === "person" ? <div className="input-hint">Sends a Copy; Nobody Gets Access to the Page</div> : null}
          </div>
          {choice === "person" && (
            <>
              {page.kind !== "scorecard" && page.kind !== "scoreboard" && page.kind !== "standings" && (
                <details className="exp-more" open>
                  <summary>Fields</summary>
                  {fields.map((f) => <SwitchRow key={f.key} tone="grey" glyph={<FileText className="ic" />} label={f.label} on={pickFields.includes(f.key)} onToggle={() => setPickFields((l) => toggle(l, f.key))} ariaLabel={"Include " + f.label} />)}
                </details>
              )}
              <details className="exp-more" open={page.records.length <= 12}>
                <summary>{templateDef(page.kind)?.plural ?? (page.kind === "outreach" ? "Contacts" : "Players")}</summary>
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

/** THE HEADINGS A PAGE'S ROWS SIT UNDER, edited on the page: named, added, ordered and removed. Every heading is drawn, rows or none. */
export function SectionsSheet({ page, onSave, onCancel, onMove, onRemove }: {
  page: PageData;
  onSave: (labels: Record<string, string>, added: string) => void;
  onCancel: () => void;
  onMove: (key: string, by: -1 | 1) => void;
  onRemove: (key: string) => void;
}) {
  const sections = page.sections ?? [];
  const [labels, setLabels] = useState<Record<string, string>>(() => Object.fromEntries(sections.map((x) => [x.key, x.label])));
  const [added, setAdded] = useState("");
  const [orderFor, setOrderFor] = useState<string | null>(null);
  return (
    <FormSheet title="Headings" onCancel={onCancel} onSave={() => onSave(labels, added)}>
      {sections.length > 0 && (
        <Group label="Names">
          {sections.map((x) => <FieldRow key={x.key} ariaLabel={"Name for " + x.label} value={labels[x.key] ?? ""} onChange={(v) => setLabels((l) => ({ ...l, [x.key]: v }))} />)}
        </Group>
      )}
      <Group label="Add a Heading">
        <FieldRow ariaLabel="New heading name" placeholder="Heading Name" value={added} onChange={setAdded} />
      </Group>
      {sections.length > 0 && (
        <Group label="Order or Remove">
          {sections.map((x) => <Row key={x.key} label={x.label} onClick={() => setOrderFor(x.key)} chev />)}
        </Group>
      )}
      <Note>Every Heading Stays on the Page, Rows or None; Removing One Keeps Its Rows</Note>
      {orderFor && (
        <RowActionSheet title={sections.find((x) => x.key === orderFor)?.label ?? "Heading"} onCancel={() => setOrderFor(null)}
          actions={[
            { label: "Move Up", onPick: () => onMove(orderFor, -1) },
            { label: "Move Down", onPick: () => onMove(orderFor, 1) },
            { label: "Remove Heading", destructive: true, onPick: () => onRemove(orderFor) },
          ]} />
      )}
    </FormSheet>
  );
}

/** One game on a standings page: who played, the score, the day. */
export function GameSheet({ page, game, onSave, onCancel, onRemove }: {
  page: PageData;
  game: import("./pageModel").GameRow | null;
  onSave: (g: { date: string; a: string; b: string; sa: number; sb: number }) => void;
  onCancel: () => void;
  onRemove?: () => void;
}) {
  const teams = page.records.map((r) => ({ id: r.id, name: (r.v.name ?? "").trim() || "Team" }));
  const [a, setA] = useState(game?.a ?? teams[0]?.id ?? "");
  const [b, setB] = useState(game?.b ?? teams[1]?.id ?? "");
  const [sa, setSa] = useState(game ? String(game.sa) : "");
  const [sb, setSb] = useState(game ? String(game.sb) : "");
  const [date, setDate] = useState(game?.date ?? new Date().toISOString().slice(0, 10));
  const na = Number(sa), nb = Number(sb);
  const ok = !!a && !!b && a !== b && sa.trim() !== "" && sb.trim() !== "" && Number.isFinite(na) && Number.isFinite(nb) && na >= 0 && nb >= 0;
  const opts = teams.map((t) => ({ value: t.id, label: t.name }));
  return (
    <FormSheet title={game ? "Edit Game" : "Record a Game"} saveLabel={game ? "Save" : "Add"} onCancel={onCancel} saveDisabled={!ok}
      onSave={() => onSave({ date, a, b, sa: na, sb: nb })}>
      <Group label="Teams">
        <MenuRow tone="" glyph={null} label="First" value={a} options={opts} onPick={setA} ariaLabel="First team" />
        <MenuRow tone="" glyph={null} label="Second" value={b} options={opts} onPick={setB} ariaLabel="Second team" />
      </Group>
      <Group label="Score">
        <FieldRow label="First" ariaLabel="First team score" value={sa} onChange={setSa} inputMode="numeric" />
        <FieldRow label="Second" ariaLabel="Second team score" value={sb} onChange={setSb} inputMode="numeric" />
      </Group>
      <Group label="Day">
        <FieldRow label="Date" ariaLabel="Game date" type="date" value={date} onChange={setDate} />
      </Group>
      {a && a === b && <Note>Pick Two Different Teams</Note>}
      {onRemove && <Group><DeleteRow label="Remove Game" onClick={onRemove} /></Group>}
    </FormSheet>
  );
}

/** POKER NIGHT'S BLINDS, three numbers: the schedule climbs the usual ladder from them (templateLogic.blindSchedule). */
export function BlindsSheet({ start, minutes, levels, onSave, onCancel }: {
  start: string; minutes: string; levels: string;
  onSave: (start: string, minutes: string, levels: string) => void;
  onCancel: () => void;
}) {
  const [s, setS] = useState(start);
  const [m, setM] = useState(minutes || "15");
  const [l, setL] = useState(levels || "8");
  const okNum = (v: string, min: number) => v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= min;
  const ok = okNum(s, 1) && okNum(m, 0) && okNum(l, 1);
  return (
    <FormSheet title="Blinds" onCancel={onCancel} saveDisabled={!ok} onSave={() => { if (ok) onSave(s.trim(), m.trim(), l.trim()); }}>
      <Group label="Schedule">
        <FieldRow label="Starting Small Blind" ariaLabel="Starting small blind" value={s} onChange={setS} inputMode="numeric" autoFocus error={!!s.trim() && !okNum(s, 1)} />
        <FieldRow label="Minutes a Level" ariaLabel="Minutes a level" value={m} onChange={setM} inputMode="numeric" error={!!m.trim() && !okNum(m, 0)} />
        <FieldRow label="Levels" ariaLabel="Levels" value={l} onChange={setL} inputMode="numeric" error={!!l.trim() && !okNum(l, 1)} />
      </Group>
      <Note>The Levels Climb the Usual Ladder From the Starting Blind: 25/50, 50/100, 75/150, 100/200 and On</Note>
    </FormSheet>
  );
}

/** The Business Ledger's filter: which Money category to read, and which year ("" is every year). */
export function LedgerFilterSheet({ category, year, onSave, onCancel }: { category: string; year: string; onSave: (category: string, year: string) => void; onCancel: () => void }) {
  const [c, setC] = useState(category);
  const [y, setY] = useState(year);
  const yearOk = !y.trim() || /^\d{4}$/.test(y.trim());
  return (
    <FormSheet title="What to Show" onCancel={onCancel} onSave={() => { if (yearOk && c.trim()) onSave(c.trim(), y.trim()); }} saveDisabled={!yearOk || !c.trim()}>
      <Group label="From Money">
        <FieldRow label="Category" ariaLabel="Category" value={c} onChange={setC} />
        <FieldRow label="Year" ariaLabel="Year" value={y} onChange={setY} inputMode="numeric" error={!yearOk} />
      </Group>
      <Note>Spending and Receipts Tagged With This Category Appear Here; Leave the Year Empty for Every Year</Note>
    </FormSheet>
  );
}
