import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { LedgerService } from "./LedgerService";
import { describeUpdate, emailSourceFor, fileEmailBill, fileManualBill, findBillForThread, missingWords, threadFingerprint } from "./emailBill";
import type { Bill } from "./types";

const NOW = () => "2026-10-02T12:00:00.000Z";
const setup = () => new LedgerService(new Store(new InMemoryAdapter()), "u", () => {}, NOW);

const billOf = (over: Partial<Bill["data"]> = {}, id = "b1"): Bill => ({
  id,
  data: { vendor: "ConEdison", amountCents: 8412, currency: "USD", source: emailSourceFor("t1"), fingerprint: "x", history: [], ...over },
});

describe("findBillForThread", () => {
  it("matches on the source ref or the gmail fingerprint, and not on a manual bill", () => {
    const byRef = billOf({ source: { type: "email", fingerprint: "other", ref: "t1" } }, "a");
    const byPrint = billOf({ source: { type: "email", fingerprint: threadFingerprint("t2") } }, "b");
    const manual = billOf({ source: "manual" }, "c");
    expect(findBillForThread([manual, byRef, byPrint], "t1")?.id).toBe("a");
    expect(findBillForThread([manual, byRef, byPrint], "t2")?.id).toBe("b");
    expect(findBillForThread([manual], "t1")).toBeNull();
    expect(findBillForThread([], "t1")).toBeNull();
  });
  it("prefers the vendor that reads the same when a thread holds several", () => {
    const a = billOf({ vendor: "Water Co" }, "a");
    const b = billOf({ vendor: "ConEdison" }, "b");
    expect(findBillForThread([a, b], "t1", "conedison!")?.id).toBe("b");
    expect(findBillForThread([a, b], "t1")?.id).toBe("a");
  });
});

describe("describeUpdate", () => {
  it("nothing when the amount is the same and the mail states no new date", () => {
    expect(describeUpdate(billOf(), { amount: 84.12 })).toBeNull();
    expect(describeUpdate(billOf({ dueDate: "2026-10-09" }), { amount: 84.12, dueDate: "2026-10-09" })).toBeNull();
    // a blank date in the mail never changes or clears the one in Money
    expect(describeUpdate(billOf({ dueDate: "2026-10-09" }), { amount: 84.12, dueDate: null })).toBeNull();
    expect(describeUpdate(billOf(), { amount: 84.12, dueDate: "not a date" })).toBeNull();
  });
  it("asks the question for a new amount", () => {
    const u = describeUpdate(billOf(), { amount: 90 })!;
    expect(u.prompt).toBe("ConEdison is already in Money at $84.12 · Update it to $90.00?");
    expect(u.correction).toEqual({ amount: 90 });
    expect(u.changes).toEqual(["amount"]);
    expect(u.reopensPaid).toBe(false);
  });
  it("asks about a changed or newly stated due date", () => {
    expect(describeUpdate(billOf({ dueDate: "2026-10-05" }), { amount: 84.12, dueDate: "2026-10-12" })!.prompt)
      .toBe("ConEdison is already in Money, due Oct 5 · Change the due date to Oct 12?");
    expect(describeUpdate(billOf(), { amount: 84.12, dueDate: "2026-10-12" })!.prompt)
      .toBe("ConEdison is already in Money with no due date · Set it to Oct 12?");
    expect(describeUpdate(billOf(), { amount: 90, dueDate: "2026-10-12" })!.prompt)
      .toBe("ConEdison is already in Money at $84.12 · Update it to $90.00, due Oct 12?");
  });
  it("says so when applying it reopens a paid bill", () => {
    const paid = billOf({ paidAt: "2026-10-03", paidEvidence: { type: "user_confirmed" } });
    const u = describeUpdate(paid, { amount: 90 })!;
    expect(u.reopensPaid).toBe(true);
    expect(u.prompt).toBe("ConEdison is already in Money at $84.12 · Update it to $90.00 and confirm it paid again?");
  });
  it("does not offer an unreadable amount as a change", () => {
    expect(describeUpdate(billOf(), { amount: "lots" })).toBeNull();
    expect(describeUpdate(billOf(), { amount: null })).toBeNull();
  });
});

describe("fileEmailBill, against a real ledger", () => {
  it("adds one bill from a thread with a blank due date, then reports the repeat", async () => {
    const ledger = setup();
    const first = await fileEmailBill(ledger, { vendor: "ConEdison", amount: 84.12 }, "t1");
    expect(first.status).toBe("added");
    expect(first.message).toBe("Added to Money · $84.12");
    const again = await fileEmailBill(ledger, { vendor: "ConEdison", amount: 84.12 }, "t1");
    expect(again.status).toBe("duplicate");
    expect(again.message).toBe("Already in Money · ConEdison $84.12");
    const bills = await ledger.listBills();
    expect(bills).toHaveLength(1);
    expect(bills[0]!.data.dueDate).toBeUndefined();
    expect(bills[0]!.data.recurrence).toBeUndefined();
    expect(bills[0]!.data.source).toEqual({ type: "email", fingerprint: "gmail:t1", ref: "t1" });
  });
  it("a later change is an offer, not a second record, and applying it keeps the history", async () => {
    const ledger = setup();
    await fileEmailBill(ledger, { vendor: "ConEdison", amount: 84.12 }, "t1");
    const later = await fileEmailBill(ledger, { vendor: "ConEdison", amount: 90, dueDate: "2026-10-20" }, "t1");
    if (later.status !== "update") throw new Error("expected an update offer, got " + later.status);
    // nothing written yet
    expect((await ledger.listBills())[0]!.data.amountCents).toBe(8412);
    expect(later.message).toBe("ConEdison is already in Money at $84.12 · Update it to $90.00, due Oct 20?");
    const done = await later.apply();
    expect(done).toEqual({ ok: true, message: "Updated in Money · $90.00" });
    const bills = await ledger.listBills();
    expect(bills).toHaveLength(1);
    expect(bills[0]!.data.amountCents).toBe(9000);
    expect(bills[0]!.data.dueDate).toBe("2026-10-20");
    expect(bills[0]!.data.history.at(-1)!.changes).toMatchObject({ amountCents: { from: 8412, to: 9000 } });
  });
  it("a paid bill's update reopens the paid state for confirmation", async () => {
    const ledger = setup();
    const added = await fileEmailBill(ledger, { vendor: "ConEdison", amount: 84.12 }, "t1");
    if (added.status !== "added") throw new Error("not added");
    await ledger.markBillPaidByUser(added.id, "2026-10-03");
    const later = await fileEmailBill(ledger, { vendor: "ConEdison", amount: 90 }, "t1");
    if (later.status !== "update") throw new Error("expected an update offer");
    expect(later.update.reopensPaid).toBe(true);
    await later.apply();
    expect((await ledger.getBill(added.id))!.data.paidNeedsReconfirm).toBe(true);
  });
  it("says what is missing and writes nothing", async () => {
    const ledger = setup();
    const r = await fileEmailBill(ledger, { vendor: "  ", amount: 10 }, "t9");
    expect(r).toMatchObject({ status: "invalid", errors: ["vendor"], message: "Bill Needs a Vendor · Nothing Saved" });
    const bad = await fileEmailBill(ledger, { vendor: "X", amount: 0 }, "t9");
    expect(bad.status).toBe("invalid");
    expect(await ledger.listBills()).toEqual([]);
    expect(missingWords(["vendor", "amount"])).toBe("Bill Needs a Vendor and an Amount · Nothing Saved");
  });
  it("two different threads from one vendor are two bills", async () => {
    const ledger = setup();
    await fileEmailBill(ledger, { vendor: "ConEdison", amount: 84.12 }, "t1");
    await fileEmailBill(ledger, { vendor: "ConEdison", amount: 84.12 }, "t2");
    expect(await ledger.listBills()).toHaveLength(2);
  });
});

describe("fileManualBill", () => {
  it("adds with a blank due date, and reports an exact repeat", async () => {
    const ledger = setup();
    const a = await fileManualBill(ledger, { vendor: "Rent", amount: 1200 });
    expect(a.status).toBe("added");
    expect((await fileManualBill(ledger, { vendor: "Rent", amount: 1200 })).status).toBe("duplicate");
    expect((await ledger.listBills())[0]!.data.dueDate).toBeUndefined();
  });
  it("honours a recurrence only because the person chose it", async () => {
    const ledger = setup();
    await fileManualBill(ledger, { vendor: "Rent", amount: 1200, recurrence: "monthly" });
    expect((await ledger.listBills())[0]!.data.recurrence).toBe("monthly");
  });
});
