import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, FileText, Image, Check, Plus, ArrowUp, ArrowDown, Trash2, Undo2, Redo2, Type, List as ListIcon, CheckSquare, Heading1, Bold, Italic, Strikethrough, Highlighter, Pilcrow } from "lucide-react";
import { wrapRange, countWords } from "../richtext";
import { catColor } from "../../shared/categories";
import { Burst } from "../../shared/Burst";
import InlineEdit from "../../shared/InlineEdit";

// Editorial layout is a way of writing, not a property of one note, so the
// choice is global and remembered.
import { capAfterNumber } from "../../shared/casing";

const EDITORIAL_KEY = "jarvis.notes.editorial.v1";

// Matches locked frame #47 "Editor / Blocks", now editable in place. Tapping a
// checkbox toggles it; title, text, headings, and checklist item text are
// editable (contentEditable, saved on blur). Visuals are unchanged from the
// gated screen; editing just makes the existing elements interactive.

type ChecklistItem = { text: string; done?: boolean };
type EditorBlock =
  | { id: string; type: "heading"; text: string }
  | { id: string; type: "text"; text: string }
  | { id: string; type: "meta"; text: string }
  | { id: string; type: "checklist"; items: ChecklistItem[] }
  | { id: string; type: "bulleted_list"; items: string[] }
  | { id: string; type: "numbered_list"; items: string[] }
  | { id: string; type: "table"; header: string[]; numCol?: number; rows: string[][]; sum?: string[] }
  | { id: string; type: "file"; name: string; size: string }
  | { id: string; type: "photo"; name: string; size: string };

export interface EditorNote {
  category: string;
  eyebrow: string;
  title: string;
  blocks: EditorBlock[];
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
        <div className="t-body" key={block.id + ":" + j}>
          <span aria-hidden="true">{marker(j) + " "}</span>
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
}: {
  block: Extract<EditorBlock, { type: "checklist" }>;
  onToggle?: (blockId: string, index: number) => void;
  onEditItem?: (blockId: string, index: number, text: string) => void;
  onAddItem?: (blockId: string) => void;
  onDeleteItem?: (blockId: string, index: number) => void;
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
        </div>
      ))}
      {onAddItem && (
        <button className="check-add" onClick={() => onAddItem(block.id)}>
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
                    <Type className="ic" /> Turn into text
                  </button>
                )}
                {blockType !== "heading" && (
                  <button className="block-menu-item" onClick={() => { onTurnInto(blockId, "heading"); setOpen(false); }}>
                    <Heading1 className="ic" /> Turn into heading
                  </button>
                )}
                <button className="block-menu-item" onClick={() => { onTurnInto(blockId, "bulleted_list"); setOpen(false); }}>
                  <ListIcon className="ic" /> Turn into list
                </button>
                <button className="block-menu-item" onClick={() => { onTurnInto(blockId, "checklist"); setOpen(false); }}>
                  <CheckSquare className="ic" /> Turn into checklist
                </button>
              </>
            )}
            {onMove && !isFirst && (
              <button className="block-menu-item" onClick={() => { onMove(blockId, -1); setOpen(false); }}>
                <ArrowUp className="ic" /> Move up
              </button>
            )}
            {onMove && !isLast && (
              <button className="block-menu-item" onClick={() => { onMove(blockId, 1); setOpen(false); }}>
                <ArrowDown className="ic" /> Move down
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
}: {
  note: EditorNote;
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

  return (
    <div className="screen screen-editor">
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

      <div className={"doc" + (editorial ? " doc-editorial" : "")}>
        <div className="inline-dot">
          <div className={"proj-icon cat-bg-" + catColor(note.category)}>
            <FileText className="ic" />
          </div>
          <span className={"eyebrow cat-fg-" + catColor(note.category)}>{note.eyebrow}</span>
        </div>
        <InlineEdit tag="div" className="doc-title" value={note.title} placeholder="Untitled" onSave={onEditTitle} />

        {inline.map((b, idx) => {
          let content: React.ReactNode = null;
          if (b.type === "heading")
            // Black Steel with Editorial's numbering (Dave 2026-08-19,
            // "5 with 4's numbering"): red mini-caps heading, red counter
            // number leading it, dotted leader to the margin. The number
            // is a CSS counter, so it renumbers itself.
            content = (
              <div className="hwrap">
                <span className="hnum" aria-hidden="true"></span>
                <InlineEdit tag="div" className="block-h" value={b.text} placeholder="Heading" bid={b.id}
                  focused={focusBlockId === b.id}
                  onEnter={onEnterAt ? (t) => onEnterAt(b.id, t) : undefined}
                  onEmptyBackspace={onBackspaceAt ? () => onBackspaceAt(b.id) : undefined}
                  onSave={onEditBlockText ? (t) => onEditBlockText(b.id, t) : undefined} />
              </div>
            );
          else if (b.type === "meta")
            // The meta line (Dave 2026-08-19, "add the meta block"): quiet
            // grey context under the title: date, attendees, whatever frames
            // the document. Same editing mechanics as text, styled down.
            content = <InlineEdit tag="div" className="block-meta" value={b.text} placeholder="Date · Attendees" bid={b.id}
              focused={focusBlockId === b.id}
              onEnter={onEnterAt ? (t) => onEnterAt(b.id, t) : undefined}
              onEmptyBackspace={onBackspaceAt ? () => onBackspaceAt(b.id) : undefined}
              onSave={onEditBlockText ? (t) => onEditBlockText(b.id, t) : undefined} />;
          else if (b.type === "text")
            content = <InlineEdit tag="div" className="t-body" value={b.text} placeholder="Write Something" bid={b.id} rich
              focused={focusBlockId === b.id}
              onEnter={onEnterAt ? (t) => onEnterAt(b.id, t) : undefined}
              onEmptyBackspace={onBackspaceAt ? () => onBackspaceAt(b.id) : undefined}
              onTransform={onTransformAt ? (p, rest) => onTransformAt(b.id, p, rest) : undefined}
              onSave={onEditBlockText ? (t) => onEditBlockText(b.id, t) : undefined} />;
          else if (b.type === "checklist")
            content = <Checklist block={b} onToggle={onToggleCheck} onEditItem={onEditCheckItem} onAddItem={onAddCheckItem} onDeleteItem={onDeleteCheckItem} />;
          else if (b.type === "bulleted_list")
            content = <ListBlock block={b} focusBlockId={focusBlockId} onItems={onListItems} onExit={onListExit} />;
          else if (b.type === "numbered_list")
            content = <ListBlock block={b} focusBlockId={focusBlockId} onItems={onListItems} onExit={onListExit} />;
          else if (b.type === "table")
            content = <NoteTable block={b} onEditCell={onTableEdit} onAddRow={onTableAddRow} onAddColumn={onTableAddColumn} />;
          else return null;
          return (
            <BlockRow
              key={b.id}
              blockId={b.id}
              blockType={b.type}
              isFirst={idx === 0}
              isLast={idx === inline.length - 1}
              onMove={onMoveBlock}
              onDelete={onDeleteBlock}
              onTurnInto={onTurnInto}
            >
              {content}
            </BlockRow>
          );
        })}

        {inline.length === 0 && (
          <div className="note-empty">Nothing here yet</div>
        )}
      </div>

      {attachments.length > 0 && (
        <div className="pad-x">
          <div className="card">
            {attachments.map((a) => (
              <div className="row" key={a.id}>
                <span className={a.type === "file" ? "fg-red" : "fg-blue"}>
                  {a.type === "file" ? <FileText className="ic" /> : <Image className="ic" />}
                </span>
                <div className="conn-name truncate">{a.name}</div>
                {a.size && <div className="conn-meta">{a.size}</div>}
              </div>
            ))}
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
          full palette (tables, photos, files). Always in reach. */}
      <div className="editor-bar editor-toolbar">
        <button className="chip" onClick={() => onAddTyped?.("text")}>Text</button>
        <button className="chip" onClick={() => onAddTyped?.("heading")}>Heading</button>
        <button className="chip" onClick={() => onAddTyped?.("bulleted_list")}>List</button>
        <button className="chip" onClick={() => onAddTyped?.("checklist")}>Checklist</button>
        <button className="chip chip-accent" onClick={onAddBlock}>More</button>
      </div>
    </div>
  );
}
