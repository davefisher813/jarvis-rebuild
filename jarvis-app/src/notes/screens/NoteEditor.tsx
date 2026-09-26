import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, FileText, Image, Check, Plus, X, Trash2, Archive, Tag, Link2, ListChecks, Copy, Share, Search, AlignLeft, ArrowUp, ArrowDown, Clock } from "../../shared/icons";
import type { FoundCandidate, NoteVersion } from "../types";
import { catColor } from "../../shared/categories";
import InlineEdit from "../../shared/InlineEdit";
import DocEditor, { type DocEditorHandle } from "../../shared/DocEditor";
import type { Doc } from "../docModel";
import { docWordCount } from "../docModel";
import { docToMarkdown, docToPlainText } from "../markdown";
import type { ExportImage } from "../exportDoc";
import ExportSheet from "./ExportSheet";
import RowActionSheet from "../../shared/RowActionSheet";
import AISheet from "./AISheet";
import { AI_ACTIONS, runAction, type AIActionKey } from "../aiActions";
import { parseMarkdown } from "../markdown";
import type { AIService } from "../../ai/AIService";
import { copyText } from "../../shared/shareText";
import { showToast } from "../../shared/toast";
import Provenance from "../../shared/ProvenanceLine";
import { HyperfocusLine, useHyperfocusGuard } from "../../today/useHyperfocusGuard";
import type { Source } from "../../shared/provenance";
import { connIcon, type Conn } from "./Connections";
import { capAfterNumber } from "../../shared/casing";
import { useFileUrl } from "../../files/useFileUrl";
import type { FileStore } from "../../files/FileStore";
import { pressable } from "../../shared/pressable";

// THE NOTE SCREEN (the writing system, 2026-09-14).
//
// One continuous document (shared/DocEditor.tsx) under a title, and nothing
// between them. The header is Back, Copy, Export and More; Delete,
// Connections, Pin, Tags, Archive, Copy As, Export Selection and the
// checklist-to-tasks door live inside More. The connections, what JARVIS
// found, the notes that link here and the word count sit under the document.
//
// Saving is not a control. The flow writes the document as it changes and
// says so in one line under it: Saved on device, Synced, or Couldn't save
// with a Retry. Nothing reads "saved" before the write returned.
//
// COPY (wave 2): the header Copy takes the whole note, title first, as
// readable text; Copy As offers the body only, plain text, or Markdown. The
// confirmation comes only after the clipboard accepted it; when the browser
// refuses the clipboard, the words open in a field already selected so the
// native copy is one press away. Native copy of a selection is untouched.
//
// EXPORT (wave 2): the header Export opens the sheet on the latest editor
// content, unsaved edits included, with the photos' bytes read first so the
// sheet can embed them; Export Selection does the same for the selection.

export type SaveState = "idle" | "saving" | "saved" | "synced" | "failed";

export interface EditorAttachment { id: string; type: "file" | "photo"; name: string; size: string; path?: string; mime?: string }

export interface EditorNote {
  category: string;
  eyebrow: string;
  title: string;
  doc: Doc;
  attachments: EditorAttachment[];
  source?: Source;
}

function Attachment({ a, store, onRemove }: { a: EditorAttachment; store?: FileStore | null; onRemove?: (id: string) => void }) {
  const url = useFileUrl(store ?? null, a.path);
  const open = () => { if (url) window.open(url, "_blank", "noopener"); };
  const trash = onRemove && (
    <button className="conn-remove" aria-label={"Remove " + a.name} onClick={(e) => { e.stopPropagation(); onRemove(a.id); }}>
      <Trash2 className="ic" />
    </button>
  );
  if (a.type === "photo" && url) {
    return (
      <div className="note-photo">
        <img className="note-photo-img" src={url} alt={a.name} onClick={open} />
        <div className="row note-photo-row">
          <div className="conn-name truncate">{a.name}</div>
          {a.size && <div className="conn-meta">{a.size}</div>}
          {trash}
        </div>
      </div>
    );
  }
  return (
    <div className={"row" + (url ? " note-file-open" : "")} role={url ? "button" : undefined} tabIndex={url ? 0 : undefined} onClick={url ? open : undefined}>
      <span className={a.type === "file" ? "fg-red" : "fg-blue"}>
        {a.type === "file" ? <FileText className="ic" /> : <Image className="ic" />}
      </span>
      <div className="conn-name truncate">{a.name}</div>
      {a.size && <div className="conn-meta">{a.size}</div>}
      {trash}
    </div>
  );
}

// The words in a field already selected: the fallback when the clipboard
// is refused, so the person's own Copy is one press away.
function CopyFallback({ text, onClose }: { text: string; onClose: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Copy the Words</div></div>
        <div className="pad-x sheet-form">
          <div className="exp-note">This browser did not let JARVIS copy for you</div>
          <div className="exp-note">The words are selected: press Copy on your keyboard or in the menu</div>
          <textarea className="copy-fallback" ref={ref} readOnly value={text} aria-label="The note, ready to copy" />
          <div className="exp-acts"><button type="button" className="btn btn-secondary" onClick={onClose}>Done</button></div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

type CopyKind = "full" | "body" | "plain" | "markdown";

// When a version was kept, as words a person reads: the time on its day.
function versionWhen(at: number, now = Date.now()): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const today = new Date(now);
  const sameDay = d.toDateString() === today.toDateString();
  const yesterday = new Date(now - 86400000).toDateString() === d.toDateString();
  return sameDay ? "Today " + time : yesterday ? "Yesterday " + time : d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + time;
}

// VERSION HISTORY (wave 3b): the kept versions as rows, newest first; a tap
// shows the words and offers Restore. Restoring keeps the current document
// as a version first (NotesService.restoreVersion), so nothing is lost.
function VersionsSheet({ versions, onRestore, onClose }: { versions: NoteVersion[]; onRestore: (at: number) => void; onClose: () => void }) {
  const [open, setOpen] = useState<NoteVersion | null>(null);
  const rows = [...versions].reverse();
  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card doc-outline" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{open ? versionWhen(open.at) : "Version History"}</div></div>
        {open ? (
          <div className="pad-x sheet-form">
            <pre className="exp-preview">{docToPlainText(open.doc, { includeTitle: false })}</pre>
            <div className="exp-acts">
              <button type="button" className="btn btn-primary" onClick={() => { onClose(); onRestore(open.at); }}>Restore This Version</button>
              <button type="button" className="btn btn-secondary" onClick={() => setOpen(null)}>Back</button>
            </div>
          </div>
        ) : (
          <>
            <div className="list-card-ruled">
              {rows.map((v) => (
                <div className="row" key={v.at} role="button" tabIndex={0} onClick={() => setOpen(v)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(v); } }}>
                  <div className="row-grow">
                    <div className="conn-name">{versionWhen(v.at)}</div>
                    <div className="facts"><span className="fact">{capAfterNumber(`${docWordCount(v.doc)} ${docWordCount(v.doc) === 1 ? "word" : "words"}`)}</span></div>
                  </div>
                  <div className="chev" />
                </div>
              ))}
            </div>
            <div className="pad-x sheet-actions"><button type="button" className="btn btn-secondary btn-block" onClick={onClose}>Done</button></div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

// THE OUTLINE (wave 3): every heading as a row, indented by level; a tap
// puts the caret there.
function OutlineSheet({ items, onPick, onClose }: { items: { pos: number; level: number; text: string }[]; onPick: (pos: number) => void; onClose: () => void }) {
  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card doc-outline" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Outline</div></div>
        <div className="list-card-ruled">
          {items.length === 0 && <div className="row"><div className="row-grow"><div className="conn-name">No Headings Yet</div></div></div>}
          {items.map((h) => (
            <div className={"row lv-" + h.level} key={h.pos} role="button" tabIndex={0} onClick={() => { onClose(); onPick(h.pos); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClose(); onPick(h.pos); } }}>
              <div className="row-grow"><div className="conn-name">{h.text || "Untitled Heading"}</div></div>
              <div className="chev" />
            </div>
          ))}
        </div>
        <div className="pad-x sheet-actions"><button type="button" className="btn btn-secondary btn-block" onClick={onClose}>Done</button></div>
      </div>
    </div>,
    document.body,
  );
}

// FIND IN NOTE (wave 3): a query, the count, next and previous, and a
// replacement with Replace and Replace All. Every match is on a tint in the
// document; Replace All is one Undo.
function FindBar({ editor, onClose }: { editor: DocEditorHandle | null; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [repl, setRepl] = useState("");
  const [, setTick] = useState(0);
  const bump = () => setTick((t) => t + 1);
  const findRef = useRef<HTMLInputElement>(null);
  const replRef = useRef<HTMLInputElement>(null);
  // Row tap (Dave 2026-09-15, "I want all rows clickable"): a tap on the
  // line's bare ground focuses its field; its own controls keep their taps.
  const focusOn = (ref: { current: HTMLInputElement | null }) => (e: { target: EventTarget }) => {
    if (!(e.target instanceof Element) || !e.target.closest("button, input")) ref.current?.focus();
  };
  const s = editor?.search() ?? { query: "", matches: [], index: 0 };
  const count = s.matches.length;
  useEffect(() => { editor?.setSearch(query); bump(); }, [query, editor]);
  useEffect(() => () => { editor?.setSearch(""); }, [editor]);
  return (
    <div className="doc-find" role="search" aria-label="Find in note">
      <div className="doc-find-row" onClick={focusOn(findRef)}>
        <input ref={findRef} className="input" aria-label="Find" placeholder="Find" value={query} autoFocus onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); editor?.stepSearch(e.shiftKey ? -1 : 1); bump(); } }} />
        <span className="doc-find-n" aria-live="polite">{query ? (count === 0 ? "None" : (s.index + 1) + " of " + count) : ""}</span>
        <button type="button" className="pill-act pill-quiet" aria-label="Previous match" disabled={count === 0} onClick={() => { editor?.stepSearch(-1); bump(); }}><ArrowUp className="ic" /></button>
        <button type="button" className="pill-act pill-quiet" aria-label="Next match" disabled={count === 0} onClick={() => { editor?.stepSearch(1); bump(); }}><ArrowDown className="ic" /></button>
        <button type="button" className="pill-act pill-quiet" aria-label="Close find" onClick={onClose}><X className="ic" /></button>
      </div>
      <div className="doc-find-row" onClick={focusOn(replRef)}>
        <input ref={replRef} className="input" aria-label="Replace with" placeholder="Replace With" value={repl} onChange={(e) => setRepl(e.target.value)} />
        <button type="button" className="pill-act pill-quiet" disabled={count === 0} onClick={() => { editor?.replaceCurrent(repl); bump(); }}>Replace</button>
        <button type="button" className="pill-act pill-quiet" disabled={count === 0} onClick={() => { const n = editor?.replaceAll(repl) ?? 0; bump(); if (n) showToast({ message: capAfterNumber(n === 1 ? "1 replaced" : n + " replaced") }); }}>Replace All</button>
      </div>
    </div>
  );
}

export default function NoteEditor({
  note,
  fileStore,
  saveState = "idle",
  onRetrySave,
  onBack,
  onEditTitle,
  onDocChange,
  onConnections,
  onDeleteNote,
  onDeleteAttachment,
  onInsertPhoto,
  onInsertFile,
  onCreateTasks,
  pinned,
  archived,
  tags,
  onPin,
  onArchive,
  onTags,
  linkedFrom,
  related,
  onOpenNote,
  found,
  onFoundAdd,
  onFoundLink,
  connections,
  onAddLink,
  onRemoveConnection,
  onOpenConnection,
  openSourceFor,
  versions = [],
  onRestoreVersion,
  ai,
  onCreateLinkedTask,
}: {
  note: EditorNote;
  fileStore?: FileStore | null;
  saveState?: SaveState;
  onRetrySave?: () => void;
  onBack: () => void;
  onEditTitle?: (text: string) => void;
  onDocChange: (doc: Doc) => void;
  onConnections?: () => void;
  onDeleteNote?: () => void;
  onDeleteAttachment?: (id: string) => void;
  onInsertPhoto?: () => void;
  onInsertFile?: () => void;
  onCreateTasks?: () => void;
  pinned?: boolean;
  archived?: boolean;
  tags?: string[];
  onPin?: () => void;
  onArchive?: () => void;
  onTags?: () => void;
  linkedFrom?: { id: string; title: string }[];
  related?: { id: string; title: string; shared: number }[];
  onOpenNote?: (id: string) => void;
  found?: FoundCandidate[];
  onFoundAdd?: (index: number) => void;
  onFoundLink?: (index: number) => void;
  connections?: Conn[];
  onAddLink?: () => void;
  onRemoveConnection?: (connId: string) => void;
  onOpenConnection?: (kind: string, targetId: string) => void;
  openSourceFor?: (source: Source) => (() => void) | undefined;
  versions?: NoteVersion[];
  onRestoreVersion?: (at: number) => void;
  /** JARVIS on a selection (wave 4): present when AI is on. */
  ai?: AIService | null;
  /** A task from the selected passage, linked back to this note. */
  onCreateLinkedTask?: (passage: string) => void;
}) {
  const guard = useHyperfocusGuard();
  const [menuOpen, setMenuOpen] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const [relatedOpen, setRelatedOpen] = useState(false);
  const [copyAsOpen, setCopyAsOpen] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState<{ doc: Doc; selection: boolean; images: ExportImage[]; names: string[] } | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [outline, setOutline] = useState<{ pos: number; level: number; text: string }[] | null>(null);
  const [inSection, setInSection] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  // JARVIS ON A SELECTION (wave 4): which words, which ask, and the reply.
  const [aiPick, setAiPick] = useState<{ from: number; to: number; text: string } | null>(null);
  const [aiRun, setAiRun] = useState<{ action: AIActionKey; from: number; to: number; text: string; result: string | null; error: string | null } | null>(null);
  const runAI = async (action: AIActionKey, sel: { from: number; to: number; text: string }) => {
    if (!ai) return;
    setAiRun({ action, ...sel, result: null, error: null });
    try {
      const result = await runAction(ai, action, sel.text);
      setAiRun((cur) => (cur && cur.action === action && cur.from === sel.from ? { ...cur, result } : cur));
    } catch (e) {
      setAiRun((cur) => (cur && cur.action === action && cur.from === sel.from ? { ...cur, error: e instanceof Error && e.message ? e.message : "JARVIS could not answer" } : cur));
    }
  };
  const [preparing, setPreparing] = useState(false);
  const editorRef = useRef<DocEditorHandle>(null);
  const aiStale = !!aiRun && editorRef.current?.textAt(aiRun.from, aiRun.to) !== aiRun.text;
  const foundLive = (found ?? []).map((c, i) => ({ c, i })).filter(({ c }) => !c.added);
  const foundVerb = (kind: FoundCandidate["kind"], i: number): (() => void) | null => {
    if (kind === "task" || kind === "decision") return onFoundAdd ? () => onFoundAdd(i) : null;
    return onFoundLink ? () => onFoundLink(i) : null;
  };
  const words = docWordCount(note.doc);
  const hasChecklist = (note.doc.content ?? []).some((n) => n.type === "taskList");
  const liveDoc = (): Doc => editorRef.current?.getDoc() ?? note.doc;
  const title = note.title.trim();

  const copy = async (kind: CopyKind) => {
    const doc = liveDoc();
    const text = kind === "markdown" ? docToMarkdown(doc, { title }) : docToPlainText(doc, { title, includeTitle: kind !== "body" });
    try {
      await copyText(text);
      showToast({ message: kind === "body" ? "Body copied" : kind === "markdown" ? "Copied as Markdown" : "Note copied" });
    } catch {
      setFallback(text);
    }
  };

  // The photos' bytes, so PDF and Word can carry them; a photo that cannot
  // be read is listed by name instead of silently dropped.
  const prepareExport = async (selection: boolean) => {
    const doc = selection ? editorRef.current?.getSelectionDoc() : liveDoc();
    if (!doc) return;
    setPreparing(true);
    const images: ExportImage[] = [];
    const names: string[] = [];
    for (const a of selection ? [] : note.attachments) {
      if (a.type !== "photo" || !a.path || !fileStore) { names.push(a.name); continue; }
      try {
        const url = await fileStore.url(a.path);
        if (!url) { names.push(a.name); continue; }
        const res = await fetch(url);
        const bytes = await res.arrayBuffer();
        const dims = await imageSize(url);
        images.push({ name: a.name, bytes, mime: a.mime ?? res.headers.get("content-type") ?? "image/jpeg", ...(dims ?? {}) });
      } catch {
        names.push(a.name);
      }
    }
    setPreparing(false);
    setExportOpen({ doc, selection, images, names });
  };

  const openMenu = () => {
    setHasSelection(!!editorRef.current?.getSelectionDoc());
    setInSection(!!editorRef.current?.inSection());
    setMenuOpen((o) => !o);
  };
  const copySection = async () => {
    const doc = editorRef.current?.sectionDoc();
    if (!doc) return;
    const text = docToPlainText(doc, { includeTitle: false });
    try { await copyText(text); showToast({ message: "Section copied" }); } catch { setFallback(text); }
  };

  const saveLine =
    saveState === "failed" ? <span className="doc-save failed" role="status">Couldn't save{onRetrySave && <button type="button" className="pill-act" onClick={onRetrySave}>Retry</button>}</span>
    : saveState === "saving" ? <span className="doc-save" role="status">Saving</span>
    : saveState === "synced" ? <span className="doc-save" role="status">Synced</span>
    : saveState === "saved" ? <span className="doc-save" role="status">Saved on device</span>
    : <span className="doc-save" />;

  return (
    <div className="screen screen-editor ruled">
      <div className="nav-bar">
        <button className="nav-back" onClick={onBack}>Notes</button>
        <span className="nav-title"></span>
        <div className="nav-actions">
          <button className="nav-action" onMouseDown={(e) => e.preventDefault()} onClick={() => void copy("full")} aria-label="Copy Note">
            <Copy className="ic" />
          </button>
          <button className="nav-action" onMouseDown={(e) => e.preventDefault()} onClick={() => void prepareExport(false)} aria-label="Export Note" disabled={preparing}>
            <Share className="ic" />
          </button>
          <button className="nav-action" onMouseDown={(e) => e.preventDefault()} onClick={openMenu} aria-label="Note options" aria-expanded={menuOpen}>
            <MoreHorizontal className="ic" />
          </button>
          {menuOpen && (
            <>
              <div className="block-menu-scrim" onClick={() => setMenuOpen(false)} />
              <div className="block-menu note-menu" role="menu">
                {onConnections && (
                  <button className="block-menu-item" role="menuitem" onClick={() => { setMenuOpen(false); onConnections(); }}><Link2 className="ic" /> Connections</button>
                )}
                {onPin && (
                  <button className="block-menu-item" role="menuitem" onClick={() => { setMenuOpen(false); onPin(); }}><Check className="ic" /> {pinned ? "Unpin Note" : "Pin Note"}</button>
                )}
                {onTags && (
                  <button className="block-menu-item" role="menuitem" onClick={() => { setMenuOpen(false); onTags(); }}><Tag className="ic" /> Tags</button>
                )}
                <button className="block-menu-item" role="menuitem" onClick={() => { setMenuOpen(false); setCopyAsOpen(true); }}><Copy className="ic" /> Copy As</button>
                <button className="block-menu-item" role="menuitem" onClick={() => { setMenuOpen(false); setFindOpen(true); }}><Search className="ic" /> Find in Note</button>
                <button className="block-menu-item" role="menuitem" onClick={() => { setMenuOpen(false); setOutline(editorRef.current?.outline() ?? []); }}><AlignLeft className="ic" /> Outline</button>
                {inSection && (
                  <>
                    <button className="block-menu-item" role="menuitem" onClick={() => { setMenuOpen(false); editorRef.current?.moveSection(-1); }}><ArrowUp className="ic" /> Move Section Up</button>
                    <button className="block-menu-item" role="menuitem" onClick={() => { setMenuOpen(false); editorRef.current?.moveSection(1); }}><ArrowDown className="ic" /> Move Section Down</button>
                    <button className="block-menu-item" role="menuitem" onClick={() => { setMenuOpen(false); void copySection(); }}><Copy className="ic" /> Copy Section</button>
                  </>
                )}
                {hasSelection && (
                  <button className="block-menu-item" role="menuitem" onClick={() => { setMenuOpen(false); void prepareExport(true); }}><Share className="ic" /> Export Selection</button>
                )}
                {onRestoreVersion && versions.length > 0 && (
                  <button className="block-menu-item" role="menuitem" onClick={() => { setMenuOpen(false); setVersionsOpen(true); }}><Clock className="ic" /> Version History</button>
                )}
                {onCreateTasks && hasChecklist && (
                  <button className="block-menu-item" role="menuitem" onClick={() => { setMenuOpen(false); onCreateTasks(); }}><ListChecks className="ic" /> Make Tasks from Checklist</button>
                )}
                {onArchive && (
                  <button className="block-menu-item" role="menuitem" onClick={() => { setMenuOpen(false); onArchive(); }}><Archive className="ic" /> {archived ? "Unarchive" : "Archive"}</button>
                )}
                {onDeleteNote && (
                  <button className="block-menu-item danger" role="menuitem" onClick={() => { setMenuOpen(false); onDeleteNote(); }}><Trash2 className="ic" /> Delete Note</button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="doc doc-write">
        {note.eyebrow && (
          <div className="doc-eyebrow">
            <span className={"cat-dot cat-bg-" + catColor(note.category)} />
            <span className={"eyebrow cat-fg-" + catColor(note.category)}>{note.eyebrow}</span>
          </div>
        )}
        <InlineEdit tag="div" className="doc-title" value={note.title} placeholder="Title" onSave={onEditTitle} />
        {findOpen && <FindBar editor={editorRef.current} onClose={() => setFindOpen(false)} />}
        <DocEditor
          ref={editorRef}
          doc={note.doc}
          docKey={note.title + " " + note.attachments.length + " " + (note.source?.ref ?? "")}
          onChange={onDocChange}
          level="document"
          placeholder="Start Writing"
          ariaLabel="Note"
          onInsertPhoto={onInsertPhoto}
          onInsertFile={onInsertFile}
          onAI={ai?.available ? () => { const sel = editorRef.current?.getSelection(); if (sel) setAiPick(sel); } : undefined}
        />
        {saveLine}
        {(tags ?? []).length > 0 && (
          <div className="facts note-tags">{(tags ?? []).map((t) => <span className="fact" key={t}>#{t}</span>)}</div>
        )}
        <Provenance source={note.source} {...(note.source && openSourceFor ? { onOpen: openSourceFor(note.source) } : {})} />
        <HyperfocusLine guard={guard} />

        {(connections && connections.length > 0) || onAddLink ? (
          <div className="note-conns">
            {(connections ?? []).map((c) => {
              const ic = connIcon(c.kind);
              const canOpen = !c.gone && !!(onOpenConnection && c.targetId);
              const open = () => onOpenConnection!(c.kind, c.targetId!);
              return (
                <span className={"note-conn" + (c.gone ? " conn-gone" : "")} key={c.id}>
                  <span className={"proj-icon " + ic.cls} role={canOpen ? "button" : undefined} tabIndex={canOpen ? 0 : undefined} onClick={canOpen ? open : undefined} aria-hidden={!canOpen}>
                    {ic.node}
                  </span>
                  <span className="note-conn-label" role={canOpen ? "button" : undefined} tabIndex={canOpen ? 0 : undefined} onClick={canOpen ? open : undefined}>
                    {c.label}{c.gone ? " · Gone" : ""}
                  </span>
                  {onRemoveConnection && (
                    <button className="note-conn-x" aria-label={"Unlink " + c.label} onClick={() => onRemoveConnection(c.id)}>
                      <X className="ic" />
                    </button>
                  )}
                </span>
              );
            })}
            {onAddLink && (
              <button className={"note-conn-add" + ((connections ?? []).length === 0 ? " note-conn-first" : "")} aria-label="Link Something" onClick={onAddLink}>
                <Plus className="ic" />
                {(connections ?? []).length === 0 && <span>Link Something</span>}
              </button>
            )}
          </div>
        ) : null}
      </div>

      {note.attachments.length > 0 && (
        <div className="pad-x">
          <div className="card list-card-ruled">
            {note.attachments.map((a) => <Attachment a={a} store={fileStore} onRemove={onDeleteAttachment} key={a.id} />)}
          </div>
        </div>
      )}

      {foundLive.length > 0 && (onFoundAdd || onFoundLink) && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">JARVIS Found</span><span className="n">{foundLive.length}</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {foundLive.map(({ c, i }) => (
              // Row tap (Dave 2026-09-15): nothing exists to open until it is
              // added or linked, so the row does its pill's verb.
              <div className="row" key={c.kind + ":" + i} {...(foundVerb(c.kind, i) ? pressable(foundVerb(c.kind, i)!) : {})}>
                <div className={"proj-icon " + connIcon(c.kind === "decision" ? "decision" : c.kind).cls}>{connIcon(c.kind === "decision" ? "decision" : c.kind).node}</div>
                <div className="row-grow">
                  <div className="conn-name">{c.text}</div>
                  <div className="facts">
                    <span className="fact">{c.kind === "task" ? "Task" : c.kind === "decision" ? "Decision" : c.kind === "person" ? "Person" : "Project"}</span>
                    {c.due && <span className="fact date">{c.due}</span>}
                  </div>
                </div>
                {(c.kind === "task" || c.kind === "decision")
                  ? (onFoundAdd && <button type="button" className="pill-act" onClick={(ev) => { ev.stopPropagation(); onFoundAdd(i); }}>Add</button>)
                  : (onFoundLink && <button type="button" className="pill-act" onClick={(ev) => { ev.stopPropagation(); onFoundLink(i); }}>Link</button>)}
              </div>
            ))}
          </div></div>
        </>
      )}

      {(linkedFrom ?? []).length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Linked From</span><span className="n">{linkedFrom!.length}</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {linkedFrom!.map((n) => (
              <div className="row" key={n.id} {...(onOpenNote ? { role: "button", tabIndex: 0, onClick: () => onOpenNote(n.id), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenNote(n.id); } } } : {})}>
                <div className="proj-icon cat-bg-yellow"><FileText className="ic" /></div>
                <div className="row-grow"><div className="conn-name">{n.title}</div></div>
                {onOpenNote && <div className="chev" />}
              </div>
            ))}
          </div></div>
        </>
      )}
      {(related ?? []).length > 0 && (
        <>
          <div className="sh2 sh2-quiet">
            <span className="t">Related</span>
            <button type="button" className="see-all pill-action" aria-expanded={relatedOpen} onClick={() => setRelatedOpen((o) => !o)}>{relatedOpen ? "Hide" : capAfterNumber(`${related!.length} ${related!.length === 1 ? "note" : "notes"}`)}</button>
          </div>
          {relatedOpen && (
            <div className="pad-x"><div className="card list-card-ruled">
              {related!.map((n) => (
                <div className="row" key={n.id} {...(onOpenNote ? { role: "button", tabIndex: 0, onClick: () => onOpenNote(n.id), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenNote(n.id); } } } : {})}>
                  <div className="proj-icon cat-bg-yellow"><FileText className="ic" /></div>
                  <div className="row-grow">
                    <div className="conn-name">{n.title}</div>
                    <div className="facts"><span className="fact">{capAfterNumber(`${n.shared} shared`)}</span></div>
                  </div>
                  {onOpenNote && <div className="chev" />}
                </div>
              ))}
            </div></div>
          )}
        </>
      )}

      {words > 0 && <div className="doc-count">{capAfterNumber(words === 1 ? "1 word" : words + " words")}</div>}

      {copyAsOpen && (
        <RowActionSheet
          title="Copy As"
          actions={[
            { label: "Copy Body Only", onPick: () => void copy("body") },
            { label: "Copy as Plain Text", onPick: () => void copy("plain") },
            { label: "Copy as Markdown", onPick: () => void copy("markdown") },
          ]}
          onCancel={() => setCopyAsOpen(false)}
        />
      )}
      {fallback !== null && <CopyFallback text={fallback} onClose={() => setFallback(null)} />}
      {outline && <OutlineSheet items={outline} onPick={(pos) => editorRef.current?.goTo(pos)} onClose={() => setOutline(null)} />}
      {versionsOpen && onRestoreVersion && <VersionsSheet versions={versions} onRestore={onRestoreVersion} onClose={() => setVersionsOpen(false)} />}
      {aiPick && (
        <RowActionSheet
          title="JARVIS on the Selection"
          actions={[
            ...AI_ACTIONS.map((a) => ({ label: a.label, onPick: () => void runAI(a.key, aiPick) })),
            ...(onCreateLinkedTask ? [{ label: "Create Linked Task", onPick: () => onCreateLinkedTask(aiPick.text) }] : []),
          ]}
          onCancel={() => setAiPick(null)}
        />
      )}
      {aiRun && (
        <AISheet
          action={aiRun.action}
          original={aiRun.text}
          result={aiRun.result}
          error={aiRun.error}
          stale={aiStale}
          onApply={() => { if (aiRun.result !== null) editorRef.current?.replaceRange(aiRun.from, aiRun.to, parseMarkdown(aiRun.result)); setAiRun(null); showToast({ message: "Applied · Undo is on the bar" }); }}
          onInsert={() => { if (aiRun.result !== null) editorRef.current?.insertAtCaret(parseMarkdown(aiRun.result)); setAiRun(null); }}
          onCopy={() => { if (aiRun.result !== null) void copyText(aiRun.result).then(() => showToast({ message: "Result copied" })).catch(() => setFallback(aiRun.result)); }}
          onRetry={() => void runAI(aiRun.action, { from: aiRun.from, to: aiRun.to, text: aiRun.text })}
          onClose={() => setAiRun(null)}
        />
      )}
      {exportOpen && (
        <ExportSheet doc={exportOpen.doc} title={title} selection={exportOpen.selection} images={exportOpen.images} attachmentNames={exportOpen.names} onClose={() => setExportOpen(null)} />
      )}
    </div>
  );
}

// The natural size of an image at a URL, for the Word file's transformation;
// null where there is no Image (jsdom) or the load fails.
function imageSize(url: string): Promise<{ width: number; height: number } | null> {
  if (typeof window === "undefined" || typeof window.Image === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve(img.naturalWidth && img.naturalHeight ? { width: img.naturalWidth, height: img.naturalHeight } : null);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
