import { describe, it, expect } from "vitest";
import { buildProposals } from "./matchView";
import { pairKey } from "./notMatch";
import type { Bill, Receipt } from "./ledger/types";
import type { TrackerTx } from "./tracker";

const receipt = (id: string, vendor: string, cents: number, date: string): Receipt => ({
  id, data: { vendor, amountCents: cents, currency: "USD", transactionDate: date, source: "manual", fingerprint: id, history: [] },
});
const bill = (id: string, vendor: string, cents: number, dueDate: string): Bill => ({
  id, data: { vendor, amountCents: cents, currency: "USD", dueDate, source: "manual", fingerprint: id, history: [] },
});
const tx = (id: string, merchant: string, cents: number, date: string): TrackerTx => ({
  id, data: { merchant, name: merchant, amountCents: cents, date, month: date.slice(0, 7), category: "Other", account: "" },
});
const prop = (recordId: string, transactionId: string) => ({ recordId, transactionId, dateGap: 0, amountDiffCents: 0 });

describe("a match proposal, said both ways", () => {
  it("names both sides in plain words", () => {
    const [v] = buildProposals({
      receiptProposals: [prop("r1", "t1")], billProposals: [],
      receipts: [receipt("r1", "Stop & Shop", 4712, "2026-09-08")], bills: [], txs: [tx("t1", "STOP & SHOP #123", 4712, "2026-09-08")],
      notMatches: new Set(),
    });
    expect(v!.headline).toBe("Stop & Shop receipt $47.12 looks like your Sep 8 payment");
    expect(v!.record).toEqual({ label: "Receipt", name: "Stop & Shop", amount: "$47.12", day: "2026-09-08" });
    expect(v!.payment).toEqual({ label: "Payment", name: "STOP & SHOP #123", amount: "$47.12", day: "2026-09-08" });
    expect(v!.kind).toBe("receipt");
  });

  it("a bill proposal says bill, and reads the payment's own day", () => {
    const [v] = buildProposals({
      receiptProposals: [], billProposals: [prop("b1", "t1")],
      receipts: [], bills: [bill("b1", "ConEdison", 8412, "2026-10-05")], txs: [tx("t1", "ConEdison", 8412, "2026-10-04")],
      notMatches: new Set(),
    });
    expect(v!.headline).toBe("ConEdison bill $84.12 looks like your Oct 4 payment");
    expect(v!.kind).toBe("bill");
  });

  it("leaves out a pair the person turned down", () => {
    const got = buildProposals({
      receiptProposals: [prop("r1", "t1")], billProposals: [],
      receipts: [receipt("r1", "Cafe", 500, "2026-09-08")], bills: [], txs: [tx("t1", "Cafe", 500, "2026-09-08")],
      notMatches: new Set([pairKey("r1", "t1")]),
    });
    expect(got).toEqual([]);
  });

  it("offers one payment to one receipt at a time, so a stale card cannot sit beside a live one", () => {
    const got = buildProposals({
      receiptProposals: [prop("r1", "t1"), prop("r2", "t1")], billProposals: [],
      receipts: [receipt("r1", "Cafe", 500, "2026-09-08"), receipt("r2", "Cafe", 500, "2026-09-08")], bills: [], txs: [tx("t1", "Cafe", 500, "2026-09-08")],
      notMatches: new Set(),
    });
    expect(got.map((g) => g.recordId)).toEqual(["r1"]);
  });

  it("a proposal whose record or payment is gone is dropped, and a bill with no due date is never shown", () => {
    const got = buildProposals({
      receiptProposals: [prop("gone", "t1")], billProposals: [prop("b1", "t1")],
      receipts: [], bills: [{ id: "b1", data: { ...bill("b1", "X", 100, "2026-10-01").data, dueDate: undefined } }], txs: [tx("t1", "X", 100, "2026-10-01")],
      notMatches: new Set(),
    });
    expect(got).toEqual([]);
  });
});
