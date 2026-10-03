import { describe, it, expect } from "vitest";
import { allocationsFromRows, discrepancyLines, displayRows, monthActuals, newRow, rowsFromAllocations, seedRows } from "./budgetView";
import { DEFAULT_BUDGET_CATEGORIES, type ReceiptData } from "./ledger/types";
import { overLine } from "./ledger/actuals";
import { fmtCents } from "./tracker";

const tx = (id: string, merchant: string, cents: number, date: string, category: string, extra: object = {}) => ({
  id, data: { date, merchant, amountCents: cents, category, ...extra },
});
const rc = (id: string, vendor: string, cents: number, date: string, extra: Partial<ReceiptData> = {}): { id: string; data: ReceiptData } => ({
  id, data: { vendor, amountCents: cents, currency: "USD", transactionDate: date, source: "manual", fingerprint: id, history: [], ...extra },
});

describe("the monthly budget form", () => {
  it("a month with no budget starts from the nine proposed names, limits blank", () => {
    const rows = seedRows();
    expect(rows.map((r) => r.name)).toEqual([...DEFAULT_BUDGET_CATEGORIES]);
    expect(rows).toHaveLength(9);
    expect(rows.every((r) => r.limit === "")).toBe(true);
    // nothing is stored for a blank row
    expect(allocationsFromRows(rows)).toEqual({});
  });

  it("an existing budget's allocations load unchanged and save unchanged", () => {
    const alloc = { Golf: 20000, Restaurants: 45050 };
    const rows = rowsFromAllocations(alloc);
    expect(rows.map((r) => [r.name, r.limit])).toEqual([["Golf", "200.00"], ["Restaurants", "450.50"]]);
    expect(allocationsFromRows(rows)).toEqual(alloc);
  });

  it("rename, add and remove are plain edits to the list", () => {
    const rows = seedRows();
    rows[0]!.name = "Food";
    rows[0]!.limit = "300";
    rows.push(newRow("Pets", "40.00"));
    const kept = rows.filter((r) => r.name !== "Dining");
    expect(allocationsFromRows(kept)).toEqual({ Food: 30000, Pets: 4000 });
  });

  it("leaves out a blank name, a zero limit and Uncategorized", () => {
    expect(allocationsFromRows([newRow("", "50"), newRow("Fun", "0"), newRow("Uncategorized", "10"), newRow("  Kids  ", "12.34")])).toEqual({ Kids: 1234 });
  });
});

describe("what the month shows against the limits", () => {
  const month = "2026-09";
  const rows = [newRow("Groceries", "100"), newRow("Dining", "50"), newRow("Fun")];

  it("per category: limit, spent, remaining, and the plain over line", () => {
    const a = monthActuals(month, rows, [
      tx("t1", "Market", 6000, "2026-09-03", "Groceries"),
      tx("t2", "Cafe", 9000, "2026-09-04", "Dining"),
    ], []);
    const shown = displayRows(rows, a);
    const g = shown.find((r) => r.name === "Groceries")!;
    expect([g.limit, g.spent, g.remaining, g.overBy]).toEqual([10000, 6000, 4000, 0]);
    expect(overLine(g, fmtCents)).toBeNull();
    const d = shown.find((r) => r.name === "Dining")!;
    expect(overLine(d, fmtCents)).toBe("$40.00 over");
    // a category with no limit yet still shows, with its spend
    expect(shown.find((r) => r.name === "Fun")!.limit).toBeNull();
  });

  it("Uncategorized is always the last row, even with nothing in it, and is counted when it has spend", () => {
    const empty = displayRows(rows, monthActuals(month, rows, [], []));
    expect(empty[empty.length - 1]!.name).toBe("Uncategorized");
    expect(empty[empty.length - 1]!.spent).toBe(0);
    const a = monthActuals(month, rows, [tx("t1", "Mystery", 1234, "2026-09-03", "")], [rc("r1", "Stand", 500, "2026-09-05")]);
    const shown = displayRows(rows, a);
    expect(shown[shown.length - 1]).toMatchObject({ name: "Uncategorized", spent: 1734 });
    expect(a.totalSpent).toBe(1734);
  });

  it("a category with spend and no row still shows, before Uncategorized", () => {
    const a = monthActuals(month, rows, [tx("t1", "Range", 2500, "2026-09-03", "Golf")], []);
    const names = displayRows(rows, a).map((r) => r.name);
    expect(names).toEqual(["Groceries", "Dining", "Fun", "Golf", "Uncategorized"]);
  });

  it("other months and money in are not this month's spend", () => {
    const a = monthActuals(month, rows, [
      tx("t1", "Market", 6000, "2026-08-30", "Groceries"),
      tx("t2", "Pay", -500000, "2026-09-01", "Income"),
    ], []);
    expect(a.totalSpent).toBe(0);
  });

  it("a payment and the receipt linked to it are one spend, at the payment's amount", () => {
    const a = monthActuals(month, rows, [tx("t1", "Market", 4712, "2026-09-08", "Groceries", { matchedReceiptId: "r1" })], [
      rc("r1", "Market", 4712, "2026-09-08", { category: "Groceries", linkedTransactionId: "t1" }),
    ]);
    expect(a.totalSpent).toBe(4712);
    expect(displayRows(rows, a).find((r) => r.name === "Groceries")!.spent).toBe(4712);
    expect(a.discrepancies).toEqual([]);
  });

  it("states a discrepancy plainly, and says which amount it counted", () => {
    const receipts = [rc("r1", "Stop & Shop", 4712, "2026-09-08", { linkedTransactionId: "t1" })];
    const a = monthActuals(month, rows, [tx("t1", "Stop & Shop", 6000, "2026-09-08", "Groceries", { matchedReceiptId: "r1" })], receipts);
    const lines = discrepancyLines(a, receipts);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ vendor: "Stop & Shop", says: "Receipt says $47.12, payment says $60.00", counted: "Counting the payment" });
    expect(a.totalSpent).toBe(6000);
  });

  it("within tolerance there is no discrepancy line", () => {
    const receipts = [rc("r1", "Market", 4712, "2026-09-08", { linkedTransactionId: "t1" })];
    const a = monthActuals(month, rows, [tx("t1", "Market", 4750, "2026-09-08", "Groceries", { matchedReceiptId: "r1" })], receipts);
    expect(discrepancyLines(a, receipts)).toEqual([]);
  });
});
