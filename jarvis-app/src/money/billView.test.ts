import { describe, it, expect } from "vitest";
import { billAmount, evidenceLine, historyLines, ledgerBillsOut, ledgerChip, ledgerLine, ledgerPaidThisMonth, ledgerStatusWord, mergedBills, visibleLedgerBills } from "./billView";
import { buildBill, correctBill, markPaid, unmarkPaid } from "./ledger/bill";
import type { Bill, BillData } from "./ledger/types";
import type { TaskItem } from "../tasks/TasksService";

const NOW = () => "2026-10-02T12:00:00.000Z";
const TODAY = "2026-10-03";

function make(over: { vendor?: string; amount?: number; dueDate?: string; autopay?: boolean; currency?: string } = {}): BillData {
  const r = buildBill({ vendor: "ConEdison", amount: 84.12, ...over }, "manual", "user", NOW);
  if (!r.ok) throw new Error(r.errors.join());
  return r.value;
}
const bill = (id: string, data: BillData): Bill => ({ id, data });
const paid = (d: BillData, on = "2026-10-01"): BillData => {
  const r = markPaid(d, { type: "user_confirmed" }, on, "user", NOW);
  if (!r.ok) throw new Error(r.reason);
  return r.next;
};

describe("billAmount", () => {
  it("writes dollars as the app does, and another currency with its code", () => {
    expect(billAmount(make())).toBe("$84.12");
    expect(billAmount(make({ amount: 120 }))).toBe("$120");
    expect(billAmount(make({ amount: 84.12, currency: "EUR" }))).toBe("EUR 84.12");
  });
});

describe("ledgerChip: plain words from the computed status", () => {
  it("overdue wears the late chip (the Colour Key's red), counted from the explicit due date", () => {
    expect(ledgerChip(make({ dueDate: "2026-10-01" }), TODAY)).toEqual({ cls: "u-late", text: "2 Days Late" });
    expect(ledgerChip(make({ dueDate: "2026-10-02" }), TODAY)).toEqual({ cls: "u-late", text: "1 Day Late" });
  });
  it("due within a week wears the warn chip", () => {
    expect(ledgerChip(make({ dueDate: TODAY }), TODAY)).toEqual({ cls: "u-today", text: "Due Today" });
    expect(ledgerChip(make({ dueDate: "2026-10-04" }), TODAY)).toEqual({ cls: "u-today", text: "Due Tomorrow" });
    expect(ledgerChip(make({ dueDate: "2026-10-06" }), TODAY)).toEqual({ cls: "u-today", text: "Due in 3 Days" });
    expect(ledgerChip(make({ dueDate: "2026-10-10" }), TODAY)).toEqual({ cls: "u-today", text: "Due in 7 Days" });
  });
  it("says nothing when a bill is far out, has no due date, or is paid", () => {
    expect(ledgerChip(make({ dueDate: "2026-10-11" }), TODAY)).toBeNull();
    expect(ledgerChip(make(), TODAY)).toBeNull();
    expect(ledgerChip(paid(make({ dueDate: "2026-09-20" })), TODAY)).toBeNull();
  });
  it("a bill with no due date is never late, however old", () => {
    expect(ledgerChip(make(), "2030-01-01")).toBeNull();
  });
  it("an autopay bill that is not late says nothing; a late one is still late (autopay is not evidence)", () => {
    expect(ledgerChip(make({ dueDate: "2026-10-05", autopay: true }), TODAY)).toBeNull();
    expect(ledgerChip(make({ dueDate: "2026-10-01", autopay: true }), TODAY)).toEqual({ cls: "u-late", text: "2 Days Late" });
  });
});

describe("ledgerLine: the one line under the name", () => {
  it("paid says the day, in green's state", () => {
    expect(ledgerLine(paid(make({ dueDate: "2026-10-01" }), "2026-10-06"), TODAY)).toEqual({ text: "Paid Oct 6", state: "paid" });
  });
  it("autopay says Set to Autopay and never paid, until evidence", () => {
    const a = ledgerLine(make({ dueDate: "2026-10-05", autopay: true }), TODAY);
    expect(a.state).toBe("autopay");
    expect(a.text).toBe("Set to Autopay");
    expect(a.text).not.toMatch(/paid/i);
    // even long past its date
    expect(ledgerLine(make({ dueDate: "2026-01-05", autopay: true }), TODAY).text).toBe("Set to Autopay");
    expect(ledgerLine(make({ autopay: true }), TODAY)).toEqual({ text: "Set to Autopay", state: "autopay" });
  });
  it("an unpaid bill gives its date; a bill with no date gives nothing", () => {
    expect(ledgerLine(make({ dueDate: "2026-10-20" }), TODAY)).toEqual({ text: "Due Oct 20", state: "due" });
    expect(ledgerLine(make(), TODAY)).toEqual({ text: "", state: "none" });
  });
  it("a paid bill whose amount was corrected asks to be confirmed again, not claimed", () => {
    const fixed = correctBill(paid(make({ dueDate: "2026-10-01" })), { amount: 90 }, "user", NOW);
    if (!fixed.ok) throw new Error("x");
    expect(ledgerLine(fixed.value.next, TODAY)).toEqual({ text: "Confirm It Is Still Paid", state: "reconfirm" });
    expect(ledgerStatusWord(fixed.value.next, TODAY)).toBe("Confirm It Is Still Paid");
  });
});

describe("ledgerStatusWord", () => {
  it("names every state in plain words", () => {
    expect(ledgerStatusWord(make(), TODAY)).toBe("Unpaid");
    expect(ledgerStatusWord(make({ autopay: true }), TODAY)).toBe("Set to Autopay");
    expect(ledgerStatusWord(make({ dueDate: "2026-10-01" }), TODAY)).toBe("2 Days Late");
    expect(ledgerStatusWord(make({ dueDate: "2026-10-05" }), TODAY)).toBe("Due in 2 Days");
    expect(ledgerStatusWord(paid(make()), TODAY)).toBe("Paid");
  });
});

describe("evidenceLine: who said it was paid", () => {
  it("the person's word", () => {
    expect(evidenceLine(paid(make(), "2026-10-06"))).toBe("You Confirmed It Oct 6");
  });
  it("a matched payment, named by its own day and merchant", () => {
    const r = markPaid(make(), { type: "transaction", transactionId: "t1" }, "2026-10-04", "user", NOW);
    if (!r.ok) throw new Error("x");
    const txs = [{ id: "t1", data: { date: "2026-10-04", merchant: "ConEdison", name: "CONED PMT" } }];
    expect(evidenceLine(r.next, txs)).toBe("Paid by Your Oct 4 ConEdison Payment");
    // the payment row is not loaded yet: still plain, still not invented
    expect(evidenceLine(r.next, [])).toBe("Paid by Your Oct 4 Payment");
  });
  it("a confirmation", () => {
    const r = markPaid(make(), { type: "confirmation", fingerprint: "f" }, "2026-10-04", "user", NOW);
    if (!r.ok) throw new Error("x");
    expect(evidenceLine(r.next)).toBe("Paid by a Confirmation from Oct 4");
  });
  it("is null for a bill that is not paid", () => {
    expect(evidenceLine(make())).toBeNull();
  });
});

describe("historyLines: what changed, when, by whom, from and to", () => {
  it("a missing from or to reads as None, amounts in the bill's currency, dates as days", () => {
    let d = make({ dueDate: "2026-10-05" });
    const c1 = correctBill(d, { amount: 90, dueDate: null, notes: "gas" }, "user", () => "2026-10-03T09:00:00.000Z");
    if (!c1.ok) throw new Error("x");
    d = c1.value.next;
    const lines = historyLines(d.history, d.currency);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ who: "You", what: "Created", changes: [] });
    const fix = lines[1]!;
    expect(fix.what).toBe("Corrected");
    const by = Object.fromEntries(fix.changes.map((c) => [c.label, c]));
    expect(by["Amount"]).toEqual({ label: "Amount", from: "$84.12", to: "$90" });
    expect(by["Due Date"]).toEqual({ label: "Due Date", from: "Oct 5", to: "None" });
    expect(by["Notes"]).toEqual({ label: "Notes", from: "None", to: "gas" });
  });
  it("marked paid and the paid state coming off both show", () => {
    const p = paid(make(), "2026-10-06");
    const u = unmarkPaid(p, "user", NOW);
    const lines = historyLines(u.history, u.currency);
    expect(lines.map((l) => l.what)).toEqual(["Created", "Marked Paid", "Paid State Removed"]);
    const marked = lines[1]!.changes.find((c) => c.label === "Evidence");
    expect(marked).toEqual({ label: "Evidence", from: "None", to: "You Confirmed It" });
    const removed = lines[2]!.changes.find((c) => c.label === "Paid Date");
    expect(removed).toEqual({ label: "Paid Date", from: "Oct 6", to: "None" });
  });
  it("an email-made record says an email made it", () => {
    const r = buildBill({ vendor: "Verizon", amount: 60 }, { type: "email", fingerprint: "x", ref: "th1" }, "email", NOW);
    if (!r.ok) throw new Error("x");
    expect(historyLines(r.value.history, "USD")[0]).toMatchObject({ who: "An Email", what: "Created from an Email" });
  });
  it("tolerates a record with no history", () => {
    expect(historyLines(undefined, "USD")).toEqual([]);
  });
});

describe("the merged list", () => {
  const task = (id: string, text: string, due: string | undefined, amount = 10): TaskItem =>
    ({ id, data: { text, category: "", done: false, ...(due ? { due } : {}), bill: { amount } } }) as TaskItem;

  it("sorts ledger and legacy bills together by due date, no due date last", () => {
    const ledger = [
      bill("L1", make({ vendor: "Water", dueDate: "2026-10-12" })),
      bill("L2", make({ vendor: "Gas" })),
      bill("L3", make({ vendor: "Power", dueDate: "2026-10-05" })),
    ];
    const legacy = [task("T1", "Rent", "2026-10-08"), task("T2", "Gym", undefined)];
    expect(mergedBills(ledger, legacy, TODAY).map((e) => e.id)).toEqual(["L3", "T1", "L1", "L2", "T2"]);
  });
  it("tags each entry by where it lives", () => {
    const m = mergedBills([bill("L1", make({ dueDate: "2026-10-12" }))], [task("T1", "Rent", "2026-10-08")], TODAY);
    expect(m.map((e) => e.kind)).toEqual(["legacy", "ledger"]);
  });
  it("keeps a recently paid ledger bill and drops one paid over thirty days ago", () => {
    const recent = bill("A", paid(make({ vendor: "A", dueDate: "2026-09-20" }), "2026-09-25"));
    const old = bill("B", paid(make({ vendor: "B", dueDate: "2026-08-01" }), "2026-08-05"));
    expect(visibleLedgerBills([recent, old], TODAY).map((b) => b.id)).toEqual(["A"]);
  });
});

describe("totals that feed the Yours number", () => {
  it("ledgerBillsOut: unpaid dollar bills due on or before the day, overdue included", () => {
    const bills = [
      bill("a", make({ amount: 100, dueDate: "2026-10-01" })), // overdue still has to leave
      bill("b", make({ amount: 50, dueDate: "2026-10-09" })),
      bill("c", make({ amount: 25, dueDate: "2026-10-20" })), // after payday
      bill("d", make({ amount: 10 })), // no date: nothing to place before payday
      bill("e", paid(make({ amount: 999, dueDate: "2026-10-02" }))), // paid is not out
      bill("f", make({ amount: 77, dueDate: "2026-10-04", currency: "EUR" })), // not summed into dollars
    ];
    expect(ledgerBillsOut(bills, "2026-10-10", TODAY)).toBe(150);
  });
  it("ledgerPaidThisMonth counts bills the person confirmed in this month", () => {
    const bills = [
      bill("a", paid(make({ amount: 100, dueDate: "2026-10-01" }), "2026-10-02")),
      bill("b", paid(make({ amount: 40, dueDate: "2026-09-01" }), "2026-09-30")),
      bill("c", make({ amount: 5, dueDate: "2026-10-01" })),
    ];
    expect(ledgerPaidThisMonth(bills, TODAY)).toEqual({ total: 100, count: 1 });
  });
});
