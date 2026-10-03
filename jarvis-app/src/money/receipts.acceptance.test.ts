import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { LedgerService } from "./ledger/LedgerService";
import { TrackerService } from "./TrackerService";
import { monthActuals } from "./budgetView";
import { removeTxWithLinks, unmatchTx } from "./txLinks";
import { billStatus } from "./ledger/status";
import { newRow } from "./budgetView";

// THE LEDGER'S ACCEPTANCE FOR RECEIPTS, BY HAND, NO AI (Money ledger, 2026-10-03).
// A receipt and the payment it belongs to are one expense, and one purchase
// entered twice is one record.

const NOW = () => "2026-10-03T12:00:00.000Z";
const TODAY = "2026-10-03";
function setup() {
  const store = new Store(new InMemoryAdapter());
  return { ledger: new LedgerService(store, "u", () => {}, NOW), tracker: new TrackerService(store, "u", () => {}, NOW) };
}
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error("expected ok: " + JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
};
const pay = { date: "2026-09-08", month: "2026-09", merchant: "Stop & Shop", name: "STOP & SHOP #123", amountCents: 4712, category: "Groceries", account: "CHK" };

describe("a receipt and its payment are counted once", () => {
  it("propose, approve, and the budget counts the pair at the payment's amount, exactly once", async () => {
    const { ledger, tracker } = setup();
    const txId = (await tracker.saveTx(null, pay))!;
    const r = ok(await ledger.addReceipt({ vendor: "Stop & Shop", amount: "47.12", transactionDate: "2026-09-08", category: "Groceries" }, "manual", TODAY));
    const rows = [newRow("Groceries", "200")];

    // a proposal, never a link on its own
    expect(await ledger.receiptMatches()).toHaveLength(1);
    expect((await ledger.getReceipt(r.id))!.data.linkedTransactionId).toBeUndefined();

    ok(await ledger.approveReceiptMatch(r.id, txId));
    const actuals = monthActuals("2026-09", rows, await ledger.listTxs(), await ledger.listReceipts());
    expect(actuals.totalSpent).toBe(4712);
    expect(actuals.rows.find((x) => x.name === "Groceries")).toMatchObject({ spent: 4712, remaining: 20000 - 4712 });
    expect(actuals.discrepancies).toEqual([]);
    // both records still exist: a link is not a merge
    expect(await ledger.listReceipts()).toHaveLength(1);
    expect(await ledger.listTxs()).toHaveLength(1);
    // and nothing left to propose
    expect(await ledger.receiptMatches()).toEqual([]);
  });

  it("an exact duplicate receipt submitted twice is one record", async () => {
    const { ledger } = setup();
    const a = ok(await ledger.addReceipt({ vendor: "Stop & Shop", amount: "47.12", transactionDate: "2026-09-08" }, "manual", TODAY));
    const b = ok(await ledger.addReceipt({ vendor: "STOP  & SHOP!", amount: 47.12, transactionDate: "2026-09-08" }, "camera", TODAY));
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect(b.id).toBe(a.id);
    expect(await ledger.listReceipts()).toHaveLength(1);
    // another day is another purchase
    const c = ok(await ledger.addReceipt({ vendor: "Stop & Shop", amount: "47.12", transactionDate: "2026-09-09" }, "manual", TODAY));
    expect(c.duplicate).toBe(false);
    expect(await ledger.listReceipts()).toHaveLength(2);
  });

  it("the date defaults to today and is never guessed from anything else", async () => {
    const { ledger } = setup();
    const r = ok(await ledger.addReceipt({ vendor: "Cafe", amount: "5" }, "manual", TODAY));
    expect((await ledger.getReceipt(r.id))!.data.transactionDate).toBe(TODAY);
    expect((await ledger.getReceipt(r.id))!.data.currency).toBe("USD");
  });
});

describe("a payment's links stay honest when it moves", () => {
  it("deleting a matched payment unmatches its receipt, and Undo links them again", async () => {
    const { ledger, tracker } = setup();
    const txId = (await tracker.saveTx(null, pay))!;
    const r = ok(await ledger.addReceipt({ vendor: "Stop & Shop", amount: "47.12", transactionDate: "2026-09-08" }, "manual", TODAY));
    ok(await ledger.approveReceiptMatch(r.id, txId));
    const tx = (await ledger.listTxs())[0]!;

    const undo = await removeTxWithLinks(tracker, ledger, tx);
    expect(await ledger.listTxs()).toHaveLength(0);
    // the receipt is free and counts on its own; no dead link stays behind
    expect((await ledger.getReceipt(r.id))!.data.linkedTransactionId).toBeUndefined();

    await undo();
    const back = (await ledger.listTxs())[0]!;
    expect(back.id).toBe(txId);
    expect(back.data.matchedReceiptId).toBe(r.id);
    expect((await ledger.getReceipt(r.id))!.data.linkedTransactionId).toBe(txId);
    expect(monthActuals("2026-09", [], await ledger.listTxs(), await ledger.listReceipts()).totalSpent).toBe(4712);
  });

  it("deleting the payment that evidenced a bill puts the bill back to unpaid, and Undo pays it again", async () => {
    const { ledger, tracker } = setup();
    const txId = (await tracker.saveTx(null, { ...pay, merchant: "ConEdison", name: "CONED", amountCents: 8412, category: "Utilities", date: "2026-10-04", month: "2026-10" }))!;
    const b = ok(await ledger.addBill({ vendor: "ConEdison", amount: "84.12", dueDate: "2026-10-05" }));
    ok(await ledger.approveBillMatch(b.id, txId));
    expect(billStatus((await ledger.getBill(b.id))!.data, "2026-10-06")).toBe("paid");

    const undo = await removeTxWithLinks(tracker, ledger, (await ledger.listTxs())[0]!);
    // paid is never claimed without evidence: the evidence is gone
    expect(billStatus((await ledger.getBill(b.id))!.data, "2026-10-06")).toBe("overdue");

    await undo();
    expect(billStatus((await ledger.getBill(b.id))!.data, "2026-10-06")).toBe("paid");
    expect((await ledger.listTxs())[0]!.data.paysBillId).toBe(b.id);
  });

  it("Unmatch from the payment's side frees the receipt, with an Undo", async () => {
    const { ledger, tracker } = setup();
    const txId = (await tracker.saveTx(null, pay))!;
    const r = ok(await ledger.addReceipt({ vendor: "Stop & Shop", amount: "47.12", transactionDate: "2026-09-08" }, "manual", TODAY));
    ok(await ledger.approveReceiptMatch(r.id, txId));
    const change = await unmatchTx(ledger, (await ledger.listTxs())[0]!, "receipt");
    expect(change!.said).toBe("Unmatched");
    expect((await ledger.listTxs())[0]!.data.matchedReceiptId).toBeUndefined();
    expect((await ledger.getReceipt(r.id))!.data.history.map((h) => h.action)).toEqual(["created", "matched to a transaction", "unmatched"]);
    await change!.undo();
    expect((await ledger.getReceipt(r.id))!.data.linkedTransactionId).toBe(txId);
    // asking for a link the payment does not hold changes nothing
    expect(await unmatchTx(ledger, (await ledger.listTxs())[0]!, "bill")).toBeNull();
  });
});
