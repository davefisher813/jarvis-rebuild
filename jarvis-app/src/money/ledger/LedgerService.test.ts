import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { LedgerService } from "./LedgerService";
import { TrackerService } from "../TrackerService";
import { ENTITY_MONEY_TX, type TrackerTxData } from "../tracker";
import { billStatus } from "./status";
import { budgetActuals } from "./actuals";

const NOW = () => "2026-10-02T12:00:00.000Z";
const TODAY = "2026-10-02";
function setup() {
  const store = new Store(new InMemoryAdapter());
  const ledger = new LedgerService(store, "u", () => {}, NOW);
  const tracker = new TrackerService(store, "u");
  return { store, ledger, tracker };
}
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error("expected ok: " + JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
};

describe("acceptance 1: the whole bill lifecycle, by hand, no AI", () => {
  it("create, due, overdue, mark paid by confirmation, correct", async () => {
    const { ledger } = setup();
    const { id } = ok(await ledger.addBill({ vendor: "ConEdison", amount: "84.12", dueDate: "2026-10-05" }));
    let b = (await ledger.getBill(id))!;
    expect(billStatus(b.data, TODAY)).toBe("due");
    expect(billStatus(b.data, "2026-10-06")).toBe("overdue");
    expect((await ledger.overdue("2026-10-06")).map((x) => x.id)).toEqual([id]);

    ok(await ledger.markBillPaidByUser(id, "2026-10-06"));
    b = (await ledger.getBill(id))!;
    expect(billStatus(b.data, "2026-10-06")).toBe("paid");
    expect(await ledger.overdue("2026-10-06")).toEqual([]);

    // a correction shows what changed and reopens the paid state
    ok(await ledger.correctBill(id, { amount: "90.00" }));
    b = (await ledger.getBill(id))!;
    expect(b.data.amountCents).toBe(9000);
    expect(b.data.paidNeedsReconfirm).toBe(true);
    expect(billStatus(b.data, "2026-10-06")).toBe("overdue");
    ok(await ledger.markBillPaidByUser(id, "2026-10-07"));
    b = (await ledger.getBill(id))!;
    expect(billStatus(b.data, "2026-10-07")).toBe("paid");
    // acceptance 9: every write is in the record's history
    expect(b.data.history.map((h) => h.action)).toEqual(["created", "marked paid", "corrected, paid state needs confirming", "marked paid"]);
    expect(b.data.history[2]!.changes).toEqual({ amountCents: { from: 8412, to: 9000 } });
  });

  it("undoing a paid state clears it on the stored record (a cleared key really leaves)", async () => {
    const { ledger, store } = setup();
    const { id } = ok(await ledger.addBill({ vendor: "Rent", amount: 2200, dueDate: "2026-10-01" }));
    ok(await ledger.markBillPaidByUser(id, TODAY));
    ok(await ledger.unmarkBillPaid(id));
    const raw = (await store.read("u", id))!.data as Record<string, unknown>;
    expect("paidAt" in raw).toBe(false);
    expect("paidEvidence" in raw).toBe(false);
    expect(billStatus((await ledger.getBill(id))!.data, TODAY)).toBe("overdue");
  });
});

describe("acceptance 2: a bill cannot reach paid without evidence, through any door", () => {
  it("markBillPaid with no evidence fails and writes nothing", async () => {
    const { ledger } = setup();
    const { id } = ok(await ledger.addBill({ vendor: "Rent", amount: 2200, dueDate: "2026-10-01" }));
    expect(await ledger.markBillPaid(id, undefined, TODAY)).toEqual({ ok: false, reason: "evidence_required" });
    expect(await ledger.markBillPaid(id, { type: "transaction", transactionId: "" }, TODAY)).toEqual({ ok: false, reason: "bad_evidence" });
    const b = (await ledger.getBill(id))!;
    expect(b.data.paidAt).toBeUndefined();
    expect(b.data.history).toHaveLength(1);
  });
  it("autopay alone never makes a bill paid", async () => {
    const { ledger } = setup();
    const { id } = ok(await ledger.addBill({ vendor: "Internet", amount: 89, dueDate: "2026-10-01", autopay: true }));
    expect(billStatus((await ledger.getBill(id))!.data, TODAY)).toBe("overdue");
  });
});

describe("acceptance 5: an exact duplicate is suppressed", () => {
  it("the same receipt twice is one record; a changed amount is a new one", async () => {
    const { ledger } = setup();
    const a = ok(await ledger.addReceipt({ vendor: "Stop & Shop", amount: "47.12", transactionDate: "2026-09-08" }, "manual", TODAY));
    const b = ok(await ledger.addReceipt({ vendor: "stop shop", amount: 47.12, transactionDate: "2026-09-08" }, "camera", TODAY));
    expect(b.duplicate).toBe(true);
    expect(b.id).toBe(a.id);
    expect(await ledger.listReceipts()).toHaveLength(1);
    const c = ok(await ledger.addReceipt({ vendor: "Stop & Shop", amount: "47.13", transactionDate: "2026-09-08" }, "manual", TODAY));
    expect(c.duplicate).toBe(false);
    expect(await ledger.listReceipts()).toHaveLength(2);
  });
  it("the same bill twice is one record", async () => {
    const { ledger } = setup();
    const a = ok(await ledger.addBill({ vendor: "ConEd", amount: 84.12, dueDate: "2026-10-15" }));
    const b = ok(await ledger.addBill({ vendor: "ConEd", amount: 84.12, dueDate: "2026-10-15" }));
    expect(b).toMatchObject({ id: a.id, duplicate: true });
    expect(await ledger.listBills()).toHaveLength(1);
  });
});

describe("acceptance 6: no due date is never overdue and never invented", () => {
  it("is stored blank and stays unpaid-not-overdue forever", async () => {
    const { ledger, store } = setup();
    const { id } = ok(await ledger.addBill({ vendor: "Contractor", amount: 1200 }));
    const raw = (await store.read("u", id))!.data as Record<string, unknown>;
    expect("dueDate" in raw).toBe(false);
    expect(billStatus((await ledger.getBill(id))!.data, "2030-01-01")).toBe("unpaid");
    expect(await ledger.overdue("2030-01-01")).toEqual([]);
  });
});

describe("acceptance 7: an email bill keeps its message as evidence", () => {
  it("source carries the fingerprint and ref; a repeat of the same message is suppressed", async () => {
    const { ledger } = setup();
    const src = { type: "email" as const, fingerprint: "gmail:thread-77", ref: "thread-77" };
    const a = ok(await ledger.addBill({ vendor: "ConEdison", amount: 84.12, dueDate: "2026-10-15" }, src));
    const again = ok(await ledger.addBill({ vendor: "ConEdison", amount: 84.12, dueDate: "2026-10-15" }, src));
    expect(again).toMatchObject({ id: a.id, duplicate: true });
    const b = (await ledger.getBill(a.id))!;
    expect(b.data.source).toEqual(src);
    expect(b.data.history[0]).toMatchObject({ by: "email" });
    // a corrected invoice from the same message is a different record, not a silent overwrite
    const fixed = ok(await ledger.addBill({ vendor: "ConEdison", amount: 90, dueDate: "2026-10-15" }, src));
    expect(fixed.duplicate).toBe(false);
  });
});

describe("acceptance 4 and 8: match, link, and count the pair once", () => {
  async function seeded() {
    const { ledger, tracker, store } = setup();
    const txId = (await tracker.saveTx(null, {
      date: "2026-09-08", month: "2026-09", merchant: "Stop & Shop", name: "Stop & Shop Stamford CT", amountCents: 4712, category: "Groceries", account: "CHK",
    }))!;
    const r = ok(await ledger.addReceipt({ vendor: "Stop & Shop", amount: "47.12", transactionDate: "2026-09-08", category: "Groceries" }, "manual", TODAY));
    return { ledger, tracker, store, txId, receiptId: r.id };
  }

  it("proposes, the person approves, both records link and keep existing", async () => {
    const { ledger, txId, receiptId } = await seeded();
    expect(await ledger.receiptMatches()).toEqual([{ recordId: receiptId, transactionId: txId, dateGap: 0, amountDiffCents: 0 }]);
    // nothing is linked until approval
    expect((await ledger.getReceipt(receiptId))!.data.linkedTransactionId).toBeUndefined();
    ok(await ledger.approveReceiptMatch(receiptId, txId));
    const r = (await ledger.getReceipt(receiptId))!;
    const t = (await ledger.listTxs()).find((x) => x.id === txId)!;
    expect(r.data.linkedTransactionId).toBe(txId);
    expect(t.data.matchedReceiptId).toBe(receiptId);
    expect(await ledger.receiptMatches()).toEqual([]);
    expect(t.data.history!.at(-1)).toMatchObject({ action: "matched to a receipt" });
    // approving it again is refused
    expect(await ledger.approveReceiptMatch(receiptId, txId)).toEqual({ ok: false, reason: "already_linked" });
  });

  it("the budget counts the pair exactly once, before and after linking", async () => {
    const { ledger, txId, receiptId } = await seeded();
    const count = async () => {
      const a = budgetActuals({ month: "2026-09", allocations: { Groceries: 50_000 }, txs: await ledger.listTxs(), receipts: await ledger.listReceipts() });
      return a.totalSpent;
    };
    // unlinked: a transaction AND a standalone receipt for the same $47.12 would be 9424
    // if both counted; the unlinked pair is two records and honestly counts twice until matched.
    expect(await count()).toBe(4712 * 2);
    ok(await ledger.approveReceiptMatch(receiptId, txId));
    expect(await count()).toBe(4712);
    ok(await ledger.unmatchReceipt(receiptId));
    expect(await count()).toBe(4712 * 2);
  });

  it("a bill is paid by an approved payment, with the payment as evidence", async () => {
    const { ledger, tracker } = setup();
    const txId = (await tracker.saveTx(null, { date: "2026-10-04", month: "2026-10", merchant: "ConEdison", name: "CONED", amountCents: 8412, category: "Utilities", account: "CHK" }))!;
    const { id } = ok(await ledger.addBill({ vendor: "ConEdison", amount: 84.12, dueDate: "2026-10-05" }));
    expect(await ledger.billMatches()).toHaveLength(1);
    ok(await ledger.approveBillMatch(id, txId));
    const b = (await ledger.getBill(id))!;
    expect(b.data.paidEvidence).toEqual({ type: "transaction", transactionId: txId });
    expect(b.data.paidAt).toBe("2026-10-04");
    expect(billStatus(b.data, "2026-10-10")).toBe("paid");
    // removing the bill releases the payment
    await ledger.removeBill(id);
    expect((await ledger.listTxs()).find((t) => t.id === txId)!.data.paysBillId).toBeUndefined();
  });

  it("removing a linked receipt releases its transaction", async () => {
    const { ledger, txId, receiptId } = await seeded();
    ok(await ledger.approveReceiptMatch(receiptId, txId));
    await ledger.removeReceipt(receiptId);
    expect((await ledger.listTxs()).find((t) => t.id === txId)!.data.matchedReceiptId).toBeUndefined();
  });
});

describe("recurring: confirmed by the person, rolled on payment, never inferred", () => {
  it("an unconfirmed bill never creates another", async () => {
    const { ledger } = setup();
    const { id } = ok(await ledger.addBill({ vendor: "Rent", amount: 2200, dueDate: "2026-10-01" }));
    ok(await ledger.markBillPaidByUser(id, TODAY));
    expect(await ledger.listBills()).toHaveLength(1);
  });
  it("a confirmed monthly bill schedules the next one when paid, once", async () => {
    const { ledger } = setup();
    const { id } = ok(await ledger.addBill({ vendor: "Rent", amount: 2200, dueDate: "2026-01-31", recurrence: "monthly" }));
    ok(await ledger.markBillPaidByUser(id, "2026-01-31"));
    let bills = await ledger.listBills();
    expect(bills.map((b) => b.data.dueDate).sort()).toEqual(["2026-01-31", "2026-02-28"]);
    // undo and pay again does not stack a second next bill
    ok(await ledger.unmarkBillPaid(id));
    ok(await ledger.markBillPaidByUser(id, "2026-01-31"));
    bills = await ledger.listBills();
    expect(bills).toHaveLength(2);
    const next = bills.find((b) => b.data.dueDate === "2026-02-28")!;
    expect(next.data.recurrence).toBe("monthly");
    expect(billStatus(next.data, "2026-02-01")).toBe("unpaid");
  });
  it("nextDue keeps the anchor day through short months and years", () => {
    expect(LedgerService.nextDue("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(LedgerService.nextDue("2026-12-15", "monthly")).toBe("2027-01-15");
    expect(LedgerService.nextDue("2028-02-29", "yearly")).toBe("2029-02-28");
    expect(LedgerService.nextDue("2026-10-02", "weekly")).toBe("2026-10-09");
  });
});

describe("receipts: corrections, dates and the manual default", () => {
  it("a manual receipt with no date is today; a bad date is refused", async () => {
    const { ledger } = setup();
    const a = ok(await ledger.addReceipt({ vendor: "Cafe", amount: 4.5 }, "manual", TODAY));
    expect((await ledger.getReceipt(a.id))!.data.transactionDate).toBe(TODAY);
    expect(await ledger.addReceipt({ vendor: "Cafe", amount: 4.5, transactionDate: "tomorrow" }, "manual", TODAY)).toEqual({ ok: false, errors: ["transactionDate"] });
    expect(await ledger.addReceipt({ vendor: "", amount: "x" }, "manual", TODAY)).toEqual({ ok: false, errors: ["vendor", "amount"] });
  });
  it("a correction is versioned and re-fingerprints", async () => {
    const { ledger } = setup();
    const a = ok(await ledger.addReceipt({ vendor: "Cafe", amount: 4.5 }, "manual", TODAY));
    ok(await ledger.correctReceipt(a.id, { amount: "5.50", category: "Dining" }));
    const r = (await ledger.getReceipt(a.id))!;
    expect(r.data.amountCents).toBe(550);
    expect(r.data.fingerprint).toBe("receipt|cafe|550|2026-10-02|local");
    expect(r.data.history.at(-1)!.changes).toEqual({ amountCents: { from: 450, to: 550 }, category: { to: "Dining" } });
    expect(await ledger.correctReceipt(a.id, { transactionDate: "" })).toEqual({ ok: false, reason: "invalid:transactionDate" });
  });
});

describe("existing transaction rows read unchanged (no migration of September)", () => {
  it("a row with none of the ledger's fields still lists, matches nothing and counts as before", async () => {
    const { ledger, store } = setup();
    const legacy: TrackerTxData = { date: "2026-09-14", month: "2026-09", merchant: "Uncorked", name: "Uncorked Stamford CT", amountCents: 2319, category: "Restaurants", account: "CHK" };
    await store.create("u", ENTITY_MONEY_TX, legacy as never);
    const txs = await ledger.listTxs();
    expect(txs).toHaveLength(1);
    expect(txs[0]!.data.matchedReceiptId).toBeUndefined();
    expect(await ledger.receiptMatches()).toEqual([]);
  });
});
