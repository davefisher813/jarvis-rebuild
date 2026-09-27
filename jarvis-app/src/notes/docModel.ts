// THE NOTE'S DOCUMENT MODEL (the writing system, 2026-09-14).
//
// A note used to be a flat array of blocks, each one its own editable field.
// The shared editor (shared/DocEditor.tsx) works on one continuous document
// instead: a ProseMirror tree stored as JSON on NoteData.doc. The blocks array
// stays, as a PROJECTION of the document written alongside it on every save,
// so search, the checklist-to-task flows, older builds and every other reader
// of `blocks` keep working with no migration. The document is the truth when
// it is present; a note that predates it is built from its blocks on open.
//
// Nothing here touches the DOM. It is the one place the shape of a note is
// converted, so the editor, the exporters and the projection can never
// disagree about what a heading or a checklist is.

import type { JSONContent } from "@tiptap/core";
import type { Block, ChecklistItem } from "./types";
import { parseRich, countWords } from "./richtext";

export type Doc = JSONContent;

export function emptyDoc(): Doc {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return "b_" + crypto.randomUUID();
  return "b_" + Math.random().toString(36).slice(2);
}

// ---- blocks -> doc ---------------------------------------------------------

const MARK_OF: Record<string, string> = { "t-b": "bold", "t-i": "italic", "t-hl": "highlight", "t-strike": "strike" };

function inline(raw: string): JSONContent[] {
  const out: JSONContent[] = [];
  for (const s of parseRich(raw ?? "")) {
    if (!s.text) continue;
    const mark = s.cls ? MARK_OF[s.cls] : undefined;
    out.push(mark ? { type: "text", text: s.text, marks: [{ type: mark }] } : { type: "text", text: s.text });
  }
  return out;
}

function withContent(node: JSONContent, content: JSONContent[]): JSONContent {
  return content.length ? { ...node, content } : node;
}

const para = (raw: string): JSONContent => withContent({ type: "paragraph" }, inline(raw));

function items(list: Block["items"]): ChecklistItem[] {
  return (list ?? []).map((it) => (typeof it === "string" ? { text: it, done: false } : it));
}

/** The document for a note that has none yet: its blocks, one node each. */
export function blocksToDoc(blocks: Block[]): Doc {
  const content: JSONContent[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "heading": content.push(withContent({ type: "heading", attrs: { level: 1 } }, inline(b.text ?? ""))); break;
      case "text":
      case "meta": content.push(para(b.text ?? "")); break;
      case "quote": content.push({ type: "blockquote", content: [para(b.text ?? "")] }); break;
      case "callout": content.push({ type: "callout", content: [para(b.text ?? "")] }); break;
      case "divider": content.push({ type: "horizontalRule" }); break;
      case "checklist":
        content.push({
          type: "taskList",
          content: items(b.items).map((it) => ({
            type: "taskItem",
            attrs: { checked: !!it.done, taskId: it.taskId ?? null },
            content: [para(it.text)],
          })),
        });
        break;
      case "bulleted_list":
      case "numbered_list":
        content.push({
          type: b.type === "bulleted_list" ? "bulletList" : "orderedList",
          content: items(b.items).map((it) => ({ type: "listItem", content: [para(it.text)] })),
        });
        break;
      case "table": {
        const cols = b.columns ?? [];
        const rows = b.rows ?? [];
        const width = Math.max(cols.length, ...rows.map((r) => r.length), 1);
        const cell = (kind: "tableHeader" | "tableCell", text: string): JSONContent => ({ type: kind, content: [para(text)] });
        const rowOf = (kind: "tableHeader" | "tableCell", cells: string[]): JSONContent => ({
          type: "tableRow",
          content: Array.from({ length: width }, (_, i) => cell(kind, cells[i] ?? "")),
        });
        content.push({ type: "table", content: [rowOf("tableHeader", cols), ...rows.map((r) => rowOf("tableCell", r))] });
        break;
      }
      // Photos and files are attachments, kept beside the document, never in it.
      case "photo":
      case "file": break;
    }
  }
  if (content.length === 0) content.push({ type: "paragraph" });
  return { type: "doc", content };
}

// ---- doc -> text ------------------------------------------------------------

/** The words of a node with the marks re-spelled as the markers the old
 *  renderer knows (**bold**, *italic*, ==highlight==, ~~strike~~). One marker
 *  per run: the projection is deliberately simpler than the document. */
export function nodeMarkedText(n: JSONContent): string {
  if (n.type === "text") {
    const t = n.text ?? "";
    const marks = (n.marks ?? []).map((m) => m.type);
    if (marks.includes("bold")) return `**${t}**`;
    if (marks.includes("italic")) return `*${t}*`;
    if (marks.includes("highlight")) return `==${t}==`;
    if (marks.includes("strike")) return `~~${t}~~`;
    return t;
  }
  if (n.type === "hardBreak") return " ";
  return (n.content ?? []).map(nodeMarkedText).join("");
}

/** The plain words of a node, markers and all formatting dropped. */
export function nodePlainText(n: JSONContent): string {
  if (n.type === "text") return n.text ?? "";
  if (n.type === "hardBreak") return "\n";
  return (n.content ?? []).map(nodePlainText).join(n.type === "listItem" || n.type === "taskItem" ? " " : "");
}

/** The first line with words in it, for a note whose title is not typed
 *  yet. Empty when the note has none. */
export function firstLineOf(doc: Doc | undefined): string {
  for (const n of doc?.content ?? []) {
    const t = nodePlainText(n).replace(/\s+/g, " ").trim();
    if (t) return t.length > 80 ? t.slice(0, 79).trimEnd() + "…" : t;
  }
  return "";
}

/** What a note is called wherever it is named: its title, or its first line
 *  until one is typed, or Untitled. */
export function displayTitle(d: { title?: string; doc?: Doc; blocks?: Block[] }): string {
  const t = (d.title ?? "").trim();
  if (t) return t;
  const doc = d.doc ?? (d.blocks ? blocksToDoc(d.blocks) : undefined);
  return firstLineOf(doc) || "Untitled";
}

/** THE TITLE THE LIST SHOWS (§AK "a date on the title"; the pass-off,
 *  2026-09-26). A note the calendar made before 2026-09-21 still carries its
 *  date in its stored title ("Meeting Notes · Sep 17") while the row's own
 *  line says the date again under it. The list strips it, and only the list:
 *  only on a note born from an event (its source, or an event connection),
 *  only a trailing " · Mon D", and never in storage. A date he typed himself
 *  on a hand-made note is his and stays; the editor keeps showing the stored
 *  title so he can see it and change it. */
const LEGACY_EVENT_DATE = /\s+\u00b7\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}$/;
export function listTitle(d: { title?: string; doc?: Doc; blocks?: Block[]; source?: { type: string }; connections?: { kind: string }[] }): string {
  const t = displayTitle(d);
  const eventBorn = d.source?.type === "event" || (d.connections ?? []).some((c) => c.kind === "event");
  return eventBorn ? t.replace(LEGACY_EVENT_DATE, "") : t;
}

/** Words in the body. Headings are structure, not writing. */
export function docWordCount(doc: Doc | undefined): number {
  const lines: string[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === "heading") return;
    if (n.type === "paragraph") { lines.push(nodePlainText(n)); return; }
    for (const c of n.content ?? []) walk(c);
  };
  for (const n of doc?.content ?? []) walk(n);
  return countWords(lines);
}

export function isDocEmpty(doc: Doc | undefined): boolean {
  return firstLineOf(doc) === "" && !(doc?.content ?? []).some((n) => n.type === "horizontalRule" || n.type === "table");
}

// ---- doc -> blocks (the projection) ----------------------------------------

type ListKind = "bulleted_list" | "numbered_list";

function listItemsOf(list: JSONContent): string[] {
  // Nested lists flatten into the parent's items: the projection has no
  // levels, the document keeps them.
  const out: string[] = [];
  for (const li of list.content ?? []) {
    const own = (li.content ?? []).filter((c) => c.type !== "bulletList" && c.type !== "orderedList" && c.type !== "taskList");
    out.push(own.map(nodeMarkedText).join(" ").trim());
    for (const c of li.content ?? []) {
      if (c.type === "bulletList" || c.type === "orderedList") out.push(...listItemsOf(c));
      if (c.type === "taskList") out.push(...taskItemsOf(c).map((t) => t.text));
    }
  }
  return out;
}

function taskItemsOf(list: JSONContent): ChecklistItem[] {
  const out: ChecklistItem[] = [];
  for (const li of list.content ?? []) {
    const own = (li.content ?? []).filter((c) => c.type !== "bulletList" && c.type !== "orderedList" && c.type !== "taskList");
    const item: ChecklistItem = { text: own.map(nodeMarkedText).join(" ").trim(), done: !!li.attrs?.checked };
    const taskId = li.attrs?.taskId as string | null | undefined;
    if (taskId) item.taskId = taskId;
    out.push(item);
    for (const c of li.content ?? []) {
      if (c.type === "taskList") out.push(...taskItemsOf(c));
      if (c.type === "bulletList" || c.type === "orderedList") out.push(...listItemsOf(c).map((t) => ({ text: t, done: false })));
    }
  }
  return out;
}

function tableOf(n: JSONContent): { columns: string[]; rows: string[][] } {
  const rows = (n.content ?? []).map((r) => (r.content ?? []).map((c) => (c.content ?? []).map(nodeMarkedText).join(" ").trim()));
  const first = n.content?.[0];
  const headed = !!first && (first.content ?? []).every((c) => c.type === "tableHeader");
  if (headed) return { columns: rows[0] ?? [], rows: rows.slice(1) };
  const width = Math.max(1, ...rows.map((r) => r.length));
  return { columns: Array.from({ length: width }, () => ""), rows };
}

/** The blocks a document projects to. Ids are kept from the previous
 *  projection where a block of the same type sits in the same place, so a
 *  reader holding a block id (a task made from a checklist line) keeps it
 *  through ordinary typing. Attachments (photo, file) are not in the document
 *  and ride through from the previous blocks unchanged, at the end. */
export function docToBlocks(doc: Doc, prev: Block[] = []): Block[] {
  const made: Omit<Block, "id">[] = [];
  for (const n of doc.content ?? []) {
    switch (n.type) {
      case "heading": made.push({ type: "heading", text: nodeMarkedText(n) }); break;
      case "paragraph": made.push({ type: "text", text: nodeMarkedText(n) }); break;
      case "codeBlock": made.push({ type: "text", text: nodePlainText(n) }); break;
      case "blockquote": made.push({ type: "quote", text: (n.content ?? []).map(nodeMarkedText).join(" ").trim() }); break;
      case "callout": made.push({ type: "callout", text: (n.content ?? []).map(nodeMarkedText).join(" ").trim() }); break;
      case "horizontalRule": made.push({ type: "divider" }); break;
      case "taskList": made.push({ type: "checklist", items: taskItemsOf(n) }); break;
      case "bulletList": made.push({ type: "bulleted_list" as ListKind, items: listItemsOf(n) }); break;
      case "orderedList": made.push({ type: "numbered_list" as ListKind, items: listItemsOf(n) }); break;
      case "table": { const t = tableOf(n); made.push({ type: "table", columns: t.columns, rows: t.rows }); break; }
      default: break;
    }
  }
  const prevInline = prev.filter((b) => b.type !== "photo" && b.type !== "file");
  const out: Block[] = made.map((b, i) => {
    const p = prevInline[i];
    return { id: p && p.type === b.type ? p.id : newId(), ...b };
  });
  for (const a of prev) if (a.type === "photo" || a.type === "file") out.push(a);
  return out;
}

// ---- edits the app makes to the document without the editor ---------------

/** A task checked off in Tasks checks its line here too. Returns the same
 *  document when nothing changed, so a caller can skip the write. */
export function setTaskDone(doc: Doc, taskId: string, done: boolean): Doc {
  let changed = false;
  const walk = (n: JSONContent): JSONContent => {
    if (n.type === "taskItem" && n.attrs?.taskId === taskId && !!n.attrs?.checked !== done) {
      changed = true;
      return { ...n, attrs: { ...n.attrs, checked: done } };
    }
    if (!n.content) return n;
    return { ...n, content: n.content.map(walk) };
  };
  const next = walk(doc);
  return changed ? next : doc;
}

/** The checklist state the blocks carry (a task made from a line by
 *  tasksFromChecklist, a line ticked by the app) copied onto the document's
 *  checklist lines in the order the projection lists them: the task id and
 *  the checked state, line for line. Returns the same document when nothing
 *  changed, so a caller can skip the write. */
export function applyChecklistLinks(doc: Doc, blocks: Block[]): Doc {
  const lists = blocks.filter((b) => b.type === "checklist");
  let k = 0;
  let changed = false;
  const content = (doc.content ?? []).map((n) => {
    if (n.type !== "taskList") return n;
    const block = lists[k++];
    if (!block) return n;
    const its = (block.items ?? []).map((it) => (typeof it === "string" ? { text: it, done: false } : it));
    let j = 0;
    const walk = (node: JSONContent): JSONContent => {
      if (node.type === "taskItem") {
        const it = its[j++];
        const own = node.content ? { ...node, content: node.content.map(walk) } : node;
        if (!it) return own;
        const wantId = it.taskId ?? null;
        const wantDone = !!it.done;
        if ((node.attrs?.taskId ?? null) !== wantId || !!node.attrs?.checked !== wantDone) {
          changed = true;
          return { ...own, attrs: { ...node.attrs, taskId: wantId, checked: wantDone } };
        }
        return own;
      }
      return node.content ? { ...node, content: node.content.map(walk) } : node;
    };
    return { ...n, content: (n.content ?? []).map(walk) };
  });
  return changed ? { ...doc, content } : doc;
}

/** Every linked checklist line, as the task it points at and whether it is
 *  checked here. */
export function linkedTasksIn(doc: Doc | undefined): { taskId: string; checked: boolean }[] {
  const out: { taskId: string; checked: boolean }[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === "taskItem" && typeof n.attrs?.taskId === "string" && n.attrs.taskId) out.push({ taskId: n.attrs.taskId, checked: !!n.attrs.checked });
    for (const c of n.content ?? []) walk(c);
  };
  for (const n of doc?.content ?? []) walk(n);
  return out;
}
