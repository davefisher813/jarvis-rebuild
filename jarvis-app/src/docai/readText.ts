import type { DocText } from "./types";

// READING IS NOT AN AI CALL (Dave's law 3, ruled 2026-10-06). Getting the words out of a file works at AI level Off. This is Lane 1:
// the text layer of a born-digital PDF, read with unpdf (the serverless PDF.js build; classic pdf-parse breaks on Vercel). A page
// that yields almost nothing is a scan or a photo, and the caller routes it to the AI read (Lane 2) instead. A page that cannot be
// read is NAMED, never dropped: a partial read says which pages are missing.

/** Fewer characters than this on a page, on average, and the text layer is not what the document is made of. */
export const THIN_CHARS_PER_PAGE = 80;
/** A document read in the worker is capped: a dense 100 page file is a budget decision, not something to chew through. */
export const MAX_PAGES = 100;

export interface PageText { page: number; text: string }

export interface PdfRead {
  pages: PageText[];
  /** Pages that threw. Named in the result, never skipped silently. */
  failedPages: number[];
  /** Pages beyond MAX_PAGES that were not attempted. */
  skippedPages: number[];
  totalPages: number;
  encrypted: boolean;
}

/** Reads a PDF's text layer page by page. Never throws for a bad page; throws only for a file that is not a readable PDF at all. */
export async function readPdfText(bytes: Uint8Array): Promise<PdfRead> {
  const { getDocumentProxy } = await import("unpdf");
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // unpdf transfers the buffer to its worker; hand it a copy so the caller's bytes stay whole.
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch (e) {
    const name = (e as { name?: string })?.name ?? "";
    if (name === "PasswordException") return { pages: [], failedPages: [], skippedPages: [], totalPages: 0, encrypted: true };
    throw new Error("PARSER");
  }
  const total = pdf.numPages;
  const pages: PageText[] = [];
  const failed: number[] = [];
  const skipped: number[] = [];
  for (let n = 1; n <= total; n++) {
    if (n > MAX_PAGES) { skipped.push(n); continue; }
    try {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      let out = "";
      let lastY: number | null = null;
      for (const item of content.items as { str?: string; transform?: number[]; hasEOL?: boolean }[]) {
        if (typeof item.str !== "string") continue;
        const y = item.transform?.[5] ?? null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 && out && !out.endsWith("\n")) out += "\n";
        out += item.str;
        if (item.hasEOL) out += "\n";
        lastY = y;
      }
      pages.push({ page: n, text: out.replace(/[ \t]+\n/g, "\n").trim() });
    } catch {
      failed.push(n);
    }
  }
  return { pages, failedPages: failed, skippedPages: skipped, totalPages: total, encrypted: false };
}

/** The words in a text. */
export const wordCount = (text: string): number => (text.match(/\S+/g) ?? []).length;

/** True when the text layer is too thin to be the document (a scan, a photo saved as PDF). */
export function thinTextLayer(pages: PageText[], totalPages: number): boolean {
  if (totalPages <= 0) return true;
  const chars = pages.reduce((t, p) => t + p.text.replace(/\s/g, "").length, 0);
  return chars / totalPages < THIN_CHARS_PER_PAGE * 0.5;
}

/** Joins pages into one text with a page map, so a quote finds its page by code. A page break is a form feed the quote matcher treats as space. */
export function assembleDocText(pages: PageText[], lane: DocText["lane"], failedPages: number[] = []): DocText {
  let text = "";
  const map: DocText["pages"] = [];
  for (const p of pages) {
    const start = text.length;
    text += p.text;
    map.push({ page: p.page, start, end: text.length });
    text += "\n\f\n";
  }
  return { text, pages: map, words: wordCount(text), lane, failedPages };
}
