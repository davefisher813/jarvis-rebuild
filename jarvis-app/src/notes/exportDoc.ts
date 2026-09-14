// EXPORT A NOTE AS A REAL FILE (the writing system, wave 2, 2026-09-14).
//
// Four formats, each a genuine file of its kind: PDF and Word are built on
// device by jspdf and docx (both loaded only when an export asks for them,
// so the note screen pays nothing for them), Markdown and text by the
// serialisers in markdown.ts. Nothing here renames a text file with a
// different extension.
//
// What each format can and cannot carry is stated on the sheet, not
// discovered afterwards: PDF keeps accented Latin text and embeds photos, but
// its built-in fonts have no other scripts and no emoji; Word keeps every
// character and embeds photos; Markdown and text keep every character and
// list attachments by name.

import type { JSONContent } from "@tiptap/core";
import { docToMarkdown, docToPlainText } from "./markdown";
import { nodePlainText } from "./docModel";

export type ExportFormat = "pdf" | "docx" | "md" | "txt";

export const EXPORT_FORMATS: { key: ExportFormat; label: string; desc: string; ext: string; mime: string }[] = [
  { key: "pdf", label: "PDF", desc: "Read or print", ext: "pdf", mime: "application/pdf" },
  { key: "docx", label: "Word .docx", desc: "Edit in Word or Google Docs", ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  { key: "md", label: "Markdown .md", desc: "Use in Claude or another notes app", ext: "md", mime: "text/markdown;charset=utf-8" },
  { key: "txt", label: "Text .txt", desc: "Simple text that opens almost anywhere", ext: "txt", mime: "text/plain;charset=utf-8" },
];

export function formatInfo(key: ExportFormat) {
  return EXPORT_FORMATS.find((f) => f.key === key) ?? EXPORT_FORMATS[0]!;
}

/** A filename the OS will take: the title with the characters no file
 *  system allows removed, whitespace collapsed, at most 80 characters, and
 *  the extension for the format. Never empty. */
export function safeFilename(title: string, ext: string): string {
  const stem = (title || "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/, "")
    .slice(0, 80)
    .trim();
  return (stem || "Note") + "." + ext;
}

/** The stem of a filename the person typed, cleaned the same way. */
export function cleanStem(stem: string): string {
  return safeFilename(stem, "x").slice(0, -2);
}

const LAST_KEY = "jarvis.notes.export.v1";
export function readLastFormat(): ExportFormat {
  try {
    const v = localStorage.getItem(LAST_KEY);
    return v === "pdf" || v === "docx" || v === "md" || v === "txt" ? v : "pdf";
  } catch { return "pdf"; }
}
export function writeLastFormat(f: ExportFormat): void {
  try { localStorage.setItem(LAST_KEY, f); } catch { /* private mode */ }
}

export interface ExportImage { name: string; bytes: ArrayBuffer; mime: string; width?: number; height?: number }
export interface ExportInput {
  doc: JSONContent;
  title: string;
  includeTitle: boolean;
  /** Photos with their bytes, for the formats that embed them. */
  images: ExportImage[];
  /** Names of attachments that could not be embedded (files, or photos
   *  whose bytes could not be read), listed by name at the end. */
  attachmentNames: string[];
}

export async function buildExport(format: ExportFormat, input: ExportInput): Promise<Blob> {
  const info = formatInfo(format);
  if (format === "md") return new Blob([docToMarkdown(input.doc, { title: input.title, includeTitle: input.includeTitle }) + attachmentsText(input)], { type: info.mime });
  if (format === "txt") return new Blob([docToPlainText(input.doc, { title: input.title, includeTitle: input.includeTitle }) + attachmentsText(input)], { type: info.mime });
  if (format === "pdf") return buildPdf(input);
  return buildDocx(input);
}

function attachmentsText(input: ExportInput): string {
  const names = [...input.images.map((i) => i.name), ...input.attachmentNames];
  if (names.length === 0) return "";
  return "\nAttachments: " + names.join(", ") + "\n";
}

// ---- the rows a paged format walks ------------------------------------------

type Run = { text: string; bold?: boolean; italic?: boolean; strike?: boolean; code?: boolean; href?: string };
type Line = { kind: "title" | "h1" | "h2" | "h3" | "p" | "li" | "quote" | "code" | "rule" | "cell"; runs: Run[]; indent: number; marker?: string; keepWithNext?: boolean };

function runsOf(nodes: JSONContent[] | undefined): Run[] {
  const out: Run[] = [];
  for (const n of nodes ?? []) {
    if (n.type === "hardBreak") { out.push({ text: "\n" }); continue; }
    if (n.type !== "text") { out.push(...runsOf(n.content)); continue; }
    const marks = new Map((n.marks ?? []).map((m) => [m.type, m.attrs ?? {}] as const));
    out.push({
      text: n.text ?? "",
      ...(marks.has("bold") ? { bold: true } : {}),
      ...(marks.has("italic") ? { italic: true } : {}),
      ...(marks.has("strike") ? { strike: true } : {}),
      ...(marks.has("code") ? { code: true } : {}),
      ...(typeof marks.get("link")?.href === "string" ? { href: marks.get("link")!.href as string } : {}),
    });
  }
  return out;
}

function linesOf(doc: JSONContent, title: string, includeTitle: boolean): Line[] {
  const out: Line[] = [];
  if (includeTitle && title.trim()) out.push({ kind: "title", runs: [{ text: title.trim() }], indent: 0, keepWithNext: true });
  const walk = (n: JSONContent, indent: number) => {
    switch (n.type) {
      case "heading": {
        const level = (n.attrs?.level as number) ?? 1;
        out.push({ kind: level <= 1 ? "h1" : level === 2 ? "h2" : "h3", runs: runsOf(n.content), indent, keepWithNext: true });
        break;
      }
      case "paragraph": out.push({ kind: "p", runs: runsOf(n.content), indent }); break;
      case "codeBlock": for (const l of nodePlainText(n).split("\n")) out.push({ kind: "code", runs: [{ text: l, code: true }], indent }); break;
      case "blockquote":
      case "callout": for (const c of n.content ?? []) out.push({ kind: "quote", runs: runsOf(c.content), indent }); break;
      case "horizontalRule": out.push({ kind: "rule", runs: [], indent }); break;
      case "bulletList":
      case "orderedList":
      case "taskList":
        (n.content ?? []).forEach((li, i) => {
          const marker = n.type === "orderedList" ? `${i + 1}.` : n.type === "taskList" ? (li.attrs?.checked ? "[x]" : "[ ]") : "•";
          const own = (li.content ?? []).filter((c) => c.type !== "bulletList" && c.type !== "orderedList" && c.type !== "taskList");
          own.forEach((c, j) => out.push({ kind: "li", runs: runsOf(c.content), indent, marker: j === 0 ? marker : "" }));
          if (own.length === 0) out.push({ kind: "li", runs: [], indent, marker });
          for (const c of li.content ?? []) if (c.type === "bulletList" || c.type === "orderedList" || c.type === "taskList") walk(c, indent + 1);
        });
        break;
      case "table":
        for (const r of n.content ?? []) out.push({ kind: "cell", runs: [{ text: (r.content ?? []).map((c) => nodePlainText(c).trim()).join("  |  ") }], indent });
        break;
      default: out.push({ kind: "p", runs: runsOf(n.content), indent });
    }
  };
  for (const n of doc.content ?? []) walk(n, 0);
  return out;
}

// ---- PDF -------------------------------------------------------------------

async function buildPdf(input: ExportInput): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const M = 56;
  const width = W - 2 * M;
  let y = M;
  const sizeOf: Record<Line["kind"], number> = { title: 22, h1: 17, h2: 15, h3: 13, p: 11, li: 11, quote: 11, code: 9.5, rule: 11, cell: 10.5 };
  const lead = (s: number) => s * 1.4;
  const ensure = (h: number) => { if (y + h > H - M) { pdf.addPage(); y = M; } };
  const lines = linesOf(input.doc, input.title, input.includeTitle);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const size = sizeOf[l.kind];
    const indent = l.indent * 18 + (l.kind === "li" ? 18 : l.kind === "quote" ? 14 : 0);
    if (l.kind === "rule") {
      ensure(lead(size));
      pdf.setDrawColor(170);
      pdf.line(M, y + 4, W - M, y + 4);
      y += lead(size);
      continue;
    }
    const bold = l.kind === "title" || l.kind === "h1" || l.kind === "h2" || l.kind === "h3" || l.runs.every((r) => r.bold && r.text.trim());
    const italic = l.kind === "quote" || l.runs.every((r) => r.italic && r.text.trim());
    pdf.setFont(l.kind === "code" ? "courier" : "helvetica", bold && italic ? "bolditalic" : bold ? "bold" : italic ? "italic" : "normal");
    pdf.setFontSize(size);
    pdf.setTextColor(l.kind === "quote" ? 90 : 20);
    const text = l.runs.map((r) => r.text).join("").replace(/\n/g, " ") || " ";
    const wrapped = pdf.splitTextToSize(text, width - indent) as string[];
    // A heading stays with what follows it: if the heading and one line of
    // the next block do not fit, the page turns first.
    const nextLead = l.keepWithNext ? lead(sizeOf[lines[i + 1]?.kind ?? "p"]) + 6 : 0;
    ensure(lead(size) * wrapped.length + nextLead);
    if (l.kind === "title" || l.kind === "h1" || l.kind === "h2") y += 6;
    if (l.kind === "quote") { pdf.setDrawColor(200); pdf.line(M + 4, y - size, M + 4, y + lead(size) * (wrapped.length - 1) + 4); }
    for (const w of wrapped) {
      ensure(lead(size));
      if (l.marker !== undefined && w === wrapped[0]) { pdf.text(l.marker, M + l.indent * 18, y); }
      pdf.text(w, M + indent, y);
      const links = l.runs.filter((r) => r.href);
      if (links.length && w === wrapped[0]) {
        for (const r of links) pdf.link(M + indent, y - size, Math.min(width - indent, pdf.getTextWidth(w)), size + 2, { url: r.href! });
      }
      y += lead(size);
    }
    y += l.kind === "li" || l.kind === "code" ? 2 : 6;
  }
  for (const img of input.images) {
    try {
      const props = pdf.getImageProperties(new Uint8Array(img.bytes));
      const scale = Math.min(1, width / props.width, 420 / props.height);
      const w = props.width * scale;
      const h = props.height * scale;
      ensure(h + 24);
      pdf.addImage(new Uint8Array(img.bytes), props.fileType, M, y, w, h);
      y += h + 6;
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(9.5); pdf.setTextColor(90);
      pdf.text(img.name, M, y); y += 18;
    } catch {
      input.attachmentNames.push(img.name);
    }
  }
  if (input.attachmentNames.length) {
    ensure(30);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(9.5); pdf.setTextColor(90);
    for (const w of pdf.splitTextToSize("Attachments not included: " + input.attachmentNames.join(", "), width) as string[]) { ensure(14); pdf.text(w, M, y); y += 14; }
  }
  return pdf.output("blob");
}

// ---- Word ------------------------------------------------------------------

async function buildDocx(input: ExportInput): Promise<Blob> {
  const docx = await import("docx");
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, ExternalHyperlink, ImageRun, AlignmentType } = docx;
  const children: InstanceType<typeof Paragraph>[] = [];
  const runsToDocx = (runs: Run[], base: { size?: number; font?: string; color?: string } = {}) => runs.flatMap((r) => {
    const parts = r.text.split("\n");
    return parts.map((t, i) => {
      const run = new TextRun({ text: t, bold: !!r.bold, italics: !!r.italic, strike: !!r.strike, font: r.code ? "Courier New" : base.font ?? "Arial", size: base.size, color: base.color, break: i > 0 ? 1 : undefined });
      return r.href ? new ExternalHyperlink({ children: [new TextRun({ text: t, style: "Hyperlink", font: base.font ?? "Arial", size: base.size })], link: r.href }) : run;
    });
  });
  const lines = linesOf(input.doc, input.title, input.includeTitle);
  for (const l of lines) {
    if (l.kind === "rule") { children.push(new Paragraph({ text: "", border: { bottom: { color: "AAAAAA", space: 1, style: "single", size: 6 } } })); continue; }
    if (l.kind === "title") { children.push(new Paragraph({ children: runsToDocx(l.runs, { size: 44 }), heading: HeadingLevel.TITLE })); continue; }
    if (l.kind === "h1" || l.kind === "h2" || l.kind === "h3") {
      const heading = l.kind === "h1" ? HeadingLevel.HEADING_1 : l.kind === "h2" ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
      children.push(new Paragraph({ children: runsToDocx(l.runs), heading, keepNext: true }));
      continue;
    }
    if (l.kind === "li") {
      const runs = l.marker && l.marker !== "•" ? [{ text: l.marker + " " }, ...l.runs] : l.runs;
      children.push(new Paragraph({ children: runsToDocx(runs, { size: 22 }), bullet: l.marker === "•" || l.marker === "" ? { level: Math.min(8, l.indent) } : undefined, indent: l.marker === "•" || l.marker === "" ? undefined : { left: 720 * (l.indent + 1), hanging: 360 } }));
      continue;
    }
    if (l.kind === "quote") { children.push(new Paragraph({ children: runsToDocx(l.runs, { size: 22, color: "555555" }), indent: { left: 720 }, border: { left: { color: "AAAAAA", space: 8, style: "single", size: 12 } } })); continue; }
    if (l.kind === "code") { children.push(new Paragraph({ children: runsToDocx(l.runs, { size: 19, font: "Courier New" }) })); continue; }
    if (l.kind === "cell") { children.push(new Paragraph({ children: runsToDocx(l.runs, { size: 21 }) })); continue; }
    children.push(new Paragraph({ children: runsToDocx(l.runs, { size: 22 }), spacing: { after: 160 } }));
  }
  for (const img of input.images) {
    const kind = img.mime.includes("png") ? "png" : img.mime.includes("gif") ? "gif" : img.mime.includes("bmp") ? "bmp" : "jpg";
    const w = img.width && img.height ? Math.min(500, img.width) : 400;
    const h = img.width && img.height ? Math.round((w / img.width) * img.height) : 300;
    try {
      children.push(new Paragraph({ children: [new ImageRun({ type: kind, data: img.bytes, transformation: { width: w, height: h } })], alignment: AlignmentType.LEFT }));
      children.push(new Paragraph({ children: [new TextRun({ text: img.name, size: 18, color: "555555", font: "Arial" })] }));
    } catch {
      input.attachmentNames.push(img.name);
    }
  }
  if (input.attachmentNames.length) children.push(new Paragraph({ children: [new TextRun({ text: "Attachments not included: " + input.attachmentNames.join(", "), size: 18, color: "555555", font: "Arial" })] }));
  const document = new Document({
    styles: { default: { document: { run: { font: "Arial", size: 22 } } } },
    sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children }],
  });
  return Packer.toBlob(document);
}
