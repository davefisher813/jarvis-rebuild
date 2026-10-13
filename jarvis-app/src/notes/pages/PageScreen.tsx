import { useCallback, useEffect, useRef, useState } from "react";
import { useNotes, useFileStore, useTasks } from "../../data/NotesProvider";
import { attemptWrite } from "../../shared/guard";
import { showToast } from "../../shared/toast";
import { lineCase, titleCase } from "../../shared/casing";
import { usePickFile, PICK_TABLE } from "../../shared/usePickFile";
import { FormSheet, Group, TextRow, Note } from "../../shared/FormSheet";
import RowActionSheet from "../../shared/RowActionSheet";
import { deleteAskTitle } from "../deleteAsk";
import { Head, Card, Row } from "../../settings/kit";
import { Undo2, Share, MoreHorizontal, Trash2, Copy, Clock, PenLine, Table, Camera, Search, ListOrdered } from "../../shared/icons";
import { todayISO } from "../../schedule/calendar";
import { monthDay } from "../../money/bills";
import type { NoteData } from "../types";
import {
  type PageData, type PageOriginal, type RosterChange, KIND_NAME,
  addRecord, setValues, removeRecord, moveRecord, renameField, addField, removeField, confirmValue,
  setScore, setPar, setHoles, holesImpact, nextHole, scoreOf, takeSnapshot, restoreSnapshot, markBase,
  rosterChanges, refreshFromRoster, newLineupPage, recordName, labelOf,
} from "./pageModel";
import { TeamView, LineupView, OutreachView, ScorecardView, HoleEntry, U } from "./PageViews";
import { RecordSheet, FieldsSheet, ConfirmChange, fieldRemovalLines, OneFieldSheet, PageShareSheet } from "./PageSheets";
import { SnapshotsScreen, LineupBuilder } from "./PageExtras";
import ImportReview from "./ImportReview";
import { keepOriginal, readSource, readOriginal, markUsed, type TableSource } from "./pageImport";
import type { PageFormat } from "./exportPage";

// A TEMPLATE PAGE, OPEN (issue #115, slice 1). The note's structure, drawn as
// a readable page with clear actions: the records, the section actions in
// their heads, export and share in the bar, everything else in the page menu.
//
// EVERY EDIT IS ONE WRITE OF THE WHOLE STRUCTURE, through one queue, so two
// taps in a row never read the same stale page. Every edit can be undone: the
// page before it is kept (thirty deep, for this visit), and the bar's Undo
// writes it back. Removing a record also says so with Undo in the toast, the
// app's one convention for anything that goes away.

export interface PendingImport { originalAt: number; rows: string[][]; notes: string[]; name: string; mode: "import" | "reimport" }

type View = "page" | "hole" | "snapshots" | "import" | "lineup";
type Sheet =
  | { k: "record"; id: string | null }
  | { k: "fields" }
  | { k: "removeField"; key: string }
  | { k: "holes"; to: 9 | 18 }
  | { k: "rename" } | { k: "course" } | { k: "date" }
  | { k: "share" }
  | { k: "paste" }
  | { k: "addFromRoster" }
  | { k: "original"; o: PageOriginal }
  | null;

const UNDO_DEPTH = 30;

export default function PageScreen({ noteId, backLabel = "Notes", onBack, onOpenNote, onTrashed, onChanged, pendingImport, onPendingConsumed, startWith = null }: {
  noteId: string;
  backLabel?: string;
  onBack: () => void;
  onOpenNote: (id: string) => void;
  onTrashed: (id: string, title: string) => void;
  onChanged: () => void;
  pendingImport?: PendingImport | null;
  onPendingConsumed?: () => void;
  /** Open straight on the lineup builder (a Lineup Card picked from the templates, with this Team Sheet chosen). */
  startWith?: "lineup" | null;
}) {
  const svc = useNotes();
  const fileStore = useFileStore();
  const tasksSvc = useTasks();
  const [note, setNote] = useState<{ title: string; page: PageData } | null>(null);
  const noteRef = useRef<{ title: string; page: PageData } | null>(null);
  const history = useRef<PageData[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [view, setView] = useState<View>(startWith === "lineup" ? "lineup" : "page");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // Delete Page asks first, naming the page; nothing is written until its Delete is tapped.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [hole, setHole] = useState(1);
  const [pending, setPending] = useState<PendingImport | null>(pendingImport ?? null);
  const [lineups, setLineups] = useState<{ id: string; title: string; date: string }[]>([]);
  const [team, setTeam] = useState<{ id: string; title: string; page: PageData } | null>(null);
  const [teamGone, setTeamGone] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = (fn: () => Promise<void>) => { const next = queue.current.then(fn, fn); queue.current = next.catch(() => {}); return next; };

  const show = (n: { title: string; page: PageData } | null) => { noteRef.current = n; setNote(n); };
  const load = useCallback(async () => {
    const d = (await svc.note(noteId)) as NoteData | null;
    if (!alive.current) return;
    show(d?.page ? { title: d.title, page: d.page } : null);
    if (d?.page?.kind === "team") {
      const items = await svc.listNotes();
      if (!alive.current) return;
      setLineups(items.map((it) => ({ id: it.id, d: it.data as unknown as NoteData }))
        .filter((x) => x.d.page?.kind === "lineup" && x.d.page.lineup?.teamId === noteId)
        .map((x) => ({ id: x.id, title: x.d.title || "Lineup", date: x.d.page!.lineup!.date }))
        .sort((a, b) => b.date.localeCompare(a.date)));
    }
    if (d?.page?.kind === "lineup" && d.page.lineup?.teamId) {
      const t = (await svc.note(d.page.lineup.teamId)) as NoteData | null;
      if (!alive.current) return;
      if (t?.page && !t.deletedAt) { setTeam({ id: d.page.lineup.teamId, title: t.title, page: t.page }); setTeamGone(false); }
      else { setTeam(null); setTeamGone(true); }
    }
  }, [svc, noteId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (pendingImport) { setPending(pendingImport); setView("import"); onPendingConsumed?.(); } }, [pendingImport, onPendingConsumed]);

  /** One edit: the page before it is kept for Undo, the screen moves at once, the write follows in the queue. */
  const commit = (next: PageData, opts: { undoable?: boolean } = {}) => {
    const cur = noteRef.current;
    if (!cur) return Promise.resolve(false);
    if (opts.undoable !== false) {
      history.current = [...history.current, cur.page].slice(-UNDO_DEPTH);
      setCanUndo(true);
    }
    show({ ...cur, page: next });
    let ok = false;
    return enqueue(async () => {
      ok = await attemptWrite(async () => { if (!(await svc.setPage(noteId, next))) throw new Error("gone"); });
      if (!ok) await load();
      else onChanged();
    }).then(() => ok);
  };
  const undo = () => {
    const prev = history.current.pop();
    setCanUndo(history.current.length > 0);
    if (prev) void commit(prev, { undoable: false });
  };

  const picker = usePickFile((f) => void takeTable({ file: f, name: f.name }, noteRef.current?.page.records.length ? "reimport" : "import"));

  // A table for this page, kept first, then read.
  const takeTable = async (src: TableSource, mode: "import" | "reimport") => {
    const cur = noteRef.current;
    if (!cur) return;
    const now = Date.now();
    let kept: Awaited<ReturnType<typeof keepOriginal>>;
    try { kept = await keepOriginal(fileStore, noteId, cur.page, src, now); }
    catch (e) { showToast({ message: lineCase(e instanceof Error ? e.message : "Couldn't Read That File") }); return; }
    const ok = await commit(kept.page, { undoable: false });
    if (!ok) return;
    if (!kept.stored && !kept.original.text) showToast({ message: "Couldn't Keep the Original File" });
    try {
      const t = await readSource(src);
      if (!alive.current) return;
      if (t.rows.length < 2) { showToast({ message: "No Rows in That File" }); return; }
      setPending({ originalAt: kept.original.at, rows: t.rows, notes: t.notes, name: kept.original.name, mode });
      setView("import");
    } catch (e) {
      showToast({ message: lineCase(e instanceof Error ? e.message : "Couldn't Read That File") });
    }
  };

  const bringIn = async (o: PageOriginal) => {
    try {
      const t = await readOriginal(fileStore, o);
      if (!alive.current) return;
      setPending({ originalAt: o.at, rows: t.rows, notes: t.notes, name: o.name, mode: noteRef.current?.page.records.length ? "reimport" : "import" });
      setView("import");
    } catch (e) {
      showToast({ message: lineCase(e instanceof Error ? e.message : "Couldn't Read That File") });
    }
  };

  if (!note) {
    return (
      <div className="screen ruled">
        <div className="nav-bar"><button className="nav-back" onClick={onBack}>{backLabel}</button><span className="nav-title"></span><span></span></div>
      </div>
    );
  }
  const { page, title } = note;
  const shownTitle = title.trim() ? titleCase(title) : KIND_NAME[page.kind];

  // ---- pushed screens
  if (view === "import" && pending) {
    return (
      <ImportReview page={page} sourceName={pending.name} rows={pending.rows} notes={pending.notes} mode={pending.mode}
        onCancel={() => { setPending(null); setView("page"); }}
        onApply={(next, summary) => {
          const before = page;
          void commit(markUsed(next, pending.originalAt)).then((ok) => {
            if (!ok) return;
            showToast({ message: summary, actionLabel: "Undo", onAction: () => { history.current.pop(); setCanUndo(history.current.length > 0); void commit(before, { undoable: false }); } });
          });
          setPending(null);
          setView("page");
        }} />
    );
  }
  if (view === "snapshots") {
    return <SnapshotsScreen page={page} onBack={() => setView("page")} onRestore={(at) => { void commit(restoreSnapshot(page, at, Date.now())); showToast({ message: "Snapshot Restored", actionLabel: "Undo", onAction: undo }); setView("page"); }} />;
  }
  if (view === "lineup" && page.kind === "team" && page.records.length > 0) {
    return (
      <LineupBuilder team={page} teamTitle={shownTitle} onCancel={() => setView("page")}
        onMake={async (picks) => {
          let id: string | null = null;
          const date = todayISO();
          const ok = await attemptWrite(async () => {
            id = await svc.createPage(`${title.trim() || "Team"} Lineup`, newLineupPage({ id: noteId, title: title.trim() || "Team", page }, picks.map((p) => ({ playerId: p })), date, Date.now()), "");
          });
          if (!ok || !id) return;
          onChanged();
          onOpenNote(id);
        }} />
    );
  }

  const g = page.golf;
  const record = sheet?.k === "record" && sheet.id ? page.records.find((r) => r.id === sheet.id) ?? null : null;
  const changes: RosterChange[] | null = page.kind === "lineup" ? (team ? rosterChanges(page, team.page) : null) : null;

  const removeWithUndo = (id: string) => {
    const before = page;
    const r = page.records.find((x) => x.id === id);
    void commit(removeRecord(page, id));
    setSheet(null);
    showToast({ message: lineCase((recordName(page, r!) || "Row") + " removed"), actionLabel: "Undo", onAction: () => void commit(before, { undoable: false }) });
  };

  const makeTask = async (recordId: string, text: string) => {
    let id: string | null = null;
    const ok = await attemptWrite(async () => {
      id = await tasksSvc.createTask(text, { fromNote: noteId, source: { type: "note", ref: noteId, ts: Date.now() } });
      if (id) await svc.addConnection(noteId, "task", text, id);
    });
    const cur = noteRef.current;
    if (!ok || !id || !cur) return;
    const taskId: string = id;
    await commit({ ...cur.page, records: cur.page.records.map((r) => (r.id === recordId ? { ...r, taskId } : r)) }, { undoable: false });
    setSheet(null);
    showToast({ message: "Task Made from the Next Step", actionLabel: "Undo", onAction: () => void (async () => {
      await attemptWrite(async () => {
        await tasksSvc.deleteTask(taskId);
        const d = await svc.note(noteId);
        const conn = (d?.connections ?? []).find((c) => c.targetId === taskId);
        if (conn) await svc.removeConnection(noteId, conn.id);
      });
      const now = noteRef.current;
      if (now) await commit({ ...now.page, records: now.page.records.map((r) => (r.id === recordId ? (({ taskId: _t, ...rest }) => { void _t; return rest; })(r) : r)) }, { undoable: false });
    })() });
  };

  const exported = (format: PageFormat) => {
    const cur = noteRef.current;
    if (!cur) return;
    const snap = takeSnapshot(cur.page, "export", Date.now());
    void commit(format === "pdf" ? snap : markBase(snap), { undoable: false });
  };

  const menu: { label: string; icon: JSX.Element; run: () => void; danger?: boolean }[] = [
    { label: "Rename Page", icon: <PenLine className="ic" />, run: () => setSheet({ k: "rename" }) },
    ...(page.kind === "team" || page.kind === "outreach" ? [{ label: "Fields", icon: <Table className="ic" />, run: () => setSheet({ k: "fields" }) }] : []),
    ...(page.kind === "team" ? [
      { label: page.records.length ? "Bring Back from Sheets" : "Import Rows", icon: <Table className="ic" />, run: () => picker.open(PICK_TABLE) },
      { label: "Paste Rows", icon: <Copy className="ic" />, run: () => setSheet({ k: "paste" }) },
    ] : []),
    { label: "Save Snapshot", icon: <Camera className="ic" />, run: () => { void commit(takeSnapshot(page, "manual", Date.now()), { undoable: false }); showToast({ message: "Snapshot Kept" }); } },
    { label: "Snapshots", icon: <Clock className="ic" />, run: () => setView("snapshots") },
    { label: "Duplicate Page", icon: <Copy className="ic" />, run: () => void (async () => {
      let id: string | null = null;
      const ok = await attemptWrite(async () => { id = await svc.duplicatePage(noteId); });
      if (!ok || !id) return;
      onChanged();
      onOpenNote(id);
    })() },
    { label: "Delete Page", icon: <Trash2 className="ic" />, danger: true, run: () => setConfirmDelete(true) },
  ];

  // ---- the hole screen, pushed over the scorecard
  if (view === "hole" && g) {
    const last = g.holes;
    return (
      <div className="screen ruled">
        <div className="nav-bar">
          <button className="nav-back" onClick={() => setView("page")}>Scorecard</button>
          <span className="nav-title"></span>
          <div className="nav-actions">
            <button className="nav-action" onClick={undo} disabled={!canUndo} aria-label="Undo"><Undo2 className="ic" /></button>
          </div>
        </div>
        <div className="nav-large">Hole {hole}</div>
        <HoleEntry page={page} hole={hole}
          onScore={(id, n) => void commit(setScore(noteRef.current!.page, id, hole, n))}
          onPar={(p) => void commit(setPar(noteRef.current!.page, hole, p))}
          onFillPar={() => {
            let next = noteRef.current!.page;
            for (const r of next.records) if (scoreOf(r, hole) === null) next = setScore(next, r.id, hole, next.golf!.par[hole - 1] ?? 4);
            void commit(next);
          }} />
        <div className="pad-x exp-acts">
          <button type="button" className="btn btn-primary btn-block" onClick={() => (hole < last ? setHole(hole + 1) : setView("page"))}>
            {hole < last ? `Next: Hole ${hole + 1}` : "Finish Round"}
          </button>
          {hole > 1 && <button type="button" className="btn btn-secondary btn-block" onClick={() => setHole(hole - 1)}>Back to Hole {hole - 1}</button>}
        </div>
        <div className="screen-foot" />
      </div>
    );
  }

  return (
    <div className="screen ruled">
      <div className="nav-bar">
        <button className="nav-back" onClick={onBack}>{backLabel}</button>
        <span className="nav-title"></span>
        <div className="nav-actions">
          <button className="nav-action" onClick={undo} disabled={!canUndo} aria-label="Undo"><Undo2 className="ic" /></button>
          <button className="nav-action" onClick={() => setSheet({ k: "share" })} aria-label="Export or Share"><Share className="ic" /></button>
          <button className="nav-action" onClick={() => setMenuOpen((o) => !o)} aria-label="Page options" aria-expanded={menuOpen}><MoreHorizontal className="ic" /></button>
          {menuOpen && (
            <>
              <div className="block-menu-scrim" onClick={() => setMenuOpen(false)} />
              <div className="block-menu note-menu" role="menu">
                {menu.map((m) => (
                  <button key={m.label} className={"block-menu-item" + (m.danger ? " danger" : "")} role="menuitem" onClick={() => { setMenuOpen(false); m.run(); }}>{m.icon} {m.label}</button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="nav-large">{shownTitle}</div>

      {page.kind === "team" && (
        <TeamView page={page} lineups={lineups} onOpen={(id) => setSheet({ k: "record", id })} onAdd={() => setSheet({ k: "record", id: null })}
          onMakeLineup={() => setView("lineup")} onOpenLineup={onOpenNote} />
      )}
      {page.kind === "outreach" && <OutreachView page={page} onOpen={(id) => setSheet({ k: "record", id })} onAdd={() => setSheet({ k: "record", id: null })} />}
      {page.kind === "lineup" && (
        <LineupView page={page} changes={changes} onOpen={(id) => setSheet({ k: "record", id })}
          onAdd={team ? () => setSheet({ k: "addFromRoster" }) : undefined}
          onRefresh={team ? () => { void commit(refreshFromRoster(page, team.page, Date.now())); showToast({ message: "Roster Names In", actionLabel: "Undo", onAction: undo }); } : undefined}
          onOpenTeam={team ? () => onOpenNote(team.id) : undefined}
          onDate={() => setSheet({ k: "date" })} />
      )}
      {page.kind === "lineup" && teamGone && <Card><Row label="Team Sheet Deleted; This Lineup Keeps Its Names" /></Card>}
      {page.kind === "scorecard" && g && (
        <ScorecardView page={page} onHole={() => { setHole(nextHole(page)); setView("hole"); }}
          onPlayer={(id) => setSheet({ k: "record", id })} onAddPlayer={() => setSheet({ k: "record", id: null })}
          onCourse={() => setSheet({ k: "course" })} onDate={() => setSheet({ k: "date" })}
          onHoles={(h) => { if (h === g.holes) return; if (holesImpact(page, h) > 0) setSheet({ k: "holes", to: h }); else void commit(setHoles(page, h)); }} />
      )}

      {(page.originals ?? []).length > 0 && (
        <>
          <Head label="Originals" count={page.originals!.length} />
          <Card>
            {[...page.originals!].reverse().map((o) => {
              const iso = new Date(o.at).toISOString().slice(0, 10);
              return (
                <Row key={o.at} label={<U>{o.name}</U>} chev
                  onClick={() => (!o.used && page.kind === "team" ? void bringIn(o) : setSheet({ k: "original", o }))}
                  meta={<><span className="fact date">{monthDay(iso)}</span>{!o.used && <span className="fact warn">Not Brought In Yet</span>}</>} />
              );
            })}
          </Card>
        </>
      )}
      <div className="screen-foot" />

      {sheet?.k === "record" && (
        <RecordSheet page={page} record={record} isNew={!sheet.id}
          onCancel={() => setSheet(null)}
          onSave={(values) => {
            if (!sheet.id) {
              const cur = noteRef.current!.page;
              const values2 = page.kind === "scorecard" && !(values.name ?? "").trim() ? { ...values, name: `Player ${cur.records.length + 1}` } : values;
              void commit(addRecord(cur, values2).page);
            } else if (Object.keys(values).length) void commit(setValues(noteRef.current!.page, sheet.id, values));
            setSheet(null);
          }}
          onRemove={sheet.id && !(page.kind === "scorecard" && page.records.length <= 1) ? () => removeWithUndo(sheet.id!) : undefined}
          onKeep={sheet.id ? (key) => { void commit(confirmValue(noteRef.current!.page, sheet.id!, key)); setSheet(null); } : undefined}
          onMakeTask={page.kind === "outreach" && sheet.id ? (text) => void makeTask(sheet.id!, text) : undefined}
          taskMade={!!record?.taskId}
          onMove={page.kind === "lineup" && sheet.id ? (by) => void commit(moveRecord(noteRef.current!.page, sheet.id!, by)) : undefined} />
      )}
      {sheet?.k === "fields" && (
        <FieldsSheet page={page} onCancel={() => setSheet(null)} onRemove={(key) => setSheet({ k: "removeField", key })}
          onSave={(labels, added) => {
            let next = noteRef.current!.page;
            for (const [k, l] of Object.entries(labels)) if (l.trim() && l.trim() !== labelOf(next, k)) next = renameField(next, k, l);
            if (added.trim()) next = addField(next, added).page;
            if (next !== noteRef.current!.page) void commit(next);
            setSheet(null);
          }} />
      )}
      {sheet?.k === "removeField" && (
        <ConfirmChange title={"Remove " + labelOf(page, sheet.key)} lines={fieldRemovalLines(page, sheet.key)} action="Remove"
          onCancel={() => setSheet({ k: "fields" })}
          onApply={() => { void commit(removeField(noteRef.current!.page, sheet.key, Date.now())); setSheet(null); showToast({ message: "Field Removed", actionLabel: "Undo", onAction: undo }); }} />
      )}
      {sheet?.k === "holes" && (
        <ConfirmChange title="Show 9 Holes" action="Show 9"
          lines={[`${holesImpact(page, 9) === 1 ? "1 Score" : holesImpact(page, 9) + " Scores"} on Holes 10 to 18 Are Hidden, Never Deleted`, "Switch Back to 18 and They Return"]}
          onCancel={() => setSheet(null)} onApply={() => { void commit(setHoles(noteRef.current!.page, sheet.to)); setSheet(null); }} />
      )}
      {sheet?.k === "rename" && (
        <OneFieldSheet title="Rename Page" label="Page Name" value={title} onCancel={() => setSheet(null)}
          onSave={(v) => { setSheet(null); if (!v.trim()) return; void enqueue(async () => { if (await attemptWrite(() => svc.editTitle(noteId, v.trim()))) { await load(); onChanged(); } }); }} />
      )}
      {sheet?.k === "course" && g && (
        <OneFieldSheet title="Course" label="Course Name" value={g.course} onCancel={() => setSheet(null)}
          onSave={(v) => { setSheet(null); void commit({ ...noteRef.current!.page, golf: { ...g, course: v.trim() } }); }} />
      )}
      {sheet?.k === "date" && (
        <OneFieldSheet title="Date" label="Date" type="date" value={g?.date ?? page.lineup?.date ?? todayISO()} onCancel={() => setSheet(null)}
          onSave={(v) => {
            setSheet(null);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
            const cur = noteRef.current!.page;
            void commit(cur.golf ? { ...cur, golf: { ...cur.golf, date: v } } : { ...cur, lineup: { ...cur.lineup!, date: v } });
          }} />
      )}
      {sheet?.k === "share" && (
        <PageShareSheet title={shownTitle} page={page} onClose={() => setSheet(null)} onExported={exported} />
      )}
      {sheet?.k === "paste" && <PasteSheet onCancel={() => setSheet(null)} onBringIn={(text) => { setSheet(null); void takeTable({ text, name: "Pasted Rows" }, page.records.length ? "reimport" : "import"); }} />}
      {sheet?.k === "addFromRoster" && team && (
        <AddFromRoster team={team.page} taken={new Set(page.records.map((r) => r.v.player ?? ""))} onCancel={() => setSheet(null)}
          onPick={(playerId) => {
            setSheet(null);
            const p = team.page.records.find((r) => r.id === playerId);
            if (!p) return;
            void commit(addRecord(noteRef.current!.page, { player: p.id, name: p.v.name ?? "", number: p.v.number ?? "", position: p.v.position ?? "" }).page);
          }} />
      )}
      {sheet?.k === "original" && (
        <OriginalSheet o={sheet.o} onCancel={() => setSheet(null)} onOpen={async () => {
          const o = sheet.o;
          setSheet(null);
          const url = o.path && fileStore ? await fileStore.url(o.path) : null;
          if (url) window.open(url, "_blank", "noopener");
          else showToast({ message: "Couldn't Open the Original" });
        }} />
      )}
      {confirmDelete && (
        <RowActionSheet
          title={deleteAskTitle(shownTitle)}
          cancelFirst
          actions={[{ label: "Delete Page", destructive: true, onPick: () => void (async () => {
            const ok = await attemptWrite(() => svc.trashNote(noteId));
            if (ok) onTrashed(noteId, shownTitle);
          })() }]}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
      {picker.input}
    </div>
  );
}

function PasteSheet({ onBringIn, onCancel }: { onBringIn: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState("");
  return (
    <FormSheet title="Paste Rows" saveLabel="Next" saveDisabled={!text.trim()} onCancel={onCancel} onSave={() => onBringIn(text)}>
      <Group label="Rows">
        <TextRow ariaLabel="Pasted rows" placeholder="Name, Number, Position" value={text} onChange={setText} rows={8} />
      </Group>
      <Note>Copy Rows from Sheets or Excel, Header First; You Confirm Every Column Next</Note>
    </FormSheet>
  );
}

function AddFromRoster({ team, taken, onPick, onCancel }: { team: PageData; taken: Set<string>; onPick: (id: string) => void; onCancel: () => void }) {
  const left = team.records.filter((r) => !taken.has(r.id));
  return (
    <FormSheet title="Add from Roster" saveLabel="Done" onCancel={onCancel} onSave={onCancel}>
      {left.length === 0 ? <Note>Everyone on the Roster Is in This Lineup</Note> : (
        <Group label="Roster">
          {left.map((r) => <RosterPick key={r.id} name={recordName(team, r) || "Unnamed Player"} onPick={() => onPick(r.id)} />)}
        </Group>
      )}
    </FormSheet>
  );
}

function RosterPick({ name, onPick }: { name: string; onPick: () => void }) {
  return <div className="row xs-row" role="button" tabIndex={0} onClick={onPick} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(); } }}>
    <ListOrdered className="ic" /><div className="conn-name"><U>{name}</U></div>
  </div>;
}

function OriginalSheet({ o, onOpen, onCancel }: { o: PageOriginal; onOpen: () => void; onCancel: () => void }) {
  return (
    <FormSheet title="Original" saveLabel={o.path ? "Open" : "Done"} onCancel={onCancel} onSave={o.path ? onOpen : onCancel}>
      <Group label={o.name}>
        {o.text !== undefined
          ? <pre className="exp-preview" data-user-text="">{o.text.slice(0, 4000)}</pre>
          : <div className="row xs-row"><Search className="ic" /><div className="conn-name">Kept as It Came</div></div>}
      </Group>
      <Note>Kept as It Came; the Page Never Changes It</Note>
    </FormSheet>
  );
}
