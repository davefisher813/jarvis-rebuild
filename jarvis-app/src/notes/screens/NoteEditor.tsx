import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, FileText, Image, Check, Plus, X, ArrowUp, ArrowDown, Trash2, Undo2, Redo2, Type, List as ListIcon, CheckSquare, Heading1, Bold, Italic, Strikethrough, Highlighter, Pilcrow, ListChecks } from "../../shared/icons";
import { wrapRange, countWords } from "../richtext";
import { catColor } from "../../shared/categories";
import { Burst } from "../../shared/Burst";
import InlineEdit from "../../shared/InlineEdit";
import { connIcon, type Conn } from "./Connections";

// Editorial layout is a way of writing, not a property of one note, so the
// choice is global and remembered.
import { capAfterNumber } from "../../shared/casing";
import { useFileUrl } from "../../files/useFileUrl";
import type { FileStore } from "../../files/FileStore";

const EDITORIAL_KEY = "jarvis.notes.editorial.v1";

// Matches locked frame #47 "Editor / Blocks", now editable in place. Tapping a
// checkbox toggles it; title, text, headings, and checklist item text are
// editable (contentEditable, saved on blur). Visuals are unchanged from the
// gated screen; editing just makes the existing elements interactive.

type ChecklistItem = { text: string; done?: boolean; taskId?: string };
type EditorBlock =
  | { id: string; type: "heading"; text: string }
  | { id: string; type: "text"; text: string }
  | { id: string; type: "meta"; text: string }
  | { id: string; type: "checklist"; items: ChecklistItem[] }
  | { id: string; type: "bulleted_list"; items: string[] }
  | { id: string; type: "numbered_list"; items: string[] }
  | { id: string; type: "table"; header: string[]; numCol?: number; rows: string[][]; sum?: string[] }
  | { id: string; type: "file"; name: string; size: string; path?: string; mime?: string }
  | { id: string; type: "photo"; name: string; size: string; path?: string; mime?: string };

export interface EditorNote {
  category: string;
  eyebrow: string;
  title: string;
  blocks: EditorBlock[];
}

// COMMAND DECK's card-per-section grouping (Dave 2026-08-28: "the non
// editorial version [becomes] the command deck"). The block model stays
// flat -- there is no section object anywhere in storage -- this just
// partitions the SAME array into "everything before the first heading"
// (rendered plain, no card) followed by one group per heading and the
// blocks that follow it, purely for how Command Deck lays the page out.
// Field Notes and the data layer never see this; it is a render-only view.
type Section = { heading: Extract<EditorBlock, { type: "heading" }> | null; items: EditorBlock[] };
function sectionize(blocks: EditorBlock[]): Section[] {
  const out: Section[] = [];
  let cur: Section = { heading: null, items: [] };
  for (const b of blocks) {
    if (b.type === "heading") {
      if (cur.heading || cur.items.length) out.push(cur);
      cur = { heading: b, items: [] };
    } else {
      cur.items.push(b);
    }
  }
  if (cur.heading || cur.items.length) out.push(cur);
  return out;
}

// The count a Command Deck card header shows instead of an invented
// 01/02/03 sequence number: how many actual items are inside -- checklist
// and list entries count individually, a paragraph or table counts as one.
function sectionItemCount(items: EditorBlock[]): number {
  return items.reduce((n, b) => {
    if (b.type === "checklist" || b.type === "bulleted_list" || b.type === "numbered_list") return n + b.items.length;
    if (b.type === "file" || b.type === "photo") return n;
    return n + 1;
  }, 0);
}

// Canvas flow for bulleted/numbered lists: every item is typeable, Enter adds
// the next item, Enter on an empty item exits the list into fresh text, and
// backspace on an empty item removes it (emptying the list turns it back into
// a text block).
function ListBlock({
  block,
  focusBlockId,
  onItems,
  onExit,
}: {
  block: { id: string; type: "bulleted_list" | "numbered_list"; items: string[] };
  focusBlockId?: string | null;
  onItems?: (blockId: string, items: string[], focusKey: string | null) => void;
  onExit?: (blockId: string, remaining: string[]) => void;
}) {
  const marker = (j: number) => (block.type === "numbered_list" ? `${j + 1}.` : "\u2022");
  return (
    <div>
      {block.items.map((it, j) => (
        <div className="t-body li-line" key={block.id + ":" + j}>
          {/* The marker hangs: wrapped lines align under the text, not under
              the bullet, and editorial styles the marker down without
              touching the words (visual pass 2026-08-22). */}
          <span className="li-marker" aria-hidden="true">{marker(j)}</span>
          <InlineEdit
            tag="span"
            value={it}
            placeholder="List Item"
            focused={focusBlockId === block.id + ":" + j}
            onSave={onItems ? (t) => { const items = block.items.slice(); items[j] = t; onItems(block.id, items, null); } : undefined}
            onEnter={onItems || onExit ? (t) => {
              if (t === "" && onExit) {
                onExit(block.id, block.items.filter((_, k) => k !== j));
              } else if (onItems) {
                const items = block.items.slice(); items[j] = t; items.splice(j + 1, 0, "");
                onItems(block.id, items, block.id + ":" + (j + 1));
              }
            } : undefined}
            onEmptyBackspace={onItems || onExit ? () => {
              const items = block.items.filter((_, k) => k !== j);
              if (items.length === 0 && onExit) onExit(block.id, []);
              else if (onItems) onItems(block.id, items, j > 0 ? block.id + ":" + (j - 1) : null);
            } : undefined}
          />
        </div>
      ))}
    </div>
  );
}

function Checklist({
  block,
  onToggle,
  onEditItem,
  onAddItem,
  onDeleteItem,
  onOpenTask,
}: {
  block: Extract<EditorBlock, { type: "checklist" }>;
  onToggle?: (blockId: string, index: number) => void;
  onEditItem?: (blockId: string, index: number, text: string) => void;
  onAddItem?: (blockId: string) => void;
  onDeleteItem?: (blockId: string, index: number) => void;
  // The item was already promoted to a real task (Dave 2026-08-28: "very
  // very easy to connect things") -- a quiet badge says so instead of an
  // item that looks plain but is secretly synced, and tapping it jumps
  // straight to the task rather than making you go find it.
  onOpenTask?: (taskId: string) => void;
}) {
  // Completion feedback (audit 2026-07-30): checking an item pops the box and
  // fires the same micro-burst as tasks. Items stay in place when checked, so
  // no delay is needed here.
  const [burstAt, setBurstAt] = useState<number | null>(null);
  const burstTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const celebrate = (i: number) => {
    setBurstAt(null);
    if (burstTimer.current) clearTimeout(burstTimer.current);
    requestAnimationFrame(() => {
      setBurstAt(i);
      burstTimer.current = setTimeout(() => setBurstAt(null), 500);
    });
  };
  return (
    <>
      {block.items.map((it, i) => (
        <div className={"check-line" + (it.done ? " done" : "")} key={i}>
          <div
            className={"cb" + (it.done ? " on" : "") + (burstAt === i ? " just-checked" : "")}
            // HMN-F-01: the tap must not blur-save the item being typed in;
            // the caret stays put and the toggle queues behind nothing. Same
            // guard Add Row has carried since the deep template pass.
            onMouseDown={(e) => e.preventDefault()}
            // Only allow checking an item that has text, so a blank line can
            // never become an orphaned checked box.
            onClick={() => { if (it.text.trim()) { if (!it.done) celebrate(i); onToggle?.(block.id, i); } }}
          >
            {it.done && <Check className="ic" />}
            <Burst show={burstAt === i} />
          </div>
          <InlineEdit
            tag="span"
            value={it.text}
            placeholder="List Item"
            // On blur, an item left blank is removed so no empty checkbox lingers.
            onSave={onEditItem ? (t) => { if (t.trim()) onEditItem(block.id, i, t); else onDeleteItem?.(block.id, i); } : undefined}
          />
          {it.taskId && (
            onOpenTask ? (
              <button className="check-linked" aria-label="Open Linked Task" onClick={(e) => { e.stopPropagation(); onOpenTask(it.taskId!); }}>
                <ListChecks className="ic" />
              </button>
            ) : (
              <span className="check-linked" aria-hidden="true"><ListChecks className="ic" /></span>
            )
          )}
        </div>
      ))}
      {onAddItem && (
        <button className="check-add" onMouseDown={(e) => e.preventDefault()} onClick={() => onAddItem(block.id)}>
          <Plus className="ic" />
          <span>Add Item</span>
        </button>
      )}
    </>
  );
}

// A cell is numeric-looking when it is money or a bare number; a column
// where at least two body cells are numeric (and none are words) earns a
// computed sum row. The sum is display-only: it recomputes from the cells,
// so it can never go stale (deep template pass, 2026-08-19).
const NUM_RE = /^-?\$?\s?\d[\d,]*\.?\d*$/;
function columnSums(rows: string[][], cols: number): (string | null)[] {
  return Array.from({ length: cols }, (_, i) => {
    const vals = rows.map((r) => (r[i] ?? "").trim()).filter((v) => v !== "");
    if (vals.length < 2 || !vals.every((v) => NUM_RE.test(v))) return null;
    const total = vals.reduce((a, v) => a + parseFloat(v.replace(/[$,\s]/g, "")), 0);
    const money = vals.some((v) => v.includes("$"));
    const out = Number.isInteger(total) ? String(total) : total.toFixed(2);
    return money ? "$" + out : out;
  });
}

// THE TRACKER IS A REAL TABLE (Dave 2026-08-19, "I meant all of these"):
// every cell edits in place through the one InlineEdit primitive, Add Row
// grows it downward, the header's + grows it sideways, and numeric columns
// sum themselves.
function NoteTable({
  block,
  onEditCell,
  onAddRow,
  onAddColumn,
}: {
  block: Extract<EditorBlock, { type: "table" }>;
  onEditCell?: (blockId: string, row: number, col: number, text: string) => void;
  onAddRow?: (blockId: string) => void;
  onAddColumn?: (blockId: string) => void;
}) {
  const numCol = block.numCol ?? -1;
  const sums = columnSums(block.rows, block.header.length);
  const showSums = !block.sum && sums.some((s) => s !== null);
  return (
    <div className="ntable-wrap">
      <table className="ntable">
        <tbody>
          <tr>
            {block.header.map((h, i) => (
              <th key={i} className={i === numCol ? "num" : undefined}>
                <InlineEdit tag="span" className="tcell" value={h} placeholder="Column"
                  onSave={onEditCell ? (t) => onEditCell(block.id, -1, i, t) : undefined} />
              </th>
            ))}
            {onAddColumn && (
              <th className="tcol-add">
                <button className="tcol-add-btn" aria-label="Add Column" onMouseDown={(e) => e.preventDefault()} onClick={() => onAddColumn(block.id)}><Plus className="ic" /></button>
              </th>
            )}
          </tr>
          {block.rows.map((row, r) => (
            <tr key={r}>
              {block.header.map((_, i) => (
                <td key={i} className={i === numCol ? "num" : undefined}>
                  <InlineEdit tag="span" className="tcell" value={row[i] ?? ""}
                    onSave={onEditCell ? (t) => onEditCell(block.id, r, i, t) : undefined} />
                </td>
              ))}
              {onAddColumn && <td className="tcol-add" />}
            </tr>
          ))}
          {(block.sum || showSums) && (
            <tr className="sum">
              {block.header.map((_, i) => (
                <td key={i} className={i === numCol ? "num" : undefined}>
                  {block.sum ? block.sum[i] : i === 0 && sums[0] === null ? "Total" : sums[i] ?? ""}
                </td>
              ))}
              {onAddColumn && <td className="tcol-add" />}
            </tr>
          )}
        </tbody>
      </table>
      {/* mousedown is swallowed so a tap right after typing a cell can't be
          eaten by the blur-save re-render swapping this button mid-click. */}
      {onAddRow && (
        <button className="trow-add" onMouseDown={(e) => e.preventDefault()} onClick={() => onAddRow(block.id)}>Add Row</button>
      )}
    </div>
  );
}

// Wraps a block with a quiet (...) menu for move up / move down / delete.
// Uses a menu rather than drag (drag fights scroll in a web view).
function BlockRow({
  blockId,
  blockType,
  isFirst,
  isLast,
  onMove,
  onDelete,
  onTurnInto,
  children,
}: {
  blockId: string;
  blockType?: string;
  isFirst: boolean;
  isLast: boolean;
  onMove?: (blockId: string, dir: -1 | 1) => void;
  onDelete?: (blockId: string) => void;
  onTurnInto?: (blockId: string, type: "text" | "heading" | "bulleted_list" | "checklist") => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const hasMenu = !!onMove || !!onDelete;
  return (
    <div className="block-row">
      <div className="block-body">{children}</div>
      {hasMenu && (
        <button className="block-menu-btn" aria-label="Block options" onClick={() => setOpen((o) => !o)}>
          <MoreHorizontal className="ic" />
        </button>
      )}
      {open && (
        <>
          <div className="block-menu-scrim" onClick={() => setOpen(false)} />
          <div className="block-menu">
            {onTurnInto && (blockType === "text" || blockType === "heading") && (
              <>
                {blockType !== "text" && (
                  <button className="block-menu-item" onClick={() => { onTurnInto(blockId, "text"); setOpen(false); }}>
                    <Type className="ic" /> Turn Into Text
                  </button>
                )}
                {blockType !== "heading" && (
                  <button className="block-menu-item" onClick={() => { onTurnInto(blockId, "heading"); setOpen(false); }}>
                    <Heading1 className="ic" /> Turn Into Heading
                  </button>
                )}
                <button className="block-menu-item" onClick={() => { onTurnInto(blockId, "bulleted_list"); setOpen(false); }}>
                  <ListIcon className="ic" /> Turn Into List
                </button>
                <button className="block-menu-item" onClick={() => { onTurnInto(blockId, "checklist"); setOpen(false); }}>
                  <CheckSquare className="ic" /> Turn Into Checklist
                </button>
              </>
            )}
            {onMove && !isFirst && (
              <button className="block-menu-item" onClick={() => { onMove(blockId, -1); setOpen(false); }}>
                <ArrowUp className="ic" /> Move Up
              </button>
            )}
            {onMove && !isLast && (
              <button className="block-menu-item" onClick={() => { onMove(blockId, 1); setOpen(false); }}>
                <ArrowDown className="ic" /> Move Down
              </button>
            )}
            {onDelete && (
              <button className="block-menu-item danger" onClick={() => { onDelete(blockId); setOpen(false); }}>
                <Trash2 className="ic" /> Delete
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// THE SELECTION BAR (deep writing pass): select text in a text block and a
// floating format bar appears above the selection: bold, italic, strike,
// highlight. Tapping a format keeps the selection's block focused (mousedown
// is swallowed) and re-applying the same format removes it.
function SelectionBar({ onApply }: { onApply: (bid: string, start: number, end: number, marker: string) => void }) {
  const [st, setSt] = useState<{ top: number; left: number; bid: string; start: number; end: number } | null>(null);
  useEffect(() => {
    const h = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { setSt(null); return; }
      if (sel.anchorNode !== sel.focusNode) { setSt(null); return; }
      const node = sel.anchorNode;
      const host = (node instanceof Element ? node : node?.parentElement)?.closest?.('[data-bid][contenteditable]');
      if (!host || !host.classList.contains("t-body")) { setSt(null); return; }
      const start = Math.min(sel.anchorOffset, sel.focusOffset);
      const end = Math.max(sel.anchorOffset, sel.focusOffset);
      if (start === end) { setSt(null); return; }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      setSt({
        top: Math.max(8, rect.top - 52),
        left: Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - 208)),
        bid: (host as HTMLElement).dataset.bid!,
        start,
        end,
      });
    };
    document.addEventListener("selectionchange", h);
    return () => document.removeEventListener("selectionchange", h);
  }, []);
  if (!st) return null;
  const btn = (marker: string, label: string, icon: React.ReactNode) => (
    <button
      className="selbar-btn"
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => { onApply(st.bid, st.start, st.end, marker); setSt(null); }}
    >{icon}</button>
  );
  return (
    <div className="sel-bar" style={{ top: st.top, left: st.left }}>
      {btn("**", "Bold", <Bold className="ic" />)}
      {btn("*", "Italic", <Italic className="ic" />)}
      {btn("~~", "Strikethrough", <Strikethrough className="ic" />)}
      {btn("==", "Highlight", <Highlighter className="ic" />)}
    </div>
  );
}

// A PHOTO OR FILE WITH REAL BYTES (Dave 2026-09-02, "fully wired"). A
// photo block with a path is the picture itself, full width on the canvas;
// a file block with a path is a row that opens it. Either can be removed
// from its own row. A block without a path is the old placeholder and
// renders as its name alone, so nothing that was saved goes blank.
function Attachment({ a, store, onRemove }: {
  a: Extract<EditorBlock, { type: "file" | "photo" }>;
  store: FileStore | null;
  onRemove?: (blockId: string) => void;
}) {
  const url = useFileUrl(store, a.path);
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

export default function NoteEditor({
  note,
  onBack,
  onConnections,
  onAddBlock,
  onAddTyped,
  onEditTitle,
  onEditBlockText,
  onToggleCheck,
  onEditCheckItem,
  onAddCheckItem,
  onDeleteCheckItem,
  onMoveBlock,
  onDeleteBlock,
  onTurnInto,
  onTableEdit,
  onTableAddRow,
  onTableAddColumn,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onDeleteNote,
  focusBlockId,
  onEnterAt,
  onBackspaceAt,
  onTransformAt,
  onListItems,
  onListExit,
  connections,
  onAddLink,
  onRemoveConnection,
  onOpenConnection,
  onOpenTask,
  fileStore = null,
}: {
  note: EditorNote;
  // Where a photo or file block's bytes live, for showing and opening them.
  fileStore?: FileStore | null;
  onBack?: () => void;
  onConnections?: () => void;
  onDeleteNote?: () => void;
  focusBlockId?: string | null;
  onEnterAt?: (blockId: string, currentText: string) => void;
  onBackspaceAt?: (blockId: string) => void;
  onTransformAt?: (blockId: string, prefix: "#" | "[]" | "-" | "1.", rest: string) => void;
  onListItems?: (blockId: string, items: string[], focusKey: string | null) => void;
  onListExit?: (blockId: string, remaining: string[]) => void;
  onAddBlock?: () => void;
  onAddTyped?: (type: "text" | "heading" | "bulleted_list" | "checklist") => void;
  onEditTitle?: (text: string) => void;
  onEditBlockText?: (blockId: string, text: string) => void;
  onToggleCheck?: (blockId: string, index: number) => void;
  onEditCheckItem?: (blockId: string, index: number, text: string) => void;
  onAddCheckItem?: (blockId: string) => void;
  onDeleteCheckItem?: (blockId: string, index: number) => void;
  onMoveBlock?: (blockId: string, dir: -1 | 1) => void;
  onDeleteBlock?: (blockId: string) => void;
  onTurnInto?: (blockId: string, type: "text" | "heading" | "bulleted_list" | "checklist") => void;
  onTableEdit?: (blockId: string, row: number, col: number, text: string) => void;
  onTableAddRow?: (blockId: string) => void;
  onTableAddColumn?: (blockId: string) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  // THE CONNECTION STRIP (Dave 2026-08-28: "very very easy to connect
  // things"). The note's real connections (never the category -- that's
  // its own fixed row inside the full Connections screen), shown right
  // under the title so linking or unlinking never costs a screen. All
  // optional: the strip renders nothing without connections/onAddLink,
  // same "no handler, no control" rule every other screen in this file
  // already follows.
  connections?: Conn[];
  onAddLink?: () => void;
  onRemoveConnection?: (connId: string) => void;
  onOpenConnection?: (kind: string, targetId: string) => void;
  onOpenTask?: (taskId: string) => void;
}) {
  const inline = note.blocks.filter((b) => b.type !== "file" && b.type !== "photo");
  // EDITORIAL MODE (Dave 2026-08-20). A layer over the same blocks, never a
  // second editor: ruled baselines, a red margin rule, numbered lines and a
  // serif face. Because it is only a class, every writing feature already
  // built (rich marks, the selection bar, the block menu, undo) keeps working
  // untouched, and switching modes cannot reformat or lose a single word.
  // The choice is global and remembered: it is a way of writing, not a
  // property of one note.
  const [editorial, setEditorial] = useState<boolean>(() => {
    try { return localStorage.getItem(EDITORIAL_KEY) === "1"; } catch { return false; }
  });
  const toggleEditorial = () => {
    setEditorial((on) => {
      const next = !on;
      try { localStorage.setItem(EDITORIAL_KEY, next ? "1" : "0"); } catch { /* private mode */ }
      return next;
    });
  };

  const words = countWords(
    note.blocks.flatMap((b) =>
      b.type === "text" || b.type === "heading" || b.type === "meta" ? [b.text]
      : b.type === "checklist" ? b.items.map((i) => i.text)
      : b.type === "bulleted_list" || b.type === "numbered_list" ? b.items
      : []),
  );
  // Selection formatting: wrap the selected raw range and persist. The raw
  // source is the LIVE DOM text, not the last-saved block, because the
  // selection exists mid-edit, before any blur has saved. The DOM is updated
  // in place and the caret lands after the wrapped run.
  const applyFormat = (bid: string, start: number, end: number, marker: string) => {
    const el = document.querySelector(`[data-bid="${bid}"]`);
    if (!el) return;
    const raw = el.textContent ?? "";
    const { text, caret } = wrapRange(raw, start, end, marker);
    el.textContent = text;
    const node = el.firstChild;
    if (node && node.nodeType === Node.TEXT_NODE) {
      const range = document.createRange();
      range.setStart(node, Math.min(caret, text.length));
      range.collapse(true);
      const sel = window.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(range); }
    }
    onEditBlockText?.(bid, text);
  };
  const attachments = note.blocks.filter(
    (b): b is Extract<EditorBlock, { type: "file" | "photo" }> =>
      b.type === "file" || b.type === "photo",
  );

  // Everything below feeds BOTH layouts: which block sits where in the
  // flat array (so Move Up/Down and the block menu stay correct no matter
  // which layout drew it), and which color a heading's section wears (so
  // the same section reads as the same color whether you're in Field
  // Notes' dot or Command Deck's rail -- switching layouts recolors
  // nothing, it only reshapes).
  const sections = sectionize(inline);
  const idxOf = new Map(inline.map((b, i) => [b.id, i] as const));
  const headColor = new Map<string, number>();
  {
    let hi = -1;
    for (const s of sections) if (s.heading) { hi++; headColor.set(s.heading.id, hi % 3); }
  }

  // The block types that render identically in both layouts (heading is
  // laid out differently per-layout below, so it isn't handled here).
  const blockContent = (b: EditorBlock): React.ReactNode => {
    if (b.type === "meta")
      // The meta line (Dave 2026-08-19, "add the meta block"): quiet grey
      // context under the title: date, attendees, whatever frames the
      // document. Same editing mechanics as text, styled down.
      return <InlineEdit tag="div" className="block-meta" value={b.text} placeholder="Date · Attendees" bid={b.id}
        focused={focusBlockId === b.id}
        onEnter={onEnterAt ? (t) => onEnterAt(b.id, t) : undefined}
        onEmptyBackspace={onBackspaceAt ? () => onBackspaceAt(b.id) : undefined}
        onSave={onEditBlockText ? (t) => onEditBlockText(b.id, t) : undefined} />;
    if (b.type === "text")
      return <InlineEdit tag="div" className="t-body" value={b.text} placeholder="Write Something" bid={b.id} rich
        focused={focusBlockId === b.id}
        onEnter={onEnterAt ? (t) => onEnterAt(b.id, t) : undefined}
        onEmptyBackspace={onBackspaceAt ? () => onBackspaceAt(b.id) : undefined}
        onTransform={onTransformAt ? (p, rest) => onTransformAt(b.id, p, rest) : undefined}
        onSave={onEditBlockText ? (t) => onEditBlockText(b.id, t) : undefined} />;
    if (b.type === "checklist")
      return <Checklist block={b} onToggle={onToggleCheck} onEditItem={onEditCheckItem} onAddItem={onAddCheckItem} onDeleteItem={onDeleteCheckItem} onOpenTask={onOpenTask} />;
    if (b.type === "bulleted_list" || b.type === "numbered_list")
      return <ListBlock block={b} focusBlockId={focusBlockId} onItems={onListItems} onExit={onListExit} />;
    if (b.type === "table")
      return <NoteTable block={b} onEditCell={onTableEdit} onAddRow={onTableAddRow} onAddColumn={onTableAddColumn} />;
    return null;
  };
  const plainRow = (b: EditorBlock) => {
    const content = blockContent(b);
    if (content === null) return null;
    const gi = idxOf.get(b.id)!;
    return (
      <BlockRow key={b.id} blockId={b.id} blockType={b.type} isFirst={gi === 0} isLast={gi === inline.length - 1}
        onMove={onMoveBlock} onDelete={onDeleteBlock} onTurnInto={onTurnInto}>
        {content}
      </BlockRow>
    );
  };

  return (
    <div className="screen screen-editor ruled">
      <div className="nav-bar">
        <button className="nav-back" onClick={onBack}>Notes</button>
        <span className="nav-title"></span>
        <div className="nav-actions">
          {onUndo && (
            <button className="nav-action" onClick={onUndo} disabled={!canUndo} aria-label="Undo">
              <Undo2 className="ic" />
            </button>
          )}
          {onRedo && (
            <button className="nav-action" onClick={onRedo} disabled={!canRedo} aria-label="Redo">
              <Redo2 className="ic" />
            </button>
          )}
          <button
            className={"nav-action" + (editorial ? " on" : "")}
            onClick={toggleEditorial}
            aria-pressed={editorial}
            aria-label={editorial ? "Leave editorial layout" : "Editorial layout"}
          >
            <Pilcrow className="ic" />
          </button>
          <button className="nav-action" onClick={onConnections} aria-label="Connections">
            <MoreHorizontal className="ic" />
          </button>
          {onDeleteNote && (
            <button className="nav-action danger" onClick={onDeleteNote} aria-label="Delete note">
              <Trash2 className="ic" />
            </button>
          )}
        </div>
      </div>

      {/* A PHOTO LEADS A PHOTO-ONLY NOTE (2026-09-02): with no words yet
          and a picture or file attached, the canvas gives up its room and
          the placeholder, so the note opens on the thing it holds. */}
      <div className={"doc" + (editorial ? " doc-editorial" : "") + (inline.length === 0 && attachments.length > 0 ? " doc-lean" : "")}>
        <div className="inline-dot">
          <div className={"proj-icon cat-bg-" + catColor(note.category)}>
            <FileText className="ic" />
          </div>
          {/* An empty eyebrow renders nothing: catName refuses to echo an
              id-like ref, and an empty pill-slot is better than a UUID. */}
          {note.eyebrow && <span className={"eyebrow cat-fg-" + catColor(note.category)}>{note.eyebrow}</span>}
        </div>
        <InlineEdit tag="div" className="doc-title" value={note.title} placeholder="Untitled" onSave={onEditTitle} />

        {/* One tap to link, one tap to unlink, right where you're already
            looking -- no trip to the Connections screen for the common
            case. Renders even with nothing linked yet, same as this app's
            other "add" rows: a control that appears only once you've
            already solved the problem solves nothing. */}
        {(connections && connections.length > 0) || onAddLink ? (
          <div className="note-conns">
            {(connections ?? []).map((c) => {
              const ic = connIcon(c.kind);
              const canOpen = !!(onOpenConnection && c.targetId);
              const open = () => onOpenConnection!(c.kind, c.targetId!);
              return (
                <span className="note-conn" key={c.id}>
                  <span
                    className={"proj-icon " + ic.cls}
                    role={canOpen ? "button" : undefined}
                    tabIndex={canOpen ? 0 : undefined}
                    onClick={canOpen ? open : undefined}
                    aria-hidden={!canOpen}
                  >
                    {ic.node}
                  </span>
                  <span className="note-conn-label" role={canOpen ? "button" : undefined} tabIndex={canOpen ? 0 : undefined} onClick={canOpen ? open : undefined}>
                    {c.label}
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
              <button className="note-conn-add" aria-label="Link Something" onClick={onAddLink}>
                <Plus className="ic" />
              </button>
            )}
          </div>
        ) : null}

        {editorial ? (
          // FIELD NOTES (Dave 2026-08-28): one continuous page, same as the
          // block array underneath it. A section is marked by a colored dot
          // -- no invented 01/02/03, no dotted leader to the margin.
          inline.map((b, idx) => {
            let content: React.ReactNode;
            if (b.type === "heading") {
              const hn = headColor.get(b.id) ?? 0;
              content = (
                <div className={"hwrap hd-" + hn}>
                  <span className="hnum" aria-hidden="true"></span>
                  <InlineEdit tag="div" className="block-h" value={b.text} placeholder="Heading" bid={b.id}
                    focused={focusBlockId === b.id}
                    onEnter={onEnterAt ? (t) => onEnterAt(b.id, t) : undefined}
                    onEmptyBackspace={onBackspaceAt ? () => onBackspaceAt(b.id) : undefined}
                    onSave={onEditBlockText ? (t) => onEditBlockText(b.id, t) : undefined} />
                </div>
              );
            } else {
              content = blockContent(b);
            }
            if (content === null) return null;
            return (
              <BlockRow key={b.id} blockId={b.id} blockType={b.type} isFirst={idx === 0} isLast={idx === inline.length - 1}
                onMove={onMoveBlock} onDelete={onDeleteBlock} onTurnInto={onTurnInto}>
                {content}
              </BlockRow>
            );
          })
        ) : (
          // COMMAND DECK (Dave 2026-08-28): each heading and the blocks that
          // follow it become their own card, a colored rail carrying the
          // section the way the numbered header used to. Anything before the
          // first heading (or a note with no heading at all) stays plain --
          // there is no section to put it in.
          sections.map((sec) => {
            if (!sec.heading) return sec.items.map(plainRow);
            const h = sec.heading;
            const hi = idxOf.get(h.id)!;
            const railN = headColor.get(h.id) ?? 0;
            const count = sectionItemCount(sec.items);
            return (
              <div className="cd-card" key={h.id}>
                <div className={"cd-rail cd-" + railN} aria-hidden="true" />
                <div className="cd-inner">
                  <div className="cd-head">
                    <BlockRow blockId={h.id} blockType="heading" isFirst={hi === 0} isLast={hi === inline.length - 1}
                      onMove={onMoveBlock} onDelete={onDeleteBlock} onTurnInto={onTurnInto}>
                      <InlineEdit tag="div" className="cd-h3" value={h.text} placeholder="Heading" bid={h.id}
                        focused={focusBlockId === h.id}
                        onEnter={onEnterAt ? (t) => onEnterAt(h.id, t) : undefined}
                        onEmptyBackspace={onBackspaceAt ? () => onBackspaceAt(h.id) : undefined}
                        onSave={onEditBlockText ? (t) => onEditBlockText(h.id, t) : undefined} />
                    </BlockRow>
                    {count > 0 && <span className="cd-count">{count}</span>}
                  </div>
                  {sec.items.map(plainRow)}
                </div>
              </div>
            );
          })
        )}

        {inline.length === 0 && attachments.length === 0 && (
          <div className="note-empty">Nothing here yet</div>
        )}
      </div>

      {attachments.length > 0 && (
        <div className="pad-x">
          <div className="card list-card-ruled">
            {attachments.map((a) => <Attachment a={a} store={fileStore} onRemove={onDeleteBlock} key={a.id} />)}
          </div>
        </div>
      )}

      {words > 0 && (editorial ? (
        <div className="doc-colophon">
          <span className="ed-name">{note.title || "Untitled"}</span>
          <span className="ed-count">{capAfterNumber(words === 1 ? "1 word" : words + " words")}</span>
        </div>
      ) : (
        <div className="doc-count">{words} words</div>
      ))}

      <SelectionBar onApply={applyFormat} />

      {/* THE WRITING TOOLBAR (Dave 2026-08-18, "real writing features"):
          one tap drops the block and puts the caret in it; More opens the
          full palette (tables, photos, files). Always in reach.
          HMN-F-01 (2026-09-05): mousedown is swallowed on every chip, the
          way Add Row and the selection bar already do, so the tap does not
          blur-save the paragraph being typed on the same gesture that adds
          the next block. The paragraph saves when the caret actually moves
          (into the new block), one write at a time through the flow's queue. */}
      <div className="editor-bar editor-toolbar">
        <button className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => onAddTyped?.("text")}>Text</button>
        <button className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => onAddTyped?.("heading")}>Heading</button>
        <button className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => onAddTyped?.("bulleted_list")}>List</button>
        <button className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => onAddTyped?.("checklist")}>Checklist</button>
        <button className="chip chip-accent" onMouseDown={(e) => e.preventDefault()} onClick={onAddBlock}>More</button>
      </div>
    </div>
  );
}
