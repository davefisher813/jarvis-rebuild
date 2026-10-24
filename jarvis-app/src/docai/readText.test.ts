import { describe, it, expect } from "vitest";
import { readPdfText, thinTextLayer, assembleDocText, MAX_PAGES } from "./readText";
import { makePdf, makeScanPdf } from "./testPdf";
import { findQuote, pageAt } from "./verify";

describe("Lane 1: the text layer, no AI", () => {
  it("reads a born-digital PDF page by page and finds a quote's page by code", async () => {
    const bytes = makePdf([["GEICO Auto Insurance", "Policy statement for the six month period", "Amount due: $1,234.50", "Please remit payment to the address below"], ["Pay by October 24, 2026", "Questions about your bill? Call the number on the back of your card"]]);
    const read = await readPdfText(bytes);
    expect(read.totalPages).toBe(2);
    expect(read.failedPages).toEqual([]);
    const doc = assembleDocText(read.pages, "text-layer");
    expect(doc.text).toContain("Amount due: $1,234.50");
    const at = findQuote(doc.text, "Pay by October 24, 2026")!;
    expect(pageAt(doc, at.start)).toBe(2);
    expect(thinTextLayer(read.pages, read.totalPages)).toBe(false);
  });
  it("a scan has no text layer and is routed away, not read as empty fact", async () => {
    const read = await readPdfText(makeScanPdf(2));
    expect(thinTextLayer(read.pages, read.totalPages)).toBe(true);
  });
  it("leaves the caller's bytes whole", async () => {
    const bytes = makePdf([["Hello there, this is a page with words on it"]]);
    const before = bytes.byteLength;
    await readPdfText(bytes);
    expect(bytes.byteLength).toBe(before);
  });
  it("a file that is not a PDF throws PARSER, plainly", async () => {
    await expect(readPdfText(new TextEncoder().encode("not a pdf at all"))).rejects.toThrow("PARSER");
  });
  it("a document past the page cap names the pages it did not attempt", async () => {
    const read = await readPdfText(makePdf(Array.from({ length: MAX_PAGES + 2 }, (_, i) => ["Page " + (i + 1) + " has some words in it for the test"])));
    expect(read.skippedPages).toEqual([MAX_PAGES + 1, MAX_PAGES + 2]);
  }, 60000);
});
