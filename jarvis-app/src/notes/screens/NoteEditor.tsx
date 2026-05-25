import { useEffect, useRef } from "react";
import { MoreHorizontal, FileText, Image, Check, Plus } from "lucide-react";
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
  onSave,
}: {
  tag?: "div" | "span";
  className?: string;
  value: string;
  onSave?: (v: string) => void;
}) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && el.textContent !== value) el.textContent = value;
  }, [value]);

  const Tag = tag as "div";
  if (!onSave) return <Tag className={className}>{value}</Tag>;
  return (
    <Tag
      ref={ref as React.Ref<HTMLDivElement>}
      className={className}
      contentEditable
      suppressContentEditableWarning
      onBlur={(e) => onSave((e.currentTarget.textContent ?? "").trim())}
    />
  );
}

function Checklist({
  block,
  onToggle,
  onEditItem,
}: {
  block: Extract<EditorBlock, { type: "checklist" }>;
  onToggle?: (blockId: string, index: number) => void;
  onEditItem?: (blockId: string, index: number, text: string) => void;
}) {
  return (
    <>
      {block.items.map((it, i) => (
        <div className={"check-line" + (it.done ? " done" : "")} key={i}>
          <div
            className={"cb" + (it.done ? " on" : "")}
            onClick={() => onToggle?.(block.id, i)}
          >
            {it.done && <Check className="ic" />}
          </div>
          <Editable
            tag="span"
            value={it.text}
            onSave={onEditItem ? (t) => onEditItem(block.id, i, t) : undefined}
          />
        </div>
      ))}
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

export default function NoteEditor({
  note,
  onBack,
  onConnections,
  onAddBlock,
  onEditTitle,
  onEditBlockText,
  onToggleCheck,
  onEditCheckItem,
}: {
  note: EditorNote;
  onBack?: () => void;
  onConnections?: () => void;
  onAddBlock?: () => void;
  onEditTitle?: (text: string) => void;
  onEditBlockText?: (blockId: string, text: string) => void;
  onToggleCheck?: (blockId: string, index: number) => void;
  onEditCheckItem?: (blockId: string, index: number, text: string) => void;
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
        <button className="nav-action" onClick={onConnections} aria-label="Connections">
          <MoreHorizontal className="ic" />
        </button>
      </div>

      <div className="doc">
        <div className="inline-dot">
          <div className={"proj-icon cat-bg-" + catColor(note.category)}>
            <FileText className="ic" />
          </div>
          <span className="eyebrow">{note.eyebrow}</span>
        </div>
        <Editable tag="div" className="t-h2" value={note.title} onSave={onEditTitle} />

        {inline.map((b) => {
          if (b.type === "heading")
            return <Editable key={b.id} tag="div" className="block-h" value={b.text}
              onSave={onEditBlockText ? (t) => onEditBlockText(b.id, t) : undefined} />;
          if (b.type === "text")
            return <Editable key={b.id} tag="div" className="t-body" value={b.text}
              onSave={onEditBlockText ? (t) => onEditBlockText(b.id, t) : undefined} />;
          if (b.type === "checklist")
            return <Checklist key={b.id} block={b} onToggle={onToggleCheck} onEditItem={onEditCheckItem} />;
          if (b.type === "bulleted_list")
            return <div key={b.id}>{b.items.map((it, j) => <div className="t-body" key={j}>{"\u2022 " + it}</div>)}</div>;
          if (b.type === "numbered_list")
            return <div key={b.id}>{b.items.map((it, j) => <div className="t-body" key={j}>{j + 1 + ". " + it}</div>)}</div>;
          if (b.type === "table") return <NoteTable key={b.id} block={b} />;
          return null;
        })}
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
          Add Block
        </button>
      </div>
    </div>
  );
}
