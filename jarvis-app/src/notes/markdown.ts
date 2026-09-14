// MARKDOWN AND PLAIN TEXT, BOTH WAYS (the writing system, wave 2, 2026-09-14).
//
// The document serialises to Markdown (Copy as Markdown, the .md export) and
// to plain text (Copy, the .txt export), and a pasted block of Markdown
// parses back into document nodes when the person asks for it (Format
// Markdown on the paste hint). The parser is deliberately small: headings,
// bullets, numbers, checklists, quotes, fenced code, rules, bold, italic,
// strike, code and links. Anything else stays as the words it was, which is
// the honest outcome for a pasted line nobody asked to be interpreted.

import type { JSONContent } from "@tiptap/core";
import { nodePlainText } from "./docModel";

type Doc = JSONContent;

// ---- inline ----------------------------------------------------------------

function inlineMd(nodes: JSONContent[] | undefined): string {
  let out = "";
  for (const n of nodes ?? []) {
    if (n.type === "hardBreak") { out += "  \n"; continue; }
    if (n.type !== "text") { out += inlineMd(n.content); continue; }
    let t = n.text ?? "";
    const marks = new Map((n.marks ?? []).map((m) => [m.type, m.attrs ?? {}] as const));
    if (marks.has("code")) t = "`" + t + "`";
    if (marks.has("bold")) t = "**" + t + "**";
    if (marks.has("italic")) t = "*" + t + "*";
    if (marks.has("strike")) t = "~~" + t + "~~";
    if (marks.has("highlight")) t = "==" + t + "==";
    const link = marks.get("link");
    if (link && typeof link.href === "string") t = "[" + t + "](" + link.href + ")";
    out += t;
  }
  return out;
}

// ---- doc -> markdown ------------------------------------------------------

function blockMd(n: JSONContent, depth: number): string[] {
  const pad = "  ".repeat(depth);
  switch (n.type) {
    case "heading": return [pad + "#".repeat(Math.min(6, ((n.attrs?.level as number) ?? 1) + 1)) + " " + inlineMd(n.content)];
    case "paragraph": return [pad + inlineMd(n.content)];
    case "codeBlock": return [pad + "```" + ((n.attrs?.language as string) ?? ""), ...nodePlainText(n).split("\n").map((l) => pad + l), pad + "```"];
    case "blockquote": return (n.content ?? []).flatMap((c) => blockMd(c, 0)).map((l) => pad + "> " + l);
    case "callout": return (n.content ?? []).flatMap((c) => blockMd(c, 0)).map((l) => pad + "> " + l);
    case "horizontalRule": return [pad + "---"];
    case "bulletList":
    case "orderedList":
    case "taskList": {
      const lines: string[] = [];
      (n.content ?? []).forEach((li, i) => {
        const marker = n.type === "orderedList" ? `${i + 1}. ` : n.type === "taskList" ? (li.attrs?.checked ? "- [x] " : "- [ ] ") : "- ";
        const own = (li.content ?? []).filter((c) => c.type !== "bulletList" && c.type !== "orderedList" && c.type !== "taskList");
        const nested = (li.content ?? []).filter((c) => c.type === "bulletList" || c.type === "orderedList" || c.type === "taskList");
        const ownLines = own.flatMap((c) => blockMd(c, 0));
        lines.push(pad + marker + (ownLines[0] ?? ""));
        for (const extra of ownLines.slice(1)) lines.push(pad + "  " + extra);
        for (const child of nested) lines.push(...blockMd(child, depth + 1));
      });
      return lines;
    }
    case "table": {
      const rows = (n.content ?? []).map((r) => (r.content ?? []).map((c) => inlineMd((c.content ?? []).flatMap((p) => p.content ?? [])).replace(/\|/g, "\\|")));
      if (rows.length === 0) return [];
      const width = Math.max(...rows.map((r) => r.length));
      const line = (r: string[]) => pad + "| " + Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ") + " |";
      return [line(rows[0]!), pad + "|" + Array.from({ length: width }, () => " --- |").join(""), ...rows.slice(1).map(line)];
    }
    default: return [pad + inlineMd(n.content)];
  }
}

export function docToMarkdown(doc: Doc, opts: { title?: string; includeTitle?: boolean } = {}): string {
  const parts: string[] = [];
  if (opts.includeTitle !== false && opts.title?.trim()) parts.push("# " + opts.title.trim(), "");
  const blocks = (doc.content ?? []).map((n) => blockMd(n, 0).join("\n"));
  parts.push(blocks.join("\n\n"));
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

// ---- doc -> plain text ----------------------------------------------------

function blockText(n: JSONContent, depth: number): string[] {
  const pad = "  ".repeat(depth);
  switch (n.type) {
    case "heading": return [pad + nodePlainText(n).toUpperCase()];
    case "paragraph": return [pad + nodePlainText(n)];
    case "codeBlock": return nodePlainText(n).split("\n").map((l) => pad + l);
    case "blockquote":
    case "callout": return (n.content ?? []).flatMap((c) => blockText(c, 0)).map((l) => pad + "  " + l);
    case "horizontalRule": return [pad + "* * *"];
    case "bulletList":
    case "orderedList":
    case "taskList": {
      const lines: string[] = [];
      (n.content ?? []).forEach((li, i) => {
        const marker = n.type === "orderedList" ? `${i + 1}. ` : n.type === "taskList" ? (li.attrs?.checked ? "[x] " : "[ ] ") : "• ";
        const own = (li.content ?? []).filter((c) => c.type !== "bulletList" && c.type !== "orderedList" && c.type !== "taskList");
        const nested = (li.content ?? []).filter((c) => c.type === "bulletList" || c.type === "orderedList" || c.type === "taskList");
        const ownLines = own.flatMap((c) => blockText(c, 0));
        lines.push(pad + marker + (ownLines[0] ?? ""));
        for (const extra of ownLines.slice(1)) lines.push(pad + "  " + extra);
        for (const child of nested) lines.push(...blockText(child, depth + 1));
      });
      return lines;
    }
    case "table": return (n.content ?? []).map((r) => pad + (r.content ?? []).map((c) => nodePlainText(c).trim()).join("  |  "));
    default: return [pad + nodePlainText(n)];
  }
}

export function docToPlainText(doc: Doc, opts: { title?: string; includeTitle?: boolean } = {}): string {
  const parts: string[] = [];
  if (opts.includeTitle !== false && opts.title?.trim()) parts.push(opts.title.trim(), "");
  parts.push((doc.content ?? []).map((n) => blockText(n, 0).join("\n")).join("\n\n"));
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

// ---- markdown -> doc -------------------------------------------------------

const INLINE = /(\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|==([^=]+)==|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*([^*]+)\*|_([^_]+)_)/;

export function parseInlineMarkdown(text: string): JSONContent[] {
  const out: JSONContent[] = [];
  let rest = text;
  while (rest.length) {
    const m = INLINE.exec(rest);
    if (!m || m.index === undefined) { out.push({ type: "text", text: rest }); break; }
    if (m.index > 0) out.push({ type: "text", text: rest.slice(0, m.index) });
    const push = (t: string, mark: JSONContent["marks"]) => { if (t) out.push({ type: "text", text: t, marks: mark }); };
    if (m[2] !== undefined || m[3] !== undefined) push(m[2] ?? m[3] ?? "", [{ type: "bold" }]);
    else if (m[4] !== undefined) push(m[4], [{ type: "strike" }]);
    else if (m[5] !== undefined) push(m[5], [{ type: "highlight" }]);
    else if (m[6] !== undefined) push(m[6], [{ type: "code" }]);
    else if (m[7] !== undefined) push(m[7], [{ type: "link", attrs: { href: m[8] } }]);
    else push(m[9] ?? m[10] ?? "", [{ type: "italic" }]);
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

const para = (text: string): JSONContent => {
  const content = parseInlineMarkdown(text.trim());
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
};

type ListLine = { indent: number; kind: "bulletList" | "orderedList" | "taskList"; checked?: boolean; text: string };

function listLine(line: string): ListLine | null {
  const m = /^(\s*)([-*+]|\d+[.)])\s+(\[( |x|X)\]\s+)?(.*)$/.exec(line);
  if (!m) return null;
  const indent = Math.floor((m[1] ?? "").replace(/\t/g, "  ").length / 2);
  const ordered = /^\d/.test(m[2]!);
  if (m[3]) return { indent, kind: "taskList", checked: (m[4] ?? " ").toLowerCase() === "x", text: m[5] ?? "" };
  return { indent, kind: ordered ? "orderedList" : "bulletList", text: m[5] ?? "" };
}

function buildList(lines: ListLine[], start: number, indent: number): { node: JSONContent; next: number } {
  const kind = lines[start]!.kind;
  const node: JSONContent = { type: kind, content: [] };
  let i = start;
  while (i < lines.length && lines[i]!.indent >= indent) {
    const l = lines[i]!;
    if (l.indent > indent) {
      // A deeper line with no parent item above it: treat it as this level.
      const last = node.content![node.content!.length - 1];
      const child = buildList(lines, i, l.indent);
      if (last) (last.content ??= []).push(child.node); else node.content!.push(...(child.node.content ?? []));
      i = child.next;
      continue;
    }
    if (l.kind !== kind) break;
    const item: JSONContent = l.kind === "taskList"
      ? { type: "taskItem", attrs: { checked: !!l.checked, taskId: null }, content: [para(l.text)] }
      : { type: "listItem", content: [para(l.text)] };
    node.content!.push(item);
    i++;
  }
  return { node, next: i };
}

/** Block nodes for a piece of Markdown. A title line (# alone at the top) is
 *  kept as a heading; the caller decides whether that is the note's title. */
export function parseMarkdown(text: string): JSONContent[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: JSONContent[] = [];
  let i = 0;
  let paraLines: string[] = [];
  const flushPara = () => { if (paraLines.length) { out.push(para(paraLines.join(" "))); paraLines = []; } };
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { flushPara(); i++; continue; }
    const fence = /^\s*```(\w*)\s*$/.exec(line);
    if (fence) {
      flushPara();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) { code.push(lines[i]!); i++; }
      i++;
      out.push({ type: "codeBlock", attrs: { language: fence[1] || null }, content: code.length ? [{ type: "text", text: code.join("\n") }] : [] });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) { flushPara(); out.push({ type: "heading", attrs: { level: Math.max(1, Math.min(3, heading[1]!.length - 1)) }, content: parseInlineMarkdown(heading[2]!.trim()) }); i++; continue; }
    if (/^\s*([-*_]\s*){3,}$/.test(line)) { flushPara(); out.push({ type: "horizontalRule" }); i++; continue; }
    if (/^\s*>/.test(line)) {
      flushPara();
      const quoted: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) { quoted.push(lines[i]!.replace(/^\s*>\s?/, "")); i++; }
      out.push({ type: "blockquote", content: parseMarkdown(quoted.join("\n")) });
      continue;
    }
    if (listLine(line)) {
      flushPara();
      const items: ListLine[] = [];
      while (i < lines.length && listLine(lines[i]!)) { items.push(listLine(lines[i]!)!); i++; }
      let k = 0;
      while (k < items.length) { const built = buildList(items, k, items[k]!.indent); out.push(built.node); k = built.next; }
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushPara();
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) {
        const cells = lines[i]!.trim().slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      if (rows.length) {
        const width = Math.max(...rows.map((r) => r.length));
        const row = (cells: string[], header: boolean): JSONContent => ({ type: "tableRow", content: Array.from({ length: width }, (_, c) => ({ type: header ? "tableHeader" : "tableCell", content: [para(cells[c] ?? "")] })) });
        out.push({ type: "table", content: [row(rows[0]!, true), ...rows.slice(1).map((r) => row(r, false))] });
      }
      continue;
    }
    paraLines.push(line.trim());
    i++;
  }
  flushPara();
  return out;
}

/** Whether a pasted piece of plain text reads as Markdown worth offering
 *  to format: two or more structural lines, so a stray dash never counts. */
export function looksLikeMarkdown(text: string): boolean {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let hits = 0;
  for (const l of lines) {
    if (/^(#{1,6})\s+\S/.test(l) || listLine(l) || /^\s*```/.test(l) || /^\s*>\s?\S/.test(l) || /^\s*\|.*\|\s*$/.test(l)) hits++;
    if (/\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)/.test(l)) hits++;
  }
  return hits >= 2;
}

/** Plain text as paragraphs, one per line, blank lines dropped. */
export function textToParagraphs(text: string): JSONContent[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [{ type: "paragraph" }];
  return lines.map((l) => ({ type: "paragraph", content: [{ type: "text", text: l }] }));
}
