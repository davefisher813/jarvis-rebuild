import { jsPDF } from "jspdf";

/** A real PDF with a text layer, one string per page, for tests (never shipped: only tests import this). */
export function makePdf(pages: string[][]): Uint8Array {
  const doc = new jsPDF();
  pages.forEach((lines, i) => {
    if (i > 0) doc.addPage();
    lines.forEach((l, j) => doc.text(l, 15, 20 + j * 8));
  });
  return new Uint8Array(doc.output("arraybuffer"));
}

/** A PDF page that holds only a drawn rectangle: no text layer, like a scan. */
export function makeScanPdf(pageCount = 1): Uint8Array {
  const doc = new jsPDF();
  for (let i = 0; i < pageCount; i++) { if (i > 0) doc.addPage(); doc.rect(20, 20, 100, 100, "F"); }
  return new Uint8Array(doc.output("arraybuffer"));
}
