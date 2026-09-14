// THE SHARED DOCUMENT EDITOR (the writing system, 2026-09-14).
//
// One continuous editing surface for anything longer than a line: Notes
// first, then Brain documents, Decisions, email and the quick multiline
// fields, each at its own level. Built on Tiptap (ProseMirror): a real
// document model, selection-aware transactions, native selection, dictation
// and spelling left to the browser, one undo entry per logical action, and
// no full re-render on a keystroke.
//
// The rules of the road (the brief's section 3) are ProseMirror's own:
// Return in a paragraph starts another; Return in a populated bullet makes
// the next; Return in an empty top-level bullet leaves the list; Return in an
// empty nested bullet outdents one level; Backspace at the start of a bullet
// lifts it before it merges any text. The Markdown shortcuts (-, 1., #, [ ],
// >, ```) are input rules, and every one is one undo away.
//
// While the surface is focused a compact bar sits just above the keyboard
// (the visual viewport is mirrored into --vv-top and --vv-h by
// shared/viewport.ts): Undo, Redo, Format, List, Insert and Done. Every
// control swallows mousedown so a tap never blurs the text, the selection
// survives a formatting choice, and focus returns to the same place. Done
// blurs, which is what dismisses the keyboard; saving is the caller's job and
// happens on its own. The body wears `writing` while focused so the tab bar
// and the composer get out of the way.
//
// Laws: this is the ONLY file that mounts Tiptap (laws/editingPrimitives).
// Surfaces configure it through `level` and the callbacks; none draws its
// own toolbar or its own contentEditable.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { Node } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Highlight from "@tiptap/extension-highlight";
import Placeholder from "@tiptap/extension-placeholder";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import { looksLikeMarkdown, parseMarkdown, textToParagraphs } from "../notes/markdown";
import { Undo2, Redo2, Bold, Italic, Strikethrough, Highlighter, Heading1, Type, List as ListIcon, ListChecks, ListOrdered, Quote, Code, Minus, Table as TableIcon, Lightbulb, Image, Paperclip, Link2, IndentIncrease, IndentDecrease, Eraser } from "./icons";

export type Doc = JSONContent;
export type DocLevel = "document" | "compact" | "quick";

export interface DocEditorHandle {
  focus: () => void;
  blur: () => void;
  editor: Editor | null;
  /** The whole document as it is right now, unsaved edits included. */
  getDoc: () => Doc | null;
  /** The selected part of the document as a document of its own, or null
   *  when nothing is selected. */
  getSelectionDoc: () => Doc | null;
}

// A callout is a paragraph that wants noticing: the old callout block, as a
// wrapper node the editor can toggle in and out of.
const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "paragraph+",
  defining: true,
  parseHTML() { return [{ tag: "div[data-callout]" }]; },
  renderHTML() { return ["div", { "data-callout": "", class: "doc-callout" }, 0]; },
  addCommands() {
    return {
      toggleCallout: () => ({ commands }) => commands.toggleWrap(this.name),
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: { toggleCallout: () => ReturnType };
  }
}

// A checklist line remembers the task made from it.
const LinkedTaskItem = TaskItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      taskId: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-task-id"),
        renderHTML: (attrs: { taskId?: string | null }) => (attrs.taskId ? { "data-task-id": attrs.taskId } : {}),
      },
    };
  },
});

export interface DocEditorProps {
  doc: Doc;
  /** Changes when a different document is loaded; the same key with a new
   *  doc is a background refresh, applied only while the editor is idle. */
  docKey: string;
  onChange: (doc: Doc) => void;
  level?: DocLevel;
  placeholder?: string;
  autofocus?: boolean;
  onFocusChange?: (focused: boolean) => void;
  onInsertPhoto?: () => void;
  onInsertFile?: () => void;
  ariaLabel?: string;
  className?: string;
  /** Extra rows for the bar's Insert menu, from the surface. */
  insertExtra?: ReactNode;
}

type Menu = "format" | "list" | "insert" | null;

// Undo the paste, then put the chosen content where it was. An empty line
// at that spot is taken by the content rather than left blank above it.
function replacePaste(editor: Editor, from: number, content: JSONContent[]) {
  editor.commands.undo();
  const at = Math.min(from, editor.state.doc.content.size);
  const $p = editor.state.doc.resolve(at);
  const empty = $p.parent.isTextblock && $p.parent.content.size === 0 && $p.depth >= 1;
  const target = empty ? { from: $p.before(), to: $p.after() } : at;
  editor.chain().focus().insertContentAt(target, content).run();
}

const DocEditor = forwardRef<DocEditorHandle, DocEditorProps>(function DocEditor(
  { doc, docKey, onChange, level = "document", placeholder = "Start Writing", autofocus = false, onFocusChange, onInsertPhoto, onInsertFile, ariaLabel = "Document", className, insertExtra },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const focusedRef = useRef(false);
  const [menu, setMenu] = useState<Menu>(null);
  // CLEAN PASTE (wave 2). The schema already keeps only what the document
  // knows (paragraphs, lists, headings, links, emphasis, code) and drops
  // fonts, sizes, colours and controls on its own. What is left to offer is
  // the choice: Text Only, Format Markdown when the paste reads as Markdown,
  // and Undo, on one row over the bar for a few seconds. The clipboard is
  // read only inside the paste event, never on its own.
  const [paste, setPaste] = useState<{ from: number; text: string; html: string } | null>(null);
  useEffect(() => {
    if (!paste) return;
    const t = setTimeout(() => setPaste(null), 8000);
    return () => clearTimeout(t);
  }, [paste]);
  // What the editor last emitted, so a refresh carrying our own words back
  // is never re-applied over the caret.
  const lastEmitted = useRef<string>(JSON.stringify(doc));
  const keyRef = useRef(docKey);
  const [, setTick] = useState(0);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, linkOnPaste: true },
        undoRedo: { depth: 200, newGroupDelay: 500 },
      }),
      TaskList,
      LinkedTaskItem.configure({ nested: true }),
      Highlight,
      Callout,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({ placeholder }),
    ],
    content: doc,
    autofocus: autofocus ? "end" : false,
    editorProps: {
      attributes: { class: "doc-pm", role: "textbox", "aria-multiline": "true", "aria-label": ariaLabel, spellcheck: "true", autocapitalize: "sentences", autocorrect: "on" },
      handlePaste: (view, event) => {
        const cd = event.clipboardData;
        const text = cd?.getData("text/plain") ?? "";
        const html = cd?.getData("text/html") ?? "";
        if (text.includes("\n") || html.trim()) setPaste({ from: view.state.selection.from, text, html });
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      const json = ed.getJSON();
      lastEmitted.current = JSON.stringify(json);
      onChange(json);
    },
    onFocus: () => { focusedRef.current = true; setFocused(true); onFocusChange?.(true); },
    onBlur: () => { focusedRef.current = false; setFocused(false); setMenu(null); onFocusChange?.(false); },
    onSelectionUpdate: () => setTick((t) => t + 1),
    onTransaction: () => setTick((t) => t + 1),
  });

  useImperativeHandle(ref, () => ({
    focus: () => editor?.commands.focus("end"),
    blur: () => editor?.commands.blur(),
    editor: editor ?? null,
    getDoc: () => editor?.getJSON() ?? null,
    getSelectionDoc: () => {
      if (!editor || editor.state.selection.empty) return null;
      const content = editor.state.selection.content().content.toJSON() as JSONContent[] | null;
      return content && content.length ? { type: "doc", content } : null;
    },
  }), [editor]);

  // A new document replaces the content outright. The same document coming
  // back changed (a refresh from the store, a checklist line ticked in
  // Tasks) applies only while nobody is typing here: the local edit is the
  // newer one, and the next save carries it up.
  useEffect(() => {
    if (!editor) return;
    const json = JSON.stringify(doc);
    if (keyRef.current !== docKey) {
      keyRef.current = docKey;
      editor.commands.setContent(doc, { emitUpdate: false });
      lastEmitted.current = json;
      return;
    }
    if (json === lastEmitted.current) return;
    if (focusedRef.current) return;
    editor.commands.setContent(doc, { emitUpdate: false });
    lastEmitted.current = json;
    // `focused` is a dependency on purpose: a refresh held back while the
    // words were being typed applies the moment the editor goes idle.
  }, [editor, doc, docKey, focused]);

  useEffect(() => {
    if (!focused) return;
    document.body.classList.add("writing");
    return () => document.body.classList.remove("writing");
  }, [focused]);

  const swallow = (e: React.SyntheticEvent) => e.preventDefault();
  const run = (fn: (ed: Editor) => void) => () => { if (!editor) return; fn(editor); setMenu(null); };
  const on = (name: string, attrs?: Record<string, unknown>) => !!editor?.isActive(name, attrs);

  const bar = editor && focused ? (
    <div className="doc-kbar" role="toolbar" aria-label="Writing tools" onMouseDown={swallow}>
      {paste && (
        <div className="doc-paste" role="group" aria-label="Paste options">
          <span className="doc-paste-k">Pasted</span>
          <button type="button" className="chip" onClick={() => { const p = paste; setPaste(null); replacePaste(editor, p.from, textToParagraphs(p.text)); }}>Text Only</button>
          {looksLikeMarkdown(paste.text) && (
            <button type="button" className="chip" onClick={() => { const p = paste; setPaste(null); replacePaste(editor, p.from, parseMarkdown(p.text)); }}>Format Markdown</button>
          )}
          <button type="button" className="chip" onClick={() => { setPaste(null); editor.chain().focus().undo().run(); }}>Undo</button>
        </div>
      )}
      {menu === "format" && (
        <div className="doc-kmenu" role="group" aria-label="Format">
          <button type="button" className={"chip" + (on("bold") ? " active" : "")} aria-pressed={on("bold")} onClick={run((ed) => ed.chain().focus().toggleBold().run())}><Bold className="ic" /> Bold</button>
          <button type="button" className={"chip" + (on("italic") ? " active" : "")} aria-pressed={on("italic")} onClick={run((ed) => ed.chain().focus().toggleItalic().run())}><Italic className="ic" /> Italic</button>
          <button type="button" className={"chip" + (on("strike") ? " active" : "")} aria-pressed={on("strike")} onClick={run((ed) => ed.chain().focus().toggleStrike().run())}><Strikethrough className="ic" /> Strike</button>
          <button type="button" className={"chip" + (on("highlight") ? " active" : "")} aria-pressed={on("highlight")} onClick={run((ed) => ed.chain().focus().toggleHighlight().run())}><Highlighter className="ic" /> Highlight</button>
          <button type="button" className={"chip" + (on("heading", { level: 1 }) ? " active" : "")} aria-pressed={on("heading", { level: 1 })} onClick={run((ed) => ed.chain().focus().toggleHeading({ level: 1 }).run())}><Heading1 className="ic" /> Heading</button>
          <button type="button" className={"chip" + (on("heading", { level: 2 }) ? " active" : "")} aria-pressed={on("heading", { level: 2 })} onClick={run((ed) => ed.chain().focus().toggleHeading({ level: 2 }).run())}>Subheading</button>
          <button type="button" className={"chip" + (on("paragraph") && !on("blockquote") && !on("callout") ? " active" : "")} onClick={run((ed) => ed.chain().focus().setParagraph().run())}><Type className="ic" /> Text</button>
          <button type="button" className={"chip" + (on("blockquote") ? " active" : "")} aria-pressed={on("blockquote")} onClick={run((ed) => ed.chain().focus().toggleBlockquote().run())}><Quote className="ic" /> Quote</button>
          <button type="button" className={"chip" + (on("codeBlock") ? " active" : "")} aria-pressed={on("codeBlock")} onClick={run((ed) => ed.chain().focus().toggleCodeBlock().run())}><Code className="ic" /> Code</button>
          <button type="button" className="chip" onClick={run((ed) => {
            const prev = ed.getAttributes("link").href as string | undefined;
            const href = window.prompt("Link address", prev ?? "https://");
            if (href === null) return;
            if (!href.trim() || href.trim() === "https://") ed.chain().focus().unsetLink().run();
            else ed.chain().focus().extendMarkRange("link").setLink({ href: href.trim() }).run();
          })}><Link2 className="ic" /> Link</button>
          <button type="button" className="chip" onClick={run((ed) => ed.chain().focus().unsetAllMarks().clearNodes().run())}><Eraser className="ic" /> Clear Formatting</button>
        </div>
      )}
      {menu === "list" && (
        <div className="doc-kmenu" role="group" aria-label="List">
          <button type="button" className={"chip" + (on("bulletList") ? " active" : "")} aria-pressed={on("bulletList")} onClick={run((ed) => ed.chain().focus().toggleBulletList().run())}><ListIcon className="ic" /> Bullets</button>
          <button type="button" className={"chip" + (on("orderedList") ? " active" : "")} aria-pressed={on("orderedList")} onClick={run((ed) => ed.chain().focus().toggleOrderedList().run())}><ListOrdered className="ic" /> Numbered</button>
          <button type="button" className={"chip" + (on("taskList") ? " active" : "")} aria-pressed={on("taskList")} onClick={run((ed) => ed.chain().focus().toggleTaskList().run())}><ListChecks className="ic" /> Checklist</button>
          <button type="button" className="chip" aria-label="Indent" onClick={run((ed) => { if (!ed.chain().focus().sinkListItem("listItem").run()) ed.chain().focus().sinkListItem("taskItem").run(); })}><IndentIncrease className="ic" /> Indent</button>
          <button type="button" className="chip" aria-label="Outdent" onClick={run((ed) => { if (!ed.chain().focus().liftListItem("listItem").run()) ed.chain().focus().liftListItem("taskItem").run(); })}><IndentDecrease className="ic" /> Outdent</button>
        </div>
      )}
      {menu === "insert" && (
        <div className="doc-kmenu" role="group" aria-label="Insert">
          <button type="button" className="chip" onClick={run((ed) => ed.chain().focus().setHorizontalRule().run())}><Minus className="ic" /> Divider</button>
          <button type="button" className="chip" onClick={run((ed) => ed.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run())}><TableIcon className="ic" /> Table</button>
          <button type="button" className={"chip" + (on("callout") ? " active" : "")} onClick={run((ed) => ed.chain().focus().toggleCallout().run())}><Lightbulb className="ic" /> Callout</button>
          {onInsertPhoto && <button type="button" className="chip" onClick={() => { setMenu(null); onInsertPhoto(); }}><Image className="ic" /> Photo</button>}
          {onInsertFile && <button type="button" className="chip" onClick={() => { setMenu(null); onInsertFile(); }}><Paperclip className="ic" /> File</button>}
          {insertExtra}
        </div>
      )}
      <div className="doc-kbar-row">
        <button type="button" className="doc-kbtn" aria-label="Undo" disabled={!editor.can().undo()} onClick={run((ed) => ed.chain().focus().undo().run())}><Undo2 className="ic" /></button>
        <button type="button" className="doc-kbtn" aria-label="Redo" disabled={!editor.can().redo()} onClick={run((ed) => ed.chain().focus().redo().run())}><Redo2 className="ic" /></button>
        <button type="button" className={"doc-kbtn doc-kword" + (menu === "format" ? " on" : "")} aria-expanded={menu === "format"} onClick={() => setMenu((m) => (m === "format" ? null : "format"))}>Format</button>
        {level !== "quick" && (
          <button type="button" className={"doc-kbtn doc-kword" + (menu === "list" ? " on" : "")} aria-expanded={menu === "list"} onClick={() => setMenu((m) => (m === "list" ? null : "list"))}>List</button>
        )}
        {level === "document" && (
          <button type="button" className={"doc-kbtn doc-kword" + (menu === "insert" ? " on" : "")} aria-expanded={menu === "insert"} onClick={() => setMenu((m) => (m === "insert" ? null : "insert"))}>Insert</button>
        )}
        <span className="doc-kgrow" />
        <button type="button" className="doc-kbtn doc-kword doc-kdone" onClick={() => editor.commands.blur()}>Done</button>
      </div>
    </div>
  ) : null;

  return (
    <div className={"doc-editor doc-editor-" + level + (className ? " " + className : "")}>
      <EditorContent editor={editor} />
      {bar && typeof document !== "undefined" ? createPortal(bar, document.body) : null}
    </div>
  );
});

export default DocEditor;
