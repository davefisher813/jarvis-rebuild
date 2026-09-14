// EXPORT A NOTE AS A REAL FILE (the writing system, wave 2): every format is
// a genuine file of its kind, and the filename is one the OS will take.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { buildExport, safeFilename, cleanStem, readLastFormat, writeLastFormat, EXPORT_FORMATS } from "./exportDoc";
import { blocksToDoc } from "./docModel";

const DOC = blocksToDoc([
  { id: "h", type: "heading", text: "Agenda" },
  { id: "t", type: "text", text: "Went with **option B** and a café." },
  { id: "c", type: "checklist", items: [{ text: "Renew lease", done: false }, { text: "Talk pricing", done: true }] },
  { id: "l", type: "bulleted_list", items: ["Milk", "Eggs"] },
  { id: "tb", type: "table", columns: ["Item", "Cost"], rows: [["Rent", "1200"]] },
]);
const input = (over: Partial<Parameters<typeof buildExport>[1]> = {}) => ({ doc: DOC, title: "Convo with Berto", includeTitle: true, images: [], attachmentNames: [], ...over });

function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.readAsArrayBuffer(blob);
  });
}
function textOf(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => resolve(String(r.result));
    r.readAsText(blob);
  });
}

describe("filenames", () => {
  it("come from the title, safe for any file system, never empty, with the right extension", () => {
    expect(safeFilename("Convo with Berto", "pdf")).toBe("Convo with Berto.pdf");
    expect(safeFilename("  Q3: plan / budget? <draft>  ", "md")).toBe("Q3 plan budget draft.md");
    expect(safeFilename("", "txt")).toBe("Note.txt");
    expect(safeFilename("x".repeat(200), "docx").length).toBe(85);
    expect(cleanStem("a/b")).toBe("ab");
  });

  it("remembers the last format that worked, and defaults to PDF", () => {
    localStorage.removeItem("jarvis.notes.export.v1");
    expect(readLastFormat()).toBe("pdf");
    writeLastFormat("md");
    expect(readLastFormat()).toBe("md");
    expect(EXPORT_FORMATS.map((f) => f.key)).toEqual(["pdf", "docx", "md", "txt"]);
  });
});

describe("the four files", () => {
  beforeEach(() => { localStorage.clear(); });

  it("Markdown and text carry the title once and the attachment names", async () => {
    const md = await textOf(await buildExport("md", input({ attachmentNames: ["lease.pdf"] })));
    expect(md.startsWith("# Convo with Berto\n\n## Agenda")).toBe(true);
    expect(md.match(/Convo with Berto/g)!.length).toBe(1);
    expect(md).toContain("Attachments: lease.pdf");
    const txt = await textOf(await buildExport("txt", input({ includeTitle: false })));
    expect(txt.startsWith("AGENDA")).toBe(true);
    expect(txt).toContain("[x] Talk pricing");
  });

  it("PDF is a PDF: the header bytes, the mime, and the words inside", async () => {
    const blob = await buildExport("pdf", input());
    expect(blob.type).toBe("application/pdf");
    const bytes = await bytesOf(blob);
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(800);
  }, 20000);

  it("Word is a Word file: a zip with the document part inside", async () => {
    const blob = await buildExport("docx", input({ attachmentNames: ["lease.pdf"] }));
    expect(blob.type).toContain("wordprocessingml");
    const bytes = await bytesOf(blob);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text).toContain("word/document.xml");
  }, 20000);
});
