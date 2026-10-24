import { describe, it, expect } from "vitest";
import { findQuote, verifyField, verifyItem, datesIn, timesIn, moneyIn, looksLikeLabel } from "./verify";
import type { DocText, FieldEnvelope } from "./types";

const TEXT = "GEICO Auto Insurance\nStatement date: October 1, 2026\nAmount due: $1,234.50\nPay by October 24, 2026\nSubtotal $1,100.00\nTax $134.50\nLate fee about $25 may apply";
const doc: DocText = { text: TEXT, pages: [{ page: 1, start: 0, end: TEXT.length }], words: 30, lane: "text-layer", failedPages: [] };
const ctx = { doc, today: new Date(2026, 9, 23) };
const env = (o: Partial<FieldEnvelope>): FieldEnvelope => ({ key: "amount", value: "1234.50", quote: "Amount due: $1,234.50", page: 1, basis: "stated", ...o });

describe("finding a quote", () => {
  it("finds it across line breaks and smart punctuation, and gives the original offsets", () => {
    const at = findQuote(TEXT, "Pay by  October 24,\n 2026")!;
    expect(TEXT.slice(at.start, at.end)).toBe("Pay by October 24, 2026");
  });
  it("is null for words the document does not hold", () => { expect(findQuote(TEXT, "Amount due: $999.00")).toBeNull(); });
});

describe("reading values out of passages", () => {
  it("dates", () => {
    expect(datesIn("Due October 24, 2026").map((d) => d.iso)).toContain("2026-10-24");
    expect(datesIn("by 10/24/2026").map((d) => d.iso)).toContain("2026-10-24");
    expect(datesIn("24 Oct 2026").map((d) => d.iso)).toContain("2026-10-24");
    expect(datesIn("Oct 24").map((d) => d.hasYear)).toEqual([false]);
  });
  it("times and money", () => {
    expect(timesIn("Doors 7:30 PM, tip 6pm")).toEqual(["19:30", "18:00"]);
    expect(moneyIn("Total $1,234.50 and $25")).toEqual([1234.5, 25]);
  });
  it("form labels are not answers", () => { expect(looksLikeLabel("Amount Due")).toBe(true); expect(looksLikeLabel("GEICO")).toBe(false); });
});

describe("a field is believed only when the checks say so", () => {
  it("a stated amount in its quote is solid, with the page and offsets", () => {
    const v = verifyField(env({}), ctx);
    expect(v.tier).toBe("solid");
    expect(v.page).toBe(1);
    expect(TEXT.slice(v.offsets!.start, v.offsets!.end)).toBe("Amount due: $1,234.50");
  });
  it("an invented amount is dropped: its value is not in its quote", () => {
    expect(verifyField(env({ value: "1299.00" }), ctx).tier).toBe("dropped");
  });
  it("a quote that is not in the document drops the field, whatever the value", () => {
    expect(verifyField(env({ quote: "Amount due: $1,299.00", value: "1299.00" }), ctx).tier).toBe("dropped");
  });
  it("LAW 4: an inferred amount or date is dropped, never demoted to a maybe", () => {
    expect(verifyField(env({ basis: "inferred" }), ctx).tier).toBe("dropped");
    expect(verifyField(env({ key: "dueDate", value: "2026-10-24", quote: "Pay by October 24, 2026", basis: "inferred" }), ctx).tier).toBe("dropped");
  });
  it("a date written out is solid; one that is not in its quote is dropped", () => {
    expect(verifyField(env({ key: "dueDate", value: "2026-10-24", quote: "Pay by October 24, 2026" }), ctx).tier).toBe("solid");
    expect(verifyField(env({ key: "dueDate", value: "2026-11-24", quote: "Pay by October 24, 2026" }), ctx).tier).toBe("dropped");
  });
  it("a relative date computed from an unstated anchor is dropped", () => {
    const d2: DocText = { ...doc, text: "Payment due within 30 days of receipt", pages: [{ page: 1, start: 0, end: 37 }] };
    expect(verifyField(env({ key: "dueDate", value: "2026-11-22", quote: "Payment due within 30 days of receipt", basis: "computed" }), { doc: d2, today: ctx.today }).tier).toBe("dropped");
  });
  it("a date with no year in its quote is uncertain, and says so", () => {
    const d2: DocText = { ...doc, text: "Pay by Oct 24", pages: [{ page: 1, start: 0, end: 13 }] };
    const v = verifyField(env({ key: "dueDate", value: "2026-10-24", quote: "Pay by Oct 24" }), { doc: d2, today: ctx.today });
    expect(v.tier).toBe("uncertain");
    expect(v.reasons.join(" ")).toMatch(/year/i);
  });
  it("a hedge in the source is never certainty in the record", () => {
    const v = verifyField(env({ key: "amount", value: "25", quote: "Late fee about $25 may apply" }), ctx);
    expect(v.tier).toBe("uncertain");
    expect(v.reasons.join(" ")).toMatch(/hedges/);
  });
  it("a subtotal read as the total is pulled out of the batch", () => {
    const v = verifyField(env({ value: "1100.00", quote: "Subtotal $1,100.00" }), ctx);
    expect(v.tier).toBe("uncertain");
    expect(v.reasons.join(" ")).toMatch(/subtotal/i);
  });
  it("a form label read as a value is dropped", () => {
    expect(verifyField({ key: "payee", value: "Amount Due", quote: "Amount due: $1,234.50", page: 1, basis: "stated" }, ctx).tier).toBe("dropped");
  });
  it("a computed amount is never solid", () => {
    expect(verifyField(env({ basis: "computed", value: "1234.50" }), ctx).tier).toBe("uncertain");
  });
  it("a word the quote does not hold is uncertain, an inferred one says so", () => {
    expect(verifyField({ key: "payee", value: "GEICO", quote: "GEICO Auto Insurance", page: 1, basis: "stated" }, ctx).tier).toBe("solid");
    expect(verifyField({ key: "payee", value: "Progressive", quote: "GEICO Auto Insurance", page: 1, basis: "stated" }, ctx).tier).toBe("uncertain");
    expect(verifyField({ key: "payee", value: "GEICO", quote: "GEICO Auto Insurance", page: 1, basis: "inferred" }, ctx).tier).toBe("uncertain");
  });
  it("the page comes from the document, not from the model's word", () => {
    const multi: DocText = { ...doc, pages: [{ page: 1, start: 0, end: 40 }, { page: 2, start: 40, end: TEXT.length }] };
    expect(verifyField(env({ page: 1 }), { doc: multi, today: ctx.today }).page).toBe(2);
  });
  it("a date more than two years away is uncertain", () => {
    const d2: DocText = { ...doc, text: "Due March 3, 2031", pages: [{ page: 1, start: 0, end: 17 }] };
    expect(verifyField(env({ key: "dueDate", value: "2031-03-03", quote: "Due March 3, 2031" }), { doc: d2, today: ctx.today }).tier).toBe("uncertain");
  });
});

describe("arithmetic pulls a wrong total out of the batch", () => {
  const lines = (a: string, b: string): FieldEnvelope[] => [
    env({}),
    { key: "lineAmount", value: a, quote: "Subtotal $1,100.00", page: 1, basis: "stated" },
    { key: "lineAmount", value: b, quote: b === "134.50" ? "Tax $134.50" : "Subtotal $1,100.00", page: 1, basis: "stated" },
  ];
  it("lines that add up leave the total solid", () => {
    const it2 = verifyItem("bill", lines("1100.00", "134.50"), ctx);
    expect(it2.fields.find((f) => f.key === "amount")!.tier).toBe("solid");
  });
  it("lines that do not add up make the total uncertain, with the reason", () => {
    const it2 = verifyItem("bill", lines("1100.00", "1100.00"), ctx);
    const total = it2.fields.find((f) => f.key === "amount")!;
    expect(total.tier).toBe("uncertain");
    expect(total.reasons.join(" ")).toMatch(/add to 2200\.00/);
  });
});
