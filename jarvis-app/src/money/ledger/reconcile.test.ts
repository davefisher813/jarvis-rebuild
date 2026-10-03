import { describe, it, expect } from "vitest";
import { amountTolerance, amountsMatch, linkBill, linkReceipt, proposeBillMatches, proposeReceiptMatches, unlinkReceipt, type TxLike } from "./reconcile";
import { budgetActuals } from "./actuals";
import { billStatus } from "./status";
import type { BillData, ReceiptData } from "./types";

const NOW = () => "2026-10-02T12:00:00.000Z";
const receipt = (id: string, over: Partial<ReceiptData> = {}): { id: string; data: ReceiptData } => ({
  id,
  data: { vendor: "Stop & Shop", amountCents: 4712, currency: "USD", transactionDate: "2026-09-08", source: "manual", fingerprint: id, history: [], ...over },
});
const tx = (id: string, over: Partial<TxLike["data"]> = {}): TxLike => ({
  id,
  data: { date: "2026-09-08", merchant: "Stop & Shop", amountCents: 4712, category: "Groceries", month: "2026-09", ...over },
});
const bill = (id: string, over: Partial<BillData> = {}): { id: string; data: BillData } => ({
  id,
  data: { vendor: "ConEdison", amountCents: 8412, currency: "USD", dueDate: "2026-09-20", source: "manual", fingerprint: id, history: [], ...over },
});

describe("A4 tolerances: $1.00 or 1%, whichever is larger; 3 days; vendor normalised", () => {
  it("amount tolerance is the larger of $1 and 1%", () => {
    expect(amountTolerance(4712, 4712)).toBe(100);
    expect(amountTolerance(50_000, 50_000)).toBe(500);
    expect(amountsMatch(4712, 4812)).toBe(true);   // exactly $1.00
    expect(amountsMatch(4712, 4813)).toBe(false);  // a cent past
    // 1% is taken of the larger of the two amounts: of $505.05, that is $5.05.
    expect(amountsMatch(50_000, 50_505)).toBe(true);
    expect(amountsMatch(50_000, 50_506)).toBe(false);
  });
});

describe("proposing receipt to transaction matches", () => {
  it("same vendor (normalised), amount within tolerance, date within 3 days", () => {
    const p = proposeReceiptMatches([receipt("r1")], [tx("t1", { merchant: "STOP  SHOP", amountCents: 4750, date: "2026-09-10" })]);
    expect(p).toEqual([{ recordId: "r1", transactionId: "t1", dateGap: 2, amountDiffCents: 38 }]);
  });
  it("misses at the edges: a 4th day, a different vendor, a different currency, money in", () => {
    const r = [receipt("r1")];
    expect(proposeReceiptMatches(r, [tx("t1", { date: "2026-09-12" })])).toEqual([]);
    expect(proposeReceiptMatches(r, [tx("t1", { date: "2026-09-11" })])).toHaveLength(1); // exactly 3
    expect(proposeReceiptMatches(r, [tx("t1", { merchant: "ShopRite" })])).toEqual([]);
    expect(proposeReceiptMatches(r, [tx("t1", { currency: "EUR" })])).toEqual([]);
    expect(proposeReceiptMatches(r, [tx("t1", { amountCents: -4712 })])).toEqual([]);
  });
  it("never re-proposes what is already linked, on either side", () => {
    expect(proposeReceiptMatches([receipt("r1", { linkedTransactionId: "t9" })], [tx("t1")])).toEqual([]);
    expect(proposeReceiptMatches([receipt("r1")], [tx("t1", { matchedReceiptId: "r9" })])).toEqual([]);
  });
  it("ranks the closest amount, then the closest date, first", () => {
    const p = proposeReceiptMatches([receipt("r1")], [tx("far", { date: "2026-09-10" }), tx("exact"), tx("off", { amountCents: 4750 })]);
    expect(p.map((x) => x.transactionId)).toEqual(["exact", "far", "off"]);
  });
});

describe("a link is not a merge (acceptance 4)", () => {
  it("links both sides, keeps both records, writes history on both", () => {
    const r = receipt("r1");
    const t = tx("t1");
    const res = linkReceipt("r1", r.data, t, NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.receipt.linkedTransactionId).toBe("t1");
    expect(res.receipt.amountCents).toBe(4712);          // nothing merged
    expect(res.txPatch.matchedReceiptId).toBe("r1");
    expect(res.receipt.history.at(-1)).toMatchObject({ action: "matched to a transaction", by: "user" });
    expect(res.txPatch.history.at(-1)).toMatchObject({ action: "matched to a receipt" });
  });
  it("a stale approval is refused, not double-linked", () => {
    expect(linkReceipt("r1", receipt("r1", { linkedTransactionId: "x" }).data, tx("t1"), NOW)).toEqual({ ok: false, reason: "already_linked" });
    expect(linkReceipt("r1", receipt("r1").data, tx("t1", { matchedReceiptId: "r2" }), NOW)).toEqual({ ok: false, reason: "already_linked" });
    expect(linkReceipt("r1", receipt("r1").data, tx("t1", { amountCents: -5 }), NOW)).toEqual({ ok: false, reason: "not_a_payment" });
  });
  it("unlinking clears both sides", () => {
    const linked = receipt("r1", { linkedTransactionId: "t1" }).data;
    const res = unlinkReceipt(linked, tx("t1", { matchedReceiptId: "r1" }), NOW);
    expect(res.receipt.linkedTransactionId).toBeUndefined();
    expect(res.txPatch).toMatchObject({ matchedReceiptId: null });
  });
});

describe("a bill matched to a payment (spec 5)", () => {
  it("proposes only unpaid bills with an explicit due date", () => {
    const t = tx("t1", { merchant: "ConEdison", amountCents: 8412, date: "2026-09-21" });
    expect(proposeBillMatches([bill("b1")], [t])).toHaveLength(1);
    expect(proposeBillMatches([bill("b1", { dueDate: undefined })], [t])).toEqual([]);   // no date to match, none invented
    expect(proposeBillMatches([bill("b1", { paidAt: "2026-09-21", paidEvidence: { type: "user_confirmed" } })], [t])).toEqual([]);
    expect(proposeBillMatches([bill("b1")], [tx("t2", { merchant: "ConEdison", amountCents: 8412, date: "2026-09-25" })])).toEqual([]);
    expect(proposeBillMatches([bill("b1")], [{ ...t, data: { ...t.data, paysBillId: "b9" } }])).toEqual([]);
  });
  it("approving makes the bill paid with the transaction as evidence and its own date", () => {
    const t = tx("t1", { merchant: "ConEdison", amountCents: 8412, date: "2026-09-21" });
    const res = linkBill("b1", bill("b1").data, t, NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.bill.paidEvidence).toEqual({ type: "transaction", transactionId: "t1" });
    expect(res.bill.paidAt).toBe("2026-09-21");
    expect(billStatus(res.bill, "2026-10-02")).toBe("paid");
    expect(res.txPatch.paysBillId).toBe("b1");
    expect(linkBill("b1", bill("b1").data, { ...t, data: { ...t.data, paysBillId: "b9" } }, NOW)).toEqual({ ok: false, reason: "already_linked" });
  });
});

describe("budget actuals count the pair once (acceptance 4 and 8)", () => {
  const allocations = { Groceries: 50_000, Dining: 20_000 };
  it("a linked receipt and its transaction are one expense, at the transaction's amount", () => {
    const a = budgetActuals({
      month: "2026-09", allocations,
      txs: [tx("t1", { amountCents: 4712, matchedReceiptId: "r1" })],
      receipts: [receipt("r1", { linkedTransactionId: "t1", category: "Groceries" })],
    });
    expect(a.rows.find((r) => r.name === "Groceries")!.spent).toBe(4712);
    expect(a.totalSpent).toBe(4712);
    expect(a.discrepancies).toEqual([]);
  });
  it("a standalone receipt counts; linking it later does not make it count twice", () => {
    const standalone = budgetActuals({ month: "2026-09", allocations, txs: [], receipts: [receipt("r1", { category: "Groceries" })] });
    expect(standalone.totalSpent).toBe(4712);
    const linked = budgetActuals({
      month: "2026-09", allocations,
      txs: [tx("t1", { matchedReceiptId: "r1" })],
      receipts: [receipt("r1", { category: "Groceries", linkedTransactionId: "t1" })],
    });
    expect(linked.totalSpent).toBe(4712);
  });
  it("amounts that differ beyond tolerance are surfaced, not silently picked", () => {
    const a = budgetActuals({
      month: "2026-09", allocations,
      txs: [tx("t1", { amountCents: 6000, matchedReceiptId: "r1" })],
      receipts: [receipt("r1", { amountCents: 4712, linkedTransactionId: "t1" })],
    });
    expect(a.totalSpent).toBe(6000);                     // the transaction's amount
    expect(a.discrepancies).toEqual([{ receiptId: "r1", transactionId: "t1", receiptCents: 4712, transactionCents: 6000 }]);
  });
  it("a link to a deleted transaction is dead: the receipt stands alone again", () => {
    const a = budgetActuals({ month: "2026-09", allocations, txs: [], receipts: [receipt("r1", { linkedTransactionId: "gone", category: "Dining" })] });
    expect(a.rows.find((r) => r.name === "Dining")!.spent).toBe(4712);
  });
  it("Uncategorized is always visible, last, and counted", () => {
    const a = budgetActuals({
      month: "2026-09", allocations,
      txs: [tx("t1", { category: "" , amountCents: 1000 }), tx("t2", { category: "Groceries", amountCents: 2000 })],
      receipts: [receipt("r1", { category: undefined, amountCents: 500, transactionDate: "2026-09-12" })],
    });
    expect(a.rows.at(-1)).toMatchObject({ name: "Uncategorized", spent: 1500, limit: null });
    expect(a.totalSpent).toBe(3500);
    const empty = budgetActuals({ month: "2026-09", allocations, txs: [], receipts: [] });
    expect(empty.rows.at(-1)!.name).toBe("Uncategorized");
  });
  it("is the deterministic sum of the month: other months and money in are out", () => {
    const a = budgetActuals({
      month: "2026-09", allocations,
      txs: [
        tx("t1", { amountCents: 1000 }),
        tx("t2", { amountCents: 2500, date: "2026-10-01", month: "2026-10" }),
        tx("t3", { amountCents: -90000, category: "Income" }),
        tx("t4", { amountCents: -500 }),
      ],
      receipts: [receipt("r1", { transactionDate: "2026-08-31" }), receipt("r2", { transactionDate: "2026-09-30", amountCents: 700, category: "Dining" })],
    });
    expect(a.totalSpent).toBe(1700);
  });
  it("states limit, spent, remaining and how far over, plainly; no limit shows no remaining", () => {
    const a = budgetActuals({
      month: "2026-09", allocations: { Dining: 10_000 },
      txs: [tx("t1", { category: "Dining", amountCents: 14_000 }), tx("t2", { category: "Golf", amountCents: 3000 })],
      receipts: [],
    });
    expect(a.rows.find((r) => r.name === "Dining")).toEqual({ name: "Dining", limit: 10_000, spent: 14_000, remaining: 0, overBy: 4000 });
    expect(a.rows.find((r) => r.name === "Golf")).toEqual({ name: "Golf", limit: null, spent: 3000, remaining: null, overBy: 0 });
  });
});
