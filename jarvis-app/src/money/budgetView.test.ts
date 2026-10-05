import { describe, it, expect } from "vitest";
import { allocationsFromRows, discrepancyLines, displayRows, monthActuals, monthSpend, newRow, previousBudget, rowsForNewMonth, rowsFromAllocations, seedRows } from "./budgetView";
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

describe("a row named Uncategorized in the form", () => {
  it("stays as an empty stub while it holds a typed limit, and is hidden when it holds none", () => {
    const month = "2026-09";
    const withLimit = [newRow("Uncategorized", "50")];
    const stub = displayRows(withLimit, monthActuals(month, withLimit, [], [])).filter((r) => r.key);
    expect(stub).toHaveLength(1);
    expect([stub[0]!.limit, stub[0]!.spent]).toEqual([null, 0]);
    const none = [newRow("Uncategorized")];
    expect(displayRows(none, monthActuals(month, none, [], [])).filter((r) => r.key)).toHaveLength(0);
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

// DAVE 2026-10-03: the Dashboard counts what the Budget counts, and a new
// month opens with the last budget's limits.
describe("monthSpend: the Dashboard's Out and categories are the budget's own sum", () => {
  const month = "2026-09";
  it("adds a standalone receipt to Out and to its category", () => {
    const s = monthSpend(month, [tx("t1", "Cafe", 1000, "2026-09-02", "Dining")], [rc("r1", "Hardware", 2500, "2026-09-05", { category: "Home" })]);
    expect(s.spent).toBe(3500);
    expect(s.cats).toEqual([["Home", 2500], ["Dining", 1000]]);
  });
  it("counts a receipt linked to a payment once, at the payment", () => {
    const s = monthSpend(month, [tx("t1", "Stop & Shop", 4712, "2026-09-08", "Groceries", { matchedReceiptId: "r1" })], [rc("r1", "Stop & Shop", 4712, "2026-09-08", { category: "Groceries", linkedTransactionId: "t1" })]);
    expect(s.spent).toBe(4712);
    expect(s.cats).toEqual([["Groceries", 4712]]);
  });
  it("a receipt linked to a payment in another month is not counted again here", () => {
    const s = monthSpend("2026-10", [tx("t1", "Cafe", 900, "2026-09-30", "Dining", { matchedReceiptId: "r1" })], [rc("r1", "Cafe", 900, "2026-10-01", { category: "Dining", linkedTransactionId: "t1" })]);
    expect(s.spent).toBe(0);
  });
  it("is the same number the budget shows", () => {
    const txs = [tx("t1", "Cafe", 1000, "2026-09-02", "Dining")];
    const receipts = [rc("r1", "Hardware", 2500, "2026-09-05")];
    expect(monthSpend(month, txs, receipts).spent).toBe(monthActuals(month, [], txs, receipts).totalSpent);
  });
  it("income and other months are not spend, and an empty month is empty", () => {
    expect(monthSpend(month, [tx("t1", "Pay", -90000, "2026-09-01", "Income"), tx("t2", "Cafe", 700, "2026-08-31", "Dining")], []).spent).toBe(0);
    expect(monthSpend(month, [], [])).toEqual({ spent: 0, cats: [] });
  });
});

describe("a new month opens with the last budget's limits", () => {
  const b = (month: string, allocations: Record<string, number>) => ({ id: "b" + month, data: { month, expectedIncomeCents: 500000, savingsTargetCents: 100000, allocations } });
  it("copies the latest earlier budget's names and limits, and says where from", () => {
    const n = rowsForNewMonth([b("2026-08", { Golf: 10000 }), b("2026-09", { Golf: 20000, Dining: 45050 })], "2026-10");
    expect(n.from).toBe("2026-09");
    expect(n.rows.map((r) => [r.name, r.limit])).toEqual([["Golf", "200.00"], ["Dining", "450.50"]]);
  });
  it("skips over a month with no budget, and never copies a later or the same month", () => {
    expect(rowsForNewMonth([b("2026-08", { Golf: 10000 })], "2026-10").from).toBe("2026-08");
    expect(previousBudget([b("2026-11", { Golf: 1 }), b("2026-10", { Golf: 2 })], "2026-10")).toBeUndefined();
  });
  it("with nothing earlier, the nine proposed names with blank limits", () => {
    const n = rowsForNewMonth([], "2026-10");
    expect(n.from).toBeUndefined();
    expect(n.rows.map((r) => r.name)).toEqual([...DEFAULT_BUDGET_CATEGORIES]);
    expect(n.rows.every((r) => r.limit === "")).toBe(true);
  });
  it("an earlier budget with no limits lends nothing", () => {
    expect(rowsForNewMonth([b("2026-09", {})], "2026-10").from).toBeUndefined();
  });
  it("the copy does not carry income or the savings target", () => {
    expect(rowsForNewMonth([b("2026-09", { Golf: 20000 })], "2026-10").rows).toHaveLength(1);
  });
});
