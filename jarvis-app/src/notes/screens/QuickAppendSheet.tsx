import { useRef } from "react";
import { createPortal } from "react-dom";
import DocEditor, { type DocEditorHandle } from "../../shared/DocEditor";
import { emptyDoc, isDocEmpty, type Doc } from "../docModel";

// QUICK APPEND (the writing system, wave 3, 2026-09-14). A line or two onto
// an existing note without opening it: the quick level of the shared editor
// in a sheet, Done sends the lines to the end of the note. Cancel keeps
// nothing. Lists and marks typed here arrive as typed.
export default function QuickAppendSheet({ title, onDone, onCancel }: {
  title: string;
  onDone: (nodes: NonNullable<Doc["content"]>) => void;
  onCancel: () => void;
}) {
  const ref = useRef<DocEditorHandle>(null);
  const done = () => {
    const doc = ref.current?.getDoc();
    if (!doc || isDocEmpty(doc)) { onCancel(); return; }
    const content = (doc.content ?? []).filter((n, i, all) => !(i === all.length - 1 && n.type === "paragraph" && !n.content));
    onDone(content);
  };
  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Add to {title}</div></div>
        <div className="pad-x sheet-form">
          <DocEditor ref={ref} doc={emptyDoc()} docKey={"append:" + title} onChange={() => {}} level="quick" placeholder="A Line for This Note" ariaLabel="Lines to add" autofocus />
        </div>
        <div className="pad-x sheet-actions">
          <button type="button" className="btn btn-primary btn-block" onClick={done}>Add to Note</button>
          <button type="button" className="btn btn-block" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
