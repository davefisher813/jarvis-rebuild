import { useEffect, useRef, useState } from "react";
import { parseRich, hasRich, displayToRawOffset } from "../notes/richtext";

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
//
// RICH MODE (2026-08-19, "dig deeper with the writing features"): with
// rich, the block renders **bold**, *italic*, ==highlight==, ~~strike~~
// formatted while read and raw while edited. A tap on formatted text drops
// the caret at the tapped character, mapped through the markers, so editing
// mid-sentence works like a real writing app.
export default function InlineEdit({
  tag = "div",
  className,
  value,
  placeholder,
  onSave,
  focused,
  rich,
  bid,
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
  rich?: boolean;
  bid?: string;
  onEnter?: (current: string) => void;
  onEmptyBackspace?: () => void;
  onTransform?: (prefix: "#" | "[]" | "-" | "1.", rest: string) => void;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [editing, setEditing] = useState(!!focused);
  const caretAt = useRef<number | null>(null);
  const showRich = !!rich && !editing && hasRich(value);

  useEffect(() => {
    const el = ref.current;
    if (el && !showRich && el.textContent !== value) el.textContent = value;
  }, [value, showRich]);
  // Canvas flow: when this block was just created by Enter, put the caret in it.
  useEffect(() => {
    if (focused) setEditing(true);
    const el = ref.current;
    if (focused && el) {
      el.focus();
      const sel = window.getSelection();
      if (sel) { sel.selectAllChildren(el); sel.collapseToEnd(); }
    }
  }, [focused]);
  // Rich mode: entering edit after a tap on the read view restores the caret
  // at the mapped raw offset.
  useEffect(() => {
    const el = ref.current;
    if (!editing || caretAt.current === null || !el) return;
    el.focus();
    const node = el.firstChild;
    if (node && node.nodeType === Node.TEXT_NODE) {
      const range = document.createRange();
      const off = Math.min(caretAt.current, node.textContent?.length ?? 0);
      range.setStart(node, off);
      range.collapse(true);
      const sel = window.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(range); }
    }
    caretAt.current = null;
  }, [editing]);

  const Tag = tag as "div";
  if (!onSave) return <Tag className={className}>{value}</Tag>;

  if (showRich) {
    return (
      <Tag
        className={className}
        data-bid={bid}
        tabIndex={0}
        onFocus={() => setEditing(true)}
        onClick={(e) => {
          // Map the tapped display position into the raw string.
          const doc = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
          const r = doc.caretRangeFromPoint?.(e.clientX, e.clientY);
          if (r && e.currentTarget.contains(r.startContainer)) {
            let display = 0;
            const walker = document.createTreeWalker(e.currentTarget, NodeFilter.SHOW_TEXT);
            let n = walker.nextNode();
            while (n && n !== r.startContainer) { display += n.textContent?.length ?? 0; n = walker.nextNode(); }
            display += r.startOffset;
            caretAt.current = displayToRawOffset(value, display);
          } else caretAt.current = value.length;
          setEditing(true);
        }}
      >
        {parseRich(value).map((s, i) => (s.cls ? <span key={i} className={s.cls}>{s.text}</span> : s.text))}
      </Tag>
    );
  }

  return (
    <Tag
      ref={ref as React.Ref<HTMLDivElement>}
      className={className}
      data-bid={bid}
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onBlur={(e) => {
        const t = (e.currentTarget.textContent ?? "").trim();
        // Rich handoff: the raw text node was set out-of-band, so React does
        // not know it exists. Clear it before the read view renders its
        // formatted spans, or the two stack up and the save doubles the block.
        if (rich && hasRich(t)) e.currentTarget.textContent = "";
        setEditing(false);
        onSave(t);
      }}
      onKeyDown={(e) => {
        const text = (e.currentTarget.textContent ?? "").trim();
        if (e.key === "Enter" && !e.shiftKey && onEnter) {
          e.preventDefault();
          onEnter(text);
        } else if (e.key === "Enter" && !e.shiftKey) {
          // A PLAIN FIELD COMMITS ON ENTER (2026-08-24). The canvas surfaces
          // pass onEnter because there Enter means "new block"; everywhere
          // else it fell through to contentEditable's default, which inserts
          // a line break into a single-line field. The doctrine at the top of
          // this file says "blur or Enter saves" and Enter did not, on every
          // consumer that was not a canvas.
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          // Put the original back BEFORE blurring, so the blur handler saves
          // the unchanged value and the edit is abandoned rather than half
          // applied. There is no separate cancel path to keep in sync.
          e.currentTarget.textContent = value;
          e.currentTarget.blur();
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
