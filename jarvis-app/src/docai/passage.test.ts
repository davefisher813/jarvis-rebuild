import { describe, expect, it } from "vitest";
import { passageFor } from "./passage";
import { assembleDocText } from "./readText";

const doc = assembleDocText([
  { page: 1, text: "GEICO Auto Insurance\nAccount ZX-991\nAmount due: $1,234.50\nPay by October 24, 2026" },
  { page: 2, text: "Remit to PO Box 9\nThank you for your business" },
], "text-layer");

describe("the passage a field came from", () => {
  it("marks the quote and keeps the words around it", () => {
    const p = passageFor(doc, "Amount due: $1,234.50", null);
    expect(p.located).toBe(true);
    expect(p.mark).toBe("Amount due: $1,234.50");
    expect(p.before).toContain("Account ZX-991");
    expect(p.after).toContain("Pay by October 24, 2026");
    expect(p.page).toBe(1);
  });
  it("finds the page by the document, so a quote on page two says two", () => {
    expect(passageFor(doc, "Thank you for your business", null).page).toBe(2);
  });
  it("uses the offsets when it has them", () => {
    const at = doc.text.indexOf("GEICO");
    const p = passageFor(doc, "GEICO Auto Insurance", { start: at, end: at + 20 });
    expect(p.mark).toBe("GEICO Auto Insurance");
    expect(p.cutBefore).toBe(false);
  });
  it("a value Dave typed that is not in the document shows only the quote, and says it was not located", () => {
    const p = passageFor(doc, "something he wrote", null);
    expect(p).toMatchObject({ located: false, mark: "something he wrote", before: "", after: "", page: null });
  });
  it("says when it is cut", () => {
    const long = assembleDocText([{ page: 1, text: "x ".repeat(400) + "NEEDLE" + " y".repeat(400) }], "text-layer");
    const p = passageFor(long, "NEEDLE", null);
    expect(p.cutBefore && p.cutAfter).toBe(true);
    expect(p.mark).toBe("NEEDLE");
  });
});
