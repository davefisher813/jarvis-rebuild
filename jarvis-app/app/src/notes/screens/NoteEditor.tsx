import { MoreHorizontal, FileText, Image, Check, Plus } from "lucide-react";

// Matches locked frame #47 "Editor / Blocks". Renders a note's blocks by type:
// heading, text, checklist, table inline in the document; file/photo grouped
// into an attachments card. Uses .screen in place of the preview device chrome.

type ChecklistItem = { text: string; done?: boolean };
type EditorBlock =
  | { type: "heading"; text: string }
  | { type: "text"; text: string }
  | { type: "checklist"; items: ChecklistItem[] }
  | { type: "table"; header: string[]; numCol?: number; rows: string[][]; sum?: string[] }
  | { type: "file"; name: string; size: string }
  | { type: "photo"; name: string; size: string };

export interface EditorNote {
  category: string;
  eyebrow: string;
  title: string;
  description?: string;
  blocks: EditorBlock[];
}

function Checklist({ items }: { items: ChecklistItem[] }) {
  return (
    <>
      {items.map((it, i) => (
        <div className={"check-line" + (it.done ? " done" : "")} key={i}>
          <div className={"cb" + (it.done ? " on" : "")}>
            {it.done && <Check className="ic" />}
          </div>
          <span>{it.text}</span>
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
}: {
  note: EditorNote;
  onBack?: () => void;
  onConnections?: () => void;
  onAddBlock?: () => void;
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
          <div className={"proj-icon cat-bg-" + note.category}>
            <FileText className="ic" />
          </div>
          <span className="eyebrow">{note.eyebrow}</span>
        </div>
        <div className="t-h2">{note.title}</div>
        {note.description && <div className="t-body">{note.description}</div>}

        {inline.map((b, i) => {
          if (b.type === "heading") return <div className="block-h" key={i}>{b.text}</div>;
          if (b.type === "text") return <div className="t-body" key={i}>{b.text}</div>;
          if (b.type === "checklist") return <Checklist items={b.items} key={i} />;
          if (b.type === "table") return <NoteTable block={b} key={i} />;
          return null;
        })}
      </div>

      {attachments.length > 0 && (
        <div className="pad-x">
          <div className="card">
            {attachments.map((a, i) => (
              <div className="row" key={i}>
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
