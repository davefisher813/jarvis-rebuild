import { describe, it, expect } from "vitest";
import { billsLine, dueBills, payTarget } from "./todayData";
import { buildBill, markPaid } from "../money/ledger/bill";
import type { Bill, BillData } from "../money/ledger/types";
import type { TaskItem } from "../tasks/TasksService";

// LEDGER BILLS ON TODAY'S BILL CARD (Money ledger, lane B). A ledger bill is
// not a task, so this card is the only door it has onto Today. It follows the
// rule legacy bills have always had (due within three days) and adds the half
// a legacy bill gets from being a task: past its explicit due date, in red.

const T = "2026-10-03";
const NOW = () => "2026-10-02T12:00:00.000Z";
function data(over: { vendor?: string; amount?: number; dueDate?: string; autopay?: boolean }): BillData {
  const r = buildBill({ vendor: "ConEdison", amount: 84.12, ...over }, "manual", "user", NOW);
  if (!r.ok) throw new Error(r.errors.join());
  return r.value;
}
const bill = (id: string, over: Parameters<typeof data>[0]): Bill => ({ id, data: data(over) });
const paidBill = (id: string, over: Parameters<typeof data>[0]): Bill => {
  const r = markPaid(data(over), { type: "user_confirmed" }, "2026-10-01", "user", NOW);
  if (!r.ok) throw new Error(r.reason);
  return { id, data: r.next };
};
const legacy = (id: string, text: string, due: string, amount: number, autopay = false): TaskItem =>
  ({ id, data: { text, category: "", done: false, due, bill: { amount, ...(autopay ? { autopay: true } : {}) } } }) as TaskItem;

describe("dueBills: what the card speaks for", () => {
  it("includes a ledger bill due within three days and one already overdue, soonest first", () => {
    const out = dueBills([], T, [
      bill("c", { vendor: "Water", dueDate: "2026-10-06" }),
      bill("a", { vendor: "Power", dueDate: "2026-10-01" }),
      bill("b", { vendor: "Gas", dueDate: "2026-10-04" }),
    ]);
    expect(out.map((b) => [b.name, b.late])).toEqual([["Power", 2], ["Gas", 0], ["Water", 0]]);
  });
  it("leaves out a bill far off, a paid one, and one with no due date (never due, never late)", () => {
    const out = dueBills([], T, [
      bill("far", { dueDate: "2026-10-20" }),
      paidBill("paid", { dueDate: "2026-10-01" }),
      bill("nodate", {}),
    ]);
    expect(out).toEqual([]);
  });
  it("legacy bill tasks come through as they always did, beside the ledger's", () => {
    const out = dueBills([legacy("t1", "Pay Rent", "2026-10-04", 1850)], T, [bill("l1", { vendor: "Power", dueDate: "2026-10-03" })]);
    expect(out.map((b) => [b.kind, b.name])).toEqual([["ledger", "Power"], ["task", "Rent"]]);
  });
});

describe("billsLine with ledger bills", () => {
  it("one overdue ledger bill: its amount and a red days-late fact", () => {
    expect(billsLine([], T, [bill("a", { vendor: "ConEdison", dueDate: "2026-10-01" })])).toEqual({
      title: "ConEdison",
      amount: "$84.12",
      due: { text: "2 Days Late", tone: "red" },
    });
  });
  it("one bill due tomorrow reads like a legacy bill, in the warn tone", () => {
    expect(billsLine([], T, [bill("a", { vendor: "ConEdison", dueDate: "2026-10-04" })])).toEqual({
      title: "ConEdison", amount: "$84.12", due: { text: "Due Tomorrow", tone: "warn" },
    });
  });
  it("says nothing for a ledger bill with no due date, however many there are", () => {
    expect(billsLine([], T, [bill("a", {}), bill("b", { vendor: "Gas" })])).toBeNull();
  });
  it("several bills: a count that is honest about lateness, and their names", () => {
    const soon = billsLine([], T, [bill("a", { vendor: "Power", dueDate: "2026-10-04" }), bill("b", { vendor: "Gas", dueDate: "2026-10-05" })]);
    expect(soon).toEqual({ title: "2 Bills Due Soon", sub: "Power, Gas" });
    const mixed = billsLine([], T, [bill("a", { vendor: "Power", dueDate: "2026-10-01" }), bill("b", { vendor: "Gas", dueDate: "2026-10-05" })]);
    expect(mixed?.title).toBe("2 Bills Due or Late");
    const late = billsLine([], T, [bill("a", { vendor: "Power", dueDate: "2026-10-01" }), bill("b", { vendor: "Gas", dueDate: "2026-09-30" })]);
    expect(late?.title).toBe("2 Bills Late");
  });
  it("is the legacy card, byte for byte, when there are no ledger bills", () => {
    const t = [legacy("t1", "Pay Rent", "2026-10-04", 1850)];
    expect(billsLine(t, T, [])).toEqual(billsLine(t, T));
    expect(billsLine(t, T)).toEqual({ title: "Rent", amount: "$1850", due: { text: "Due Tomorrow", tone: "warn" } });
  });
});

describe("payTarget: what the card's Paid button may act on", () => {
  it("with no ledger bill on the card, exactly the legacy answer", () => {
    expect(payTarget([legacy("t1", "Pay Rent", "2026-10-04", 1850)], T, [])).toEqual({ kind: "task", task: expect.objectContaining({ id: "t1" }) });
    expect(payTarget([legacy("t1", "Pay Rent", "2026-10-04", 1850, true)], T, [])).toBeNull();
  });
  it("one ledger bill is payable, and it is the bill itself that comes back", () => {
    const b = bill("a", { dueDate: "2026-10-01" });
    expect(payTarget([], T, [b])).toEqual({ kind: "ledger", bill: b });
  });
  it("autopay is never offered a Paid button, even when late", () => {
    expect(payTarget([], T, [bill("a", { dueDate: "2026-10-01", autopay: true })])).toBeNull();
  });
  it("several bills on the card: no button, because it would have to guess which", () => {
    expect(payTarget([], T, [bill("a", { vendor: "Power", dueDate: "2026-10-01" }), bill("b", { vendor: "Gas", dueDate: "2026-10-04" })])).toBeNull();
    expect(payTarget([legacy("t1", "Pay Rent", "2026-10-04", 1850)], T, [bill("a", { dueDate: "2026-10-01" })])).toBeNull();
  });
});
