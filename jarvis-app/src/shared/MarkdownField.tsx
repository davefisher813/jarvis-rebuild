// A DOCUMENT FIELD THAT STORES WORDS (the writing system, wave 3c, 2026-09-14).
//
// The surfaces outside Notes keep a string: a Brain document's text, a
// decision's notes, a task's notes, a workout's note. This wraps the shared
// editor for them: the string comes in, the editor shows it as a document,
// and the string goes back out as Markdown (or plain text where the surface
// only ever reads words). The document is built once per `docKey`, never
// re-parsed while the person types, so marks and lists typed here are never
// flattened by a refresh; the parent's string is updated on every change
// and `onBlur` fires when the editor loses focus, which is when the parents
// that save on blur save.

import { forwardRef, useMemo, useRef, useImperativeHandle } from "react";
import DocEditor, { type DocEditorHandle, type DocLevel, type Doc } from "./DocEditor";
import { parseMarkdown, docToMarkdown, docToPlainText, textToParagraphs } from "../notes/markdown";

export interface MarkdownFieldProps {
  value: string;
  /** Changes when a different record is loaded; the value is re-read then. */
  docKey: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  level?: DocLevel;
  /** "markdown" keeps structure in the string; "text" stores plain words. */
  format?: "markdown" | "text";
  placeholder?: string;
  ariaLabel: string;
  autofocus?: boolean;
  className?: string;
}

const MarkdownField = forwardRef<DocEditorHandle, MarkdownFieldProps>(function MarkdownField(
  { value, docKey, onChange, onBlur, level = "compact", format = "markdown", placeholder, ariaLabel, autofocus, className },
  ref,
) {
  const inner = useRef<DocEditorHandle>(null);
  useImperativeHandle(ref, () => inner.current as DocEditorHandle, []);
  // Built once per key: the string is parsed when the record arrives, not on
  // every keystroke that changes it.
  const doc = useMemo<Doc>(() => {
    const content = format === "markdown" ? parseMarkdown(value) : textToParagraphs(value);
    return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
  }, [docKey, format]);
  const emit = (d: Doc) => onChange((format === "markdown" ? docToMarkdown(d, { includeTitle: false }) : docToPlainText(d, { includeTitle: false })).trimEnd());
  return (
    <DocEditor
      ref={inner}
      doc={doc}
      docKey={docKey}
      onChange={emit}
      level={level}
      placeholder={placeholder}
      ariaLabel={ariaLabel}
      autofocus={autofocus}
      className={className}
      onFocusChange={(f) => { if (!f) onBlur?.(); }}
    />
  );
});

export default MarkdownField;
