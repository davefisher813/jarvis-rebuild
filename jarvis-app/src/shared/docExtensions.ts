// THE DOCUMENT'S ORGANISATION TOOLS (the writing system, wave 3, 2026-09-14).
//
// Two Tiptap extensions the shared editor mounts on its document level:
//
// FOLDING. A heading can close the section under it (everything up to the
// next heading of the same or a higher level). Folded is interface state in
// this plugin, never in the document: an export or a copy sees every word,
// and a note opened on another device opens unfolded. The chevron before
// each heading is a widget decoration; the hidden blocks are node
// decorations wearing a class. Positions are mapped through every
// transaction so a fold survives typing above it.
//
// SEARCH. Find in note, with every match highlighted and the current one
// marked, and replace one or all. Replace All is one transaction, so it is
// one Undo. The query lives in plugin state, so the bar that drives it can
// live anywhere on the screen.

import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

// ---- folding ---------------------------------------------------------------

export const foldKey = new PluginKey<FoldState>("docFolding");
interface FoldState { folded: number[] }

/** The end of the section a heading at `pos` opens: the position before the
 *  next heading of the same or a higher level, or the end of the document. */
export function sectionEnd(doc: PMNode, pos: number): number {
  const heading = doc.nodeAt(pos);
  if (!heading || heading.type.name !== "heading") return pos;
  const level = (heading.attrs.level as number) ?? 1;
  let end = doc.content.size;
  let after = pos + heading.nodeSize;
  doc.forEach((node, offset) => {
    if (offset < after) return;
    if (end !== doc.content.size) return;
    if (node.type.name === "heading" && ((node.attrs.level as number) ?? 1) <= level) end = offset;
  });
  return end;
}

/** Every heading, with where it sits, for the outline. */
export function outlineOf(doc: PMNode): { pos: number; level: number; text: string }[] {
  const out: { pos: number; level: number; text: string }[] = [];
  doc.forEach((node, offset) => {
    if (node.type.name === "heading") out.push({ pos: offset, level: (node.attrs.level as number) ?? 1, text: node.textContent });
  });
  return out;
}

function foldDecorations(state: EditorState, folded: number[]): DecorationSet {
  const decos: Decoration[] = [];
  const doc = state.doc;
  doc.forEach((node, offset) => {
    if (node.type.name !== "heading") return;
    const open = !folded.includes(offset);
    decos.push(Decoration.widget(offset + 1, () => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "doc-fold" + (open ? "" : " closed");
      b.setAttribute("aria-label", open ? "Fold section" : "Unfold section");
      b.setAttribute("aria-expanded", open ? "true" : "false");
      b.setAttribute("data-fold-pos", String(offset));
      b.contentEditable = "false";
      return b;
    }, { side: -1, key: "fold-" + offset + "-" + (open ? "o" : "c"), stopEvent: () => true, ignoreSelection: true }));
    if (!open) {
      const end = sectionEnd(doc, offset);
      doc.nodesBetween(offset + node.nodeSize, end, (child, childPos, parent) => {
        if (parent !== doc) return false;
        decos.push(Decoration.node(childPos, childPos + child.nodeSize, { class: "doc-folded" }));
        return false;
      });
      decos.push(Decoration.node(offset, offset + node.nodeSize, { class: "doc-heading-closed" }));
    }
  });
  return DecorationSet.create(doc, decos);
}

export const Folding = Extension.create({
  name: "docFolding",
  addProseMirrorPlugins() {
    return [
      new Plugin<FoldState>({
        key: foldKey,
        state: {
          init: () => ({ folded: [] }),
          apply(tr, prev) {
            const meta = tr.getMeta(foldKey) as { toggle?: number; clear?: boolean } | undefined;
            let folded = prev.folded.map((p) => tr.mapping.map(p));
            // A heading that stopped being a heading unfolds.
            folded = folded.filter((p) => tr.doc.nodeAt(p)?.type.name === "heading");
            if (meta?.clear) folded = [];
            if (meta?.toggle !== undefined) folded = folded.includes(meta.toggle) ? folded.filter((p) => p !== meta.toggle) : [...folded, meta.toggle];
            return { folded };
          },
        },
        props: {
          decorations(state) { return foldDecorations(state, foldKey.getState(state)?.folded ?? []); },
          handleClick(view, _pos, event) {
            const target = event.target as HTMLElement | null;
            const btn = target?.closest?.("button.doc-fold") as HTMLElement | null;
            if (!btn) return false;
            const pos = Number(btn.getAttribute("data-fold-pos"));
            if (!Number.isFinite(pos)) return false;
            view.dispatch(view.state.tr.setMeta(foldKey, { toggle: pos }));
            return true;
          },
        },
      }),
    ];
  },
});

export function foldedHeadings(editor: Editor): number[] {
  return foldKey.getState(editor.state)?.folded ?? [];
}
export function toggleFold(editor: Editor, pos: number): void {
  editor.view.dispatch(editor.state.tr.setMeta(foldKey, { toggle: pos }));
}
export function unfoldAll(editor: Editor): void {
  editor.view.dispatch(editor.state.tr.setMeta(foldKey, { clear: true }));
}

// ---- sections --------------------------------------------------------------

/** The heading that opens the section the caret is in, or null. */
export function sectionAt(state: EditorState): { pos: number; end: number } | null {
  const from = state.selection.from;
  let found: number | null = null;
  state.doc.forEach((node, offset) => {
    if (node.type.name === "heading" && offset <= from) found = offset;
  });
  if (found === null) return null;
  return { pos: found, end: sectionEnd(state.doc, found) };
}

/** Move the caret's section above the section before it (dir -1) or under
 *  the section after it (dir 1). One transaction, one Undo. */
export function moveSection(editor: Editor, dir: -1 | 1): boolean {
  const state = editor.state;
  const sec = sectionAt(state);
  if (!sec) return false;
  const doc = state.doc;
  const slice = doc.slice(sec.pos, sec.end);
  let tr: Transaction;
  if (dir === -1) {
    // The previous section starts at the nearest heading before this one, or
    // at the top of the document when nothing above is headed.
    let prevPos = 0;
    doc.forEach((node, offset) => { if (node.type.name === "heading" && offset < sec.pos) prevPos = offset; });
    if (prevPos === sec.pos) return false;
    tr = state.tr.delete(sec.pos, sec.end).insert(prevPos, slice.content);
    tr.setSelection(TextSelection.near(tr.doc.resolve(prevPos + 1)));
  } else {
    const nextHeading = doc.nodeAt(sec.end);
    if (!nextHeading || sec.end >= doc.content.size) return false;
    const nextEnd = sectionEnd(doc, sec.end);
    const insertAt = nextEnd - (sec.end - sec.pos);
    tr = state.tr.delete(sec.pos, sec.end).insert(insertAt, slice.content);
    tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt + 1)));
  }
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** The nodes of the caret's section, as document JSON, for Copy Section. */
export function sectionDoc(editor: Editor): { type: "doc"; content: Record<string, unknown>[] } | null {
  const sec = sectionAt(editor.state);
  if (!sec) return null;
  const content = editor.state.doc.slice(sec.pos, sec.end).content.toJSON() as Record<string, unknown>[] | null;
  return content ? { type: "doc", content } : null;
}

/** A new heading above the selected blocks, ready to type into. */
export function groupUnderHeading(editor: Editor): boolean {
  const { state } = editor;
  const $from = state.doc.resolve(state.selection.from);
  const depth1 = $from.depth >= 1 ? $from.before(1) : 0;
  const heading = state.schema.nodes.heading;
  if (!heading) return false;
  const tr = state.tr.insert(depth1, heading.create({ level: 2 }));
  tr.setSelection(TextSelection.create(tr.doc, depth1 + 1));
  editor.view.dispatch(tr.scrollIntoView());
  editor.commands.focus();
  return true;
}

// ---- search ----------------------------------------------------------------

export const searchKey = new PluginKey<SearchState>("docSearch");
export interface SearchState { query: string; matches: { from: number; to: number }[]; index: number }

function findMatches(doc: PMNode, query: string): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  if (!query) return out;
  const q = query.toLowerCase();
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text.toLowerCase();
    let i = text.indexOf(q);
    while (i >= 0) {
      out.push({ from: pos + i, to: pos + i + q.length });
      i = text.indexOf(q, i + q.length);
    }
  });
  return out;
}

export const Search = Extension.create({
  name: "docSearch",
  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchKey,
        state: {
          init: () => ({ query: "", matches: [], index: 0 }),
          apply(tr, prev) {
            const meta = tr.getMeta(searchKey) as { query?: string; index?: number } | undefined;
            const query = meta?.query ?? prev.query;
            if (!query) return { query: "", matches: [], index: 0 };
            const matches = tr.docChanged || meta?.query !== undefined ? findMatches(tr.doc, query) : prev.matches;
            let index = meta?.index ?? (meta?.query !== undefined ? 0 : prev.index);
            if (matches.length === 0) index = 0;
            else index = ((index % matches.length) + matches.length) % matches.length;
            return { query, matches, index };
          },
        },
        props: {
          decorations(state) {
            const s = searchKey.getState(state);
            if (!s || s.matches.length === 0) return DecorationSet.empty;
            return DecorationSet.create(state.doc, s.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: "doc-match" + (i === s.index ? " current" : "") })));
          },
        },
      }),
    ];
  },
});

export function searchState(editor: Editor): SearchState {
  return searchKey.getState(editor.state) ?? { query: "", matches: [], index: 0 };
}
export function setSearch(editor: Editor, query: string): void {
  editor.view.dispatch(editor.state.tr.setMeta(searchKey, { query, index: 0 }));
  scrollToMatch(editor);
}
export function stepSearch(editor: Editor, dir: -1 | 1): void {
  const s = searchState(editor);
  if (s.matches.length === 0) return;
  editor.view.dispatch(editor.state.tr.setMeta(searchKey, { index: s.index + dir }));
  scrollToMatch(editor);
}
function scrollToMatch(editor: Editor): void {
  const s = searchState(editor);
  const m = s.matches[s.index];
  if (!m) return;
  const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, m.from, m.to)).scrollIntoView();
  editor.view.dispatch(tr);
}
/** Replace the current match; the next one becomes current. */
export function replaceCurrent(editor: Editor, replacement: string): boolean {
  const s = searchState(editor);
  const m = s.matches[s.index];
  if (!m) return false;
  editor.view.dispatch(editor.state.tr.insertText(replacement, m.from, m.to).setMeta(searchKey, { index: s.index }));
  scrollToMatch(editor);
  return true;
}
/** Replace every match in one transaction: one Undo brings them all back. */
export function replaceAll(editor: Editor, replacement: string): number {
  const s = searchState(editor);
  if (s.matches.length === 0) return 0;
  const tr = editor.state.tr;
  for (const m of [...s.matches].reverse()) tr.insertText(replacement, m.from, m.to);
  editor.view.dispatch(tr.setMeta(searchKey, { index: 0 }));
  return s.matches.length;
}
