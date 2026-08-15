import { useEffect, useRef } from "react";

// THE inline text-edit primitive (editing coverage map, universal
// mechanics): if you can see it, you can change it, where it stands. Tap
// gives the caret, blur or Enter saves, and there is no Save button because
// editing in place IS the feedback. One implementation for every surface; a
// second contentEditable anywhere else is a review-blocking violation,
// enforced by law test.
//
// Read-only when no onSave is given (static use). Sets its text once and on
// external change; never while focused, so the caret is stable.
//
// The canvas hooks (onEnter, onEmptyBackspace, onTransform) exist for
// block-canvas surfaces like the note editor; plain fields simply omit them.
export default function InlineEdit({
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
