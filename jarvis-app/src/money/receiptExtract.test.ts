import { describe, it, expect } from "vitest";
import { parseReceiptExtract } from "./receiptExtract";
import { paidThisMonth } from "./bills";
import type { TaskItem } from "../tasks/TasksService";

// UP-CORE-13 (2026-09-05): the Privacy Policy already promised this
// ("documents you upload for extraction are processed to create the records
// you review") and a receipt was a picture and nothing else. Nothing here
// writes anything: it reads, and a person confirms.
describe("parseReceiptExtract", () => {
  it("reads the vendor, the total and the date", () => {
    const r = parseReceiptExtract(JSON.stringify({ vendor: "Hardware Store", total: 42.75, date: "2026-09-04", currency: "usd" }))!;
    expect(r).toEqual({ vendor: "Hardware Store", total: 42.75, date: "2026-09-04", currency: "USD" });
  });

  it("refuses a total that is not money, rather than inventing one", () => {
    expect(parseReceiptExtract(JSON.stringify({ vendor: "Shop", total: 0 }))!.total).toBeNull();
    expect(parseReceiptExtract(JSON.stringify({ vendor: "Shop", total: -12 }))!.total).toBeNull();
    expect(parseReceiptExtract(JSON.stringify({ vendor: "Shop", total: 9_000_000 }))!.total).toBeNull();
    // A currency symbol on a string amount is still an amount.
    expect(parseReceiptExtract(JSON.stringify({ vendor: "Shop", total: "$42.75" }))!.total).toBe(42.75);
  });

  it("refuses a date the receipt does not really state", () => {
    expect(parseReceiptExtract(JSON.stringify({ vendor: "Shop", total: 5, date: "2026-02-30" }))!.date).toBeNull();
    expect(parseReceiptExtract(JSON.stringify({ vendor: "Shop", total: 5, date: "last tuesday" }))!.date).toBeNull();
  });

  it("a reply with neither a name nor an amount is a shrug, not a receipt", () => {
    expect(parseReceiptExtract(JSON.stringify({ vendor: "", total: null }))).toBeNull();
    expect(parseReceiptExtract("nope")).toBeNull();
  });
});

// The card Money could not draw: what has gone OUT, from the records the app
// actually holds.
describe("paidThisMonth", () => {
  const bill = (amount: number, lastDone?: string): TaskItem =>
    ({ id: "b" + amount, data: { text: "x", category: "", done: true, bill: { amount }, lastDone } }) as TaskItem;

  it("sums the bills paid inside this month and counts them", () => {
    const out = paidThisMonth([bill(42.75, "2026-09-04"), bill(120, "2026-09-01"), bill(80, "2026-08-31")], "2026-09-06");
    expect(out).toEqual({ total: 162.75, count: 2 });
  });

  it("counts nothing that is not a paid bill", () => {
    const notBill = { id: "t", data: { text: "x", category: "", done: true, lastDone: "2026-09-02" } } as TaskItem;
    const unpaid = { id: "u", data: { text: "x", category: "", done: false, bill: { amount: 50 } } } as TaskItem;
    expect(paidThisMonth([notBill, unpaid], "2026-09-06")).toEqual({ total: 0, count: 0 });
  });
});
