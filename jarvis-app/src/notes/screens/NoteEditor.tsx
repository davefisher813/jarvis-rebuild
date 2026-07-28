import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, FileText, Image, Check, Plus, ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import { catColor } from "../../shared/categories";

// Matches locked frame #47 "Editor / Blocks", now editable in place. Tapping a
// checkbox toggles it; title, text, headings, and checklist item text are
// editable (contentEditable, saved on blur). Visuals are unchanged from the
// gated screen; editing just makes the existing elements interactive.

type ChecklistItem = { text: string; done?: boolean };
type EditorBlock =
  | { id: string; type: "heading"; text: string }
  | { id: string; type: "text"; text: string }
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

// contentEditable text. Read-only when no onSave is given (static use). Sets its
// text once and on external change; never while focused, so the caret is stable.
function Editable({
  tag = "div",
  className,
  value,
  placeholder,
  onSave,
  focused,
  onEnter,
  onEmptyBackspace,
  onTransform,
}: {
  tag?: "div" | "span";
  className?: string;
  value: string;
  placeholder?: string;
  onSave?: (v: string) => void;
  focused?: boolean;
  onEnter?: (current: string) => void;
  onEmptyBackspace?: () => void;
  onTransform?: (prefix: "#" | "[]" | "-" | "1.", rest: string) => void;
}) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && el.textContent !== value) el.textContent = value;
  }, [value]);
  // Canvas flow: when this block was just created by Enter, put the caret in it.
  useEffect(() => {
    const el = ref.current;
    if (focused && el) {
      el.focus();
      const sel = window.getSelection();
      if (sel) { sel.selectAllChildren(el); sel.collapseToEnd(); }
    }
  }, [focused]);

  const Tag = tag as "div";
  if (!onSave) return <Tag className={className}>{value}</Tag>;
  return (
    <Tag
      ref={ref as React.Ref<HTMLDivElement>}
      className={className}
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onBlur={(e) => onSave((e.currentTarget.textContent ?? "").trim())}
      onKeyDown={(e) => {
        const text = (e.currentTarget.textContent ?? "").trim();
        if (e.key === "Enter" && !e.shiftKey && onEnter) {
          e.preventDefault();
          onEnter(text);
        } else if (e.key === "Backspace" && text === "" && onEmptyBackspace) {
          e.preventDefault();
          onEmptyBackspace();
        }
      }}
      onInput={(e) => {
        if (!onTransform) return;
        const t = e.currentTarget.textContent ?? "";
        if (t.startsWith("# ")) onTransform("#", t.slice(2));
        else if (t.startsWith("[] ") || t.startsWith("[ ] ")) onTransform("[]", t.replace(/^\[\s?\]\s/, ""));
        else if (t.startsWith("- ") || t.startsWith("* ")) onTransform("-", t.slice(2));
        else if (/^1[.)] /.test(t)) onTransform("1.", t.slice(3));
      }}
    />
  );
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
          <Editable
            tag="span"
            value={it}
            placeholder="List item"
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
  return (
    <>
      {block.items.map((it, i) => (
        <div className={"check-line" + (it.done ? " done" : "")} key={i}>
          <div
            className={"cb" + (it.done ? " on" : "")}
            // Only allow checking an item that has text, so a blank line can
            // never become an orphaned checked box.
            onClick={() => { if (it.text.trim()) onToggle?.(block.id, i); }}
          >
            {it.done && <Check className="ic" />}
          </div>
          <Editable
            tag="span"
            value={it.text}
            placeholder="List item"
            // On blur, an item left blank is removed so no empty checkbox lingers.
            onSave={onEditItem ? (t) => { if (t.trim()) onEditItem(block.id, i, t); else onDeleteItem?.(block.id, i); } : undefined}
          />
        </div>
      ))}
      {onAddItem && (
        <button className="check-add" onClick={() => onAddItem(block.id)}>
          <Plus className="ic" />
          <span>Add item</span>
        </button>
      )}
    </>
  );
}

function NoteTable({ block }: { block: Extract<EditorBlock, { type: "table" }> }) {
  const numCol = block.numCol ?? -1;
  return (
    <table className="ntable">
      <tbody>
        <tr>
          {block.header.map((h, i) => (
            <th key={i} className={i === numCol ? "num" : undefined}>{h}</th>
          ))}
        </tr>
        {block.rows.map((row, r) => (
          <tr key={r}>
            {row.map((cell, i) => (
              <td key={i} className={i === numCol ? "num" : undefined}>{cell}</td>
            ))}
          </tr>
        ))}
        {block.sum && (
          <tr className="sum">
            {block.sum.map((cell, i) => (
              <td key={i} className={i === numCol ? "num" : undefined}>{cell}</td>
            ))}
          </tr>
        )}
      </tbody>
    </table>
  );
}

// Wraps a block with a quiet (...) menu for move up / move down / delete.
// Uses a menu rather than drag (drag fights scroll in a web view).
function BlockRow({
  blockId,
  isFirst,
  isLast,
  onMove,
  onDelete,
  children,
}: {
  blockId: string;
  isFirst: boolean;
  isLast: boolean;
  onMove?: (blockId: string, dir: -1 | 1) => void;
  onDelete?: (blockId: string) => void;
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

export default function NoteEditor({
  note,
  onBack,
  onConnections,
  onAddBlock,
  onEditTitle,
  onEditBlockText,
  onToggleCheck,
  onEditCheckItem,
  onAddCheckItem,
  onDeleteCheckItem,
  onMoveBlock,
  onDeleteBlock,
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
  onEditTitle?: (text: string) => void;
  onEditBlockText?: (blockId: string, text: string) => void;
  onToggleCheck?: (blockId: string, index: number) => void;
  onEditCheckItem?: (blockId: string, index: number, text: string) => void;
  onAddCheckItem?: (blockId: string) => void;
  onDeleteCheckItem?: (blockId: string, index: number) => void;
  onMoveBlock?: (blockId: string, dir: -1 | 1) => void;
  onDeleteBlock?: (blockId: string) => void;
}) {
  const inline = note.blocks.filter((b) => b.type !== "file" && b.type !== "photo");
  const attachments = note.blocks.filter(
    (b): b is Extract<EditorBlock, { type: "file" | "photo" }> =>
      b.type === "file" || b.type === "photo",
  );

  return (
    <div className="screen">
      <div className="nav-bar">
        <button className="nav-back" onClick={onBack}>Notes</button>
        <span className="nav-title"></span>
        <div className="nav-actions">
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

      <div className="doc">
        <div className="inline-dot">
          <div className={"proj-icon cat-bg-" + catColor(note.category)}>
            <FileText className="ic" />
          </div>
          <span className="eyebrow">{note.eyebrow}</span>
        </div>
        <Editable tag="div" className="t-h2" value={note.title} onSave={onEditTitle} />

        {inline.map((b, idx) => {
          let content: React.ReactNode = null;
          if (b.type === "heading")
            content = <Editable tag="div" className="block-h" value={b.text} placeholder="Heading"
              focused={focusBlockId === b.id}
              onEnter={onEnterAt ? (t) => onEnterAt(b.id, t) : undefined}
              onEmptyBackspace={onBackspaceAt ? () => onBackspaceAt(b.id) : undefined}
              onSave={onEditBlockText ? (t) => onEditBlockText(b.id, t) : undefined} />;
          else if (b.type === "text")
            content = <Editable tag="div" className="t-body" value={b.text} placeholder="Write something"
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
            content = <NoteTable block={b} />;
          else return null;
          return (
            <BlockRow
              key={b.id}
              blockId={b.id}
              isFirst={idx === 0}
              isLast={idx === inline.length - 1}
              onMove={onMoveBlock}
              onDelete={onDeleteBlock}
            >
              {content}
            </BlockRow>
          );
        })}

        {inline.length === 0 && (
          <div className="note-empty">Nothing here yet. Tap Add below to start writing or add a to-do.</div>
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
                <div className="conn-meta">{a.size}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="pad-x">
        <button className="add-block" onClick={onAddBlock}>
          <Plus className="ic" />
          Add
        </button>
      </div>
    </div>
  );
}
