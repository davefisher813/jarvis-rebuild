import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, FileText, Image, Check, Plus, X, Trash2, Archive, Tag, Link2, ListChecks, Copy, Share } from "../../shared/icons";
import type { FoundCandidate } from "../types";
import { catColor } from "../../shared/categories";
import InlineEdit from "../../shared/InlineEdit";
import DocEditor, { type DocEditorHandle } from "../../shared/DocEditor";
import type { Doc } from "../docModel";
import { docWordCount } from "../docModel";
import { docToMarkdown, docToPlainText } from "../markdown";
import type { ExportImage } from "../exportDoc";
import ExportSheet from "./ExportSheet";
import RowActionSheet from "../../shared/RowActionSheet";
import { copyText } from "../../shared/shareText";
import { showToast } from "../../shared/toast";
import Provenance from "../../shared/ProvenanceLine";
import { HyperfocusLine, useHyperfocusGuard } from "../../today/useHyperfocusGuard";
import type { Source } from "../../shared/provenance";
import { connIcon, type Conn } from "./Connections";
import { capAfterNumber } from "../../shared/casing";
import { useFileUrl } from "../../files/useFileUrl";
import type { FileStore } from "../../files/FileStore";

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
}) {
  const guard = useHyperfocusGuard();
  const [menuOpen, setMenuOpen] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const [relatedOpen, setRelatedOpen] = useState(false);
  const [copyAsOpen, setCopyAsOpen] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState<{ doc: Doc; selection: boolean; images: ExportImage[]; names: string[] } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const editorRef = useRef<DocEditorHandle>(null);
  const foundLive = (found ?? []).map((c, i) => ({ c, i })).filter(({ c }) => !c.added);
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
    setMenuOpen((o) => !o);
  };

  const saveLine =
    saveState === "failed" ? <span className="doc-save failed" role="status">Couldn't save{onRetrySave && <button type="button" className="pill-action" onClick={onRetrySave}>Retry</button>}</span>
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
                {hasSelection && (
                  <button className="block-menu-item" role="menuitem" onClick={() => { setMenuOpen(false); void prepareExport(true); }}><Share className="ic" /> Export Selection</button>
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
              <div className="row" key={c.kind + ":" + i}>
                <div className={"proj-icon " + connIcon(c.kind === "decision" ? "decision" : c.kind).cls}>{connIcon(c.kind === "decision" ? "decision" : c.kind).node}</div>
                <div className="row-grow">
                  <div className="conn-name">{c.text}</div>
                  <div className="facts">
                    <span className={"fact " + (c.kind === "decision" ? "purp" : "sky")}>{c.kind === "task" ? "Task" : c.kind === "decision" ? "Decision" : c.kind === "person" ? "Person" : "Project"}</span>
                    {c.due && <span className="fact">{c.due}</span>}
                  </div>
                </div>
                {(c.kind === "task" || c.kind === "decision")
                  ? (onFoundAdd && <button type="button" className="pill-act" onClick={() => onFoundAdd(i)}>Add</button>)
                  : (onFoundLink && <button type="button" className="pill-act" onClick={() => onFoundLink(i)}>Link</button>)}
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
